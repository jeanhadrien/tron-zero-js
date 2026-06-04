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
 * and applies a linear P-controller to `room.clock.tickTimeMs` every frame.
 *
 * Error is **extrapolated** from the last pong timestamp on each frame, so the
 * correction naturally decays to zero as the client catches up — no overshoot
 * from stale snapshots.  Gain ramps from {@link GAIN_MIN} to {@link GAIN}
 * over the first {@link GAIN_RAMP_SAMPLES} pongs, replacing the old binary
 * warmup gate with a continuous confidence curve.
 */
export class ClockSyncManager {
  private buffer = new PingBuffer();
  private room: ECSGameRoom | null = null;

  /** Anchor for per-frame error extrapolation — stored at each pong arrival. */
  private _lastPongServerTickAtReceive = 0;
  private _lastPongClientTimeMs = 0;
  private _lastPongOWDTicks = 0;
  /** Number of pongs processed since construction. Drives the gain ramp. */
  private _sampleCount = 0;

  private static readonly GAIN = 0.1;
  private static readonly GAIN_MIN = 0.02;
  private static readonly GAIN_RAMP_SAMPLES = 5;
  private static readonly MAX_CORRECTION = 0.25;
  private static readonly DEFAULT_LEAD_TICKS = 1;

  // -- lifecycle ---------------------------------------------------------------

  /** Bind to a game room (called after room creation in connectToServer). */
  attach(room: ECSGameRoom): void {
    this.room = room;
  }

  // -- data intake -------------------------------------------------------------

  /**
   * Called from the Worker when a pong arrives.
   *
   * Stores the extrapolation anchor so {@link adjustClock} can recompute the
   * error on every frame instead of using a frozen snapshot.  Samples are
   * always pushed — the PingBuffer EWMA and the gain ramp handle stability.
   */
  recordPing(rttMs: number, serverTick: number): void {
    if (!this.room || this.room.replaying) return;

    const rawOWD = rttMs / 2;
    const now = performance.now();

    const sample: PingSample = {
      rttMs,
      owdMs: rawOWD,
      serverTick,
      clientTimeMs: now,
    };
    this.buffer.push(sample);
    this._sampleCount++;

    const owdMs = this.buffer.getOWD();
    const refTickMs = this.room.clock.referenceTickTimeMs;
    const owdTicks = owdMs / refTickMs;

    // Server tick at the instant the pong hit the client NIC
    const serverTickAtReceive = serverTick + owdTicks;

    this._lastPongServerTickAtReceive = serverTickAtReceive;
    this._lastPongClientTimeMs = now;
    this._lastPongOWDTicks = owdTicks;
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
   * Extrapolate the current tick error from the last pong anchor and apply
   * the P-controller.  Call every frame before tick processing.
   *
   * Gain ramps linearly from {@link GAIN_MIN} to {@link GAIN} over the
   * first {@link GAIN_RAMP_SAMPLES} pongs so early noisy samples have
   * negligible authority.
   */
  adjustClock(): void {
    if (!this.room || this._sampleCount === 0) return;

    // Extrapolate server tick from last pong arrival time
    const elapsedMs = performance.now() - this._lastPongClientTimeMs;
    const elapsedTicks = elapsedMs / this.room.clock.referenceTickTimeMs;
    const estimatedServerTickNow = this._lastPongServerTickAtReceive + elapsedTicks;
    const idealClientTick = estimatedServerTickNow + this._lastPongOWDTicks + 1;
    const error = idealClientTick - this.room.tick;

    // Ramped gain: starts conservative, reaches full authority after GAIN_RAMP_SAMPLES pongs
    const ramp = Math.min(1, this._sampleCount / ClockSyncManager.GAIN_RAMP_SAMPLES);
    const effectiveGain = ClockSyncManager.GAIN_MIN + (ClockSyncManager.GAIN - ClockSyncManager.GAIN_MIN) * ramp;

    const correction = effectiveGain * error;
    const clamped = Math.max(-ClockSyncManager.MAX_CORRECTION, Math.min(ClockSyncManager.MAX_CORRECTION, correction));
    const scale = 1 - clamped;
    this.room.clock.tickTimeMs = this.room.clock.referenceTickTimeMs * scale;
  }

  // -- debug / HUD accessors ---------------------------------------------------

  get smoothedOWD(): number {
    return this.buffer.getOWD();
  }
}
