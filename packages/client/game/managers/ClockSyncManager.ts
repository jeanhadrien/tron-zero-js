import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';

// ---- PingBuffer ------------------------------------------------------------

interface PingSample {
  rttMs: number;
  owdMs: number;
  serverTick: number;
  clientTimeMs: number;
}

/**
 * Sliding-window buffer of recent ping samples with EWMA-smoothed OWD.
 * Filters jitter so the clock controller sees a stable one-way delay estimate.
 */
class PingBuffer {
  private samples: PingSample[] = [];
  private smoothedOWD: number = 0;
  private static readonly MAX_SAMPLES = 16;
  private static readonly ALPHA = 0.2;

  /** Feed a new ping sample into the buffer and update the EWMA. */
  push(sample: PingSample): void {
    this.samples.push(sample);
    if (this.samples.length > PingBuffer.MAX_SAMPLES) {
      this.samples.shift();
    }
    this.smoothedOWD =
      this.smoothedOWD === 0
        ? sample.owdMs
        : PingBuffer.ALPHA * sample.owdMs + (1 - PingBuffer.ALPHA) * this.smoothedOWD;
  }

  getOWD(): number {
    return this.smoothedOWD;
  }

  hasData(): boolean {
    return this.samples.length > 0;
  }

  clear(): void {
    this.samples = [];
    this.smoothedOWD = 0;
  }
}

// ---- ClockSync -------------------------------------------------------------

/**
 * Client-side clock synchronisation layer.
 *
 * Maintains a smoothed one-way-delay estimate via a sliding ping buffer
 * and applies a linear P-controller to `room.clock.tickTimeMs` every frame
 * — not just on pong events — so correction is continuous.
 *
 */
export class ClockSyncManager {
  private buffer = new PingBuffer();
  private room: ECSGameRoom | null = null;
  private _storedTickError: number | null = null;

  private _warmedUp = false;
  private _stableStreak = 0;
  private _lastRawOWD = -1;

  private static readonly GAIN = 0.1;
  private static readonly MAX_CORRECTION = 0.25;
  private static readonly DEFAULT_LEAD_TICKS = 1;
  private static readonly STABILITY_THRESHOLD_MS = 5;
  private static readonly MIN_STABLE_COUNT = 3;

  // -- lifecycle ---------------------------------------------------------------

  /** Bind to a game room (called after room creation in connectToServer). */
  attach(room: ECSGameRoom): void {
    this.room = room;
  }

  // -- data intake -------------------------------------------------------------

  /**
   * Called synchronously from {@link ClientNetworkSystem._onPong}.
   *
   * During warmup, raw OWD is tracked until it stabilises (3 consecutive
   * samples within {@link STABILITY_THRESHOLD_MS}).  Once stable, the
   * polluted warmup samples are discarded and the EWMA starts fresh.
   */
  recordPing(rttMs: number, serverTick: number): void {
    if (!this.room || this.room.replaying) return;

    const rawOWD = rttMs / 2;

    // -- warmup: wait for raw OWD to settle --------------------------------
    if (!this._warmedUp) {
      if (this._lastRawOWD >= 0) {
        if (Math.abs(rawOWD - this._lastRawOWD) <= ClockSyncManager.STABILITY_THRESHOLD_MS) {
          this._stableStreak++;
        } else {
          this._stableStreak = 0;
        }
      }
      this._lastRawOWD = rawOWD;

      if (this._stableStreak >= ClockSyncManager.MIN_STABLE_COUNT) {
        this._warmedUp = true;
        this.buffer.clear();
        // fall through to normal processing with this clean sample
      } else {
        return;
      }
    }

    // -- normal: push and compute tickError --------------------------------
    const sample: PingSample = {
      rttMs,
      owdMs: rawOWD,
      serverTick,
      clientTimeMs: performance.now(),
    };
    this.buffer.push(sample);

    const owdMs = this.buffer.getOWD();
    const refTickMs = this.room.clock.referenceTickTimeMs;
    const owdTicks = owdMs / refTickMs;

    // Server tick at the instant the pong hit the client NIC
    const serverTickAtReceive = serverTick + owdTicks;
    // Ideal client tick at that same instant: ahead by OWD + 1 buffer tick
    const idealClientTick = serverTickAtReceive + owdTicks + 1;

    this._storedTickError = idealClientTick - this.room.tick;
  }

  // -- queries -----------------------------------------------------------------

  /** How many ticks the client should jump ahead of the server on init/reset.
   * Falls back to {@link DEFAULT_LEAD_TICKS} when no ping data is available yet.
   */
  getLeadTicks(): number {
    if (!this.buffer.hasData() || !this.room) return ClockSyncManager.DEFAULT_LEAD_TICKS;
    return Math.ceil(this.buffer.getOWD() / this.room.clock.referenceTickTimeMs) + 1;
  }

  // -- per‑frame adjustment ----------------------------------------------------

  /**
   * Apply the P-controller to `room.clock.tickTimeMs` using the last‑known
   * `storedTickError`.  Call this *every frame* from the Phaser update loop,
   * before {@link ECSGameRoom.updateFixed}.
   */
  adjustClock(): void {
    if (!this.room || this._storedTickError === null) return;

    const correction = ClockSyncManager.GAIN * this._storedTickError;
    const clamped = Math.max(-ClockSyncManager.MAX_CORRECTION, Math.min(ClockSyncManager.MAX_CORRECTION, correction));
    const scale = 1 - clamped;
    this.room.clock.tickTimeMs = this.room.clock.referenceTickTimeMs * scale;
  }

  // -- debug / HUD accessors ---------------------------------------------------

  get smoothedOWD(): number {
    return this.buffer.getOWD();
  }
}
