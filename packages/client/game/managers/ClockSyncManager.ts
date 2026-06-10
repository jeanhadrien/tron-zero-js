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

// ---- ClockAnchor -----------------------------------------------------------

interface ClockAnchor {
  /** Server tick at the moment this observation was generated. */
  serverTick: number;
  /** performance.now() at the instant the observation reached the client. */
  clientTimeMs: number;
}

// ---- ClockSync -------------------------------------------------------------

/**
 * Client-side clock synchronisation layer.
 *
 * Maintains a smoothed one-way-delay estimate via a sliding ping buffer
 * and applies a linear P-controller to `room.clock.tickTimeMs` every frame.
 *
 * Two data sources feed a unified anchor buffer:
 *   - Pongs (periodic, RTT-based) — provide OWD estimates
 *   - Authoritative state batches (event-driven, direct server tick) —
 *     provide high-frequency ground-truth anchors
 *
 * `adjustClock` picks the freshest anchor, extrapolates the server position,
 * and nudges `tickTimeMs` via the P-controller.  When the client falls behind
 * by more than {@link EMERGENCY_THRESHOLD_TICKS}, `recordServerTick` immediately
 * injects accumulator time to trigger a catch-up burst — handling large deficits
 * that the low-gain P-controller would take seconds to converge on.
 */
export class ClockSyncManager {
  private buffer = new PingBuffer();
  private room: ECSGameRoom | null = null;
  private _isReplaying: (() => boolean) | null = null;

  /** Sliding window of clock observation anchors (pong + snapshot). */
  private anchors: ClockAnchor[] = [];
  /** Number of pongs processed since construction. Drives the gain ramp. */
  private _sampleCount = 0;

  /** Last computed tick error and scale, stored for debug/HUD access. */
  private _lastTickError = 0;
  private _lastScale = 1;
  /** Sign of _lastTickError from previous adjustClock() call (1 / -1 / 0). */
  private _prevErrorSign = 0;
  /** Whether {@link diagnose} has already been called during this session. */
  private _diagnoseCalled = false;

  private static readonly GAIN = 0.1;
  private static readonly GAIN_MIN = 0.02;
  private static readonly GAIN_RAMP_SAMPLES = 5;
  private static readonly MAX_CORRECTION = 10;
  private static readonly DEFAULT_LEAD_TICKS = 1;
  private static readonly MAX_ANCHORS = 16;
  /** Anchor jumps beyond this threshold (in ticks) trigger a warning. */
  private static readonly ANCHOR_JUMP_WARN_TICKS = 1;
  /** Error magnitude beyond this threshold (in ticks) triggers a warning. */
  private static readonly LARGE_ERROR_WARN_TICKS = 2;
  /** If the client is behind the server+lead target by this many ticks, inject accumulator. */
  private static readonly EMERGENCY_THRESHOLD_TICKS = 3;
  /** Maximum ticks of accumulator time injected per emergency catch-up frame. */
  private static readonly MAX_CATCHUP_TICKS_PER_FRAME = 5;

  // -- lifecycle ---------------------------------------------------------------

  /** Bind to a game room with a replaying-state callback. */
  attach(room: ECSGameRoom, isReplaying: () => boolean): void {
    this.room = room;
    this._isReplaying = isReplaying;
  }

  // -- data intake -------------------------------------------------------------

  /**
   * Called from the Worker when a pong arrives.
   *
   * Feeds the PingBuffer for OWD estimation and pushes a unified anchor
   * so `adjustClock` can extrapolate server position from the freshest source.
   */
  recordPing(rttMs: number, serverTick: number): void {
    if (!this.room || (this._isReplaying && this._isReplaying())) return;

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

    // Auto-diagnose once after the gain ramp has enough samples
    if (!this._diagnoseCalled && this._sampleCount >= ClockSyncManager.GAIN_RAMP_SAMPLES) {
      this._diagnoseCalled = true;
      this.diagnose();
    }

    // Push anchor with post-increment tick to match snapshot tick semantics
    const newAnchor: ClockAnchor = { serverTick: serverTick + 1, clientTimeMs: now };
    this._warnAnchorJump(newAnchor);
    this._pushAnchor(newAnchor);
  }

  /**
   * Called from the Worker when an authoritative state batch arrives.
   *
   * Pushes a ground-truth anchor into the unified buffer and checks whether
   * the client has fallen behind its lead target.  If the deficit exceeds
   * {@link EMERGENCY_THRESHOLD_TICKS}, injects accumulator time to trigger
   * a catch-up burst on the next simulation frame.
   */
  private _debugRecCounter = 0;

  recordServerTick(serverTick: number): void {
    if (!this.room || (this._isReplaying && this._isReplaying())) return;

    const now = performance.now();
    const newAnchor: ClockAnchor = { serverTick, clientTimeMs: now };
    this._pushAnchor(newAnchor);

    const leadTicks = this.getLeadTicks();
    const targetClientTick = serverTick + leadTicks;
    const deficit = targetClientTick - this.room.tick;

    if (deficit >= ClockSyncManager.EMERGENCY_THRESHOLD_TICKS) {
      const capped = Math.min(deficit, ClockSyncManager.MAX_CATCHUP_TICKS_PER_FRAME);
      this.room.clock.accumulatorTimeMs += capped * this.room.clock.referenceTickTimeMs;
      console.warn(
        `[ClockSync] EMERGENCY inject: deficit=${deficit.toFixed(1)}t injected=${capped}t ` +
          `| serverTick=${serverTick} clientTick=${this.room.tick} lead=${leadTicks} ` +
          `| pendAcc=${this.room.clock.pendingTicks()} tickTimeMs=${this.room.clock.tickTimeMs.toFixed(1)}`
      );
    } else if (++this._debugRecCounter % 30 === 0) {
      console.warn(
        `[ClockSync] recTick: deficit=${deficit.toFixed(1)}t ` +
          `| serverTick=${serverTick} clientTick=${this.room.tick} lead=${leadTicks} ` +
          `| pendAcc=${this.room.clock.pendingTicks()} tickTimeMs=${this.room.clock.tickTimeMs.toFixed(1)}`
      );
    }
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
   * Pick the freshest anchor (from pongs or snapshots), extrapolate server
   * position from it, and apply the P-controller.  Call every frame before
   * tick processing.
   *
   * Gain ramps linearly from {@link GAIN_MIN} to {@link GAIN} over the
   * first {@link GAIN_RAMP_SAMPLES} pongs so early noisy samples have
   * negligible authority.
   */
  adjustClock(): void {
    if (!this.room || this._sampleCount === 0) return;

    const anchor = this.anchors.length > 0 ? this.anchors[this.anchors.length - 1] : undefined;
    if (!anchor) return;

    const now = performance.now();
    const refTickMs = this.room.clock.referenceTickTimeMs;
    const owdMs = this.buffer.getOWD();
    const owdTicks = owdMs / refTickMs;
    const elapsedTicks = (now - anchor.clientTimeMs) / refTickMs;

    const estimatedServerNow = anchor.serverTick + owdTicks + elapsedTicks;
    const effectiveTick = this.room.tick + this.room.clock.pendingTicks();
    const idealClientTick = estimatedServerNow + 1;
    const error = idealClientTick - effectiveTick;

    if (this._sampleCount <= 20 || Math.abs(error) > ClockSyncManager.LARGE_ERROR_WARN_TICKS) {
      console.warn(
        `[ClockSync] diag: anchorTick=${anchor.serverTick} owdT=${owdTicks.toFixed(2)} elpsd=${elapsedTicks.toFixed(2)} ` +
          `estSvrNow=${estimatedServerNow.toFixed(2)} idealCli=${idealClientTick.toFixed(2)} ` +
          `roomT=${this.room.tick} pend=${this.room.clock.pendingTicks()} effT=${effectiveTick} ` +
          `lead=${this.getLeadTicks()} error=${error.toFixed(2)}`
      );
    }

    // Ramped gain: starts conservative, reaches full authority after GAIN_RAMP_SAMPLES pongs
    const ramp = Math.min(1, this._sampleCount / ClockSyncManager.GAIN_RAMP_SAMPLES);
    const effectiveGain = ClockSyncManager.GAIN_MIN + (ClockSyncManager.GAIN - ClockSyncManager.GAIN_MIN) * ramp;

    const correction = effectiveGain * error;
    const clamped = Math.max(-ClockSyncManager.MAX_CORRECTION, Math.min(ClockSyncManager.MAX_CORRECTION, correction));
    const scale = 1 - clamped;
    this.room.clock.tickTimeMs = this.room.clock.referenceTickTimeMs * scale;

    // ── Diagnostic warnings ──────────────────────────────────────────────────

    // Oscillation — error sign flipped from last frame
    const errorSign = Math.sign(error);
    if (errorSign !== 0 && this._prevErrorSign !== 0 && errorSign !== this._prevErrorSign) {
      console.warn(
        `[ClockSync] oscillation: tickError flipped ${this._prevErrorSign > 0 ? '+' : '-'}→${errorSign > 0 ? '+' : '-'} ` +
          `| error=${error.toFixed(2)} scale=${scale.toFixed(3)} gain=${effectiveGain.toFixed(3)}`
      );
    }
    this._prevErrorSign = errorSign;

    // Large error — controller cannot converge within normal bounds
    if (Math.abs(error) > ClockSyncManager.LARGE_ERROR_WARN_TICKS) {
      console.warn(
        `[ClockSync] large error: tickError=${error.toFixed(2)} ` +
          `| effectiveTick=${effectiveTick} clientTick=${this.room.tick} scale=${scale.toFixed(3)}`
      );
    }

    // Saturation — correction hit the clamp ceiling
    if (Math.abs(correction) >= ClockSyncManager.MAX_CORRECTION) {
      console.warn(
        `[ClockSync] saturation: correction=${correction.toFixed(4)} clamped to ${clamped.toFixed(4)} ` +
          `| error=${error.toFixed(2)} gain=${effectiveGain.toFixed(3)}`
      );
    }

    this._lastTickError = error;
    this._lastScale = scale;
  }

  // -- debug / HUD accessors ---------------------------------------------------

  get smoothedOWD(): number {
    return this.buffer.getOWD();
  }

  get lastTickError(): number {
    return this._lastTickError;
  }

  get lastScale(): number {
    return this._lastScale;
  }

  /**
   * One-shot health report comparing the init-time lead (from {@link getLeadTicks})
   * against the P-controller's implicit steady-state target (OWD + 1).  A mismatch
   * here is a structural misalignment that the controller fights on every frame.
   */
  diagnose(): void {
    if (!this.room || !this.buffer.hasData()) return;
    const owdTicks = this.buffer.getOWD() / this.room.clock.referenceTickTimeMs;
    const initLead = this.getLeadTicks();
    const controllerTarget = owdTicks + 1;
    const delta = initLead - controllerTarget;
    console.warn(
      `[ClockSync] diagnose: OWD=${owdTicks.toFixed(2)}t ` +
        `leadUsed=${initLead} controllerTarget=${controllerTarget.toFixed(2)} ` +
        `mismatch=${delta.toFixed(2)}t ` +
        `| ramp=${Math.min(1, this._sampleCount / ClockSyncManager.GAIN_RAMP_SAMPLES).toFixed(2)} ` +
        `samples=${this._sampleCount} anchors=${this.anchors.length}`
    );
  }

  // -- internals ---------------------------------------------------------------

  /** Push an anchor into the sliding window and trim to MAX_ANCHORS. */
  private _pushAnchor(anchor: ClockAnchor): void {
    this.anchors.push(anchor);
    if (this.anchors.length > ClockSyncManager.MAX_ANCHORS) {
      this.anchors.shift();
    }
  }

  /**
   * Warn if the new anchor is far from where extrapolation predicted based on
   * the previous anchor — indicates a sudden OWD change or clock discontinuity.
   */
  private _warnAnchorJump(newAnchor: ClockAnchor): void {
    if (!this.room || this.anchors.length === 0) return;

    const prev = this.anchors[this.anchors.length - 1];
    const elapsedTicks = (newAnchor.clientTimeMs - prev.clientTimeMs) / this.room.clock.referenceTickTimeMs;
    const extrapolated = prev.serverTick + elapsedTicks;
    const jump = newAnchor.serverTick - extrapolated;

    if (Math.abs(jump) > ClockSyncManager.ANCHOR_JUMP_WARN_TICKS) {
      console.warn(
        `[ClockSync] anchor jump: ${jump.toFixed(2)} ticks ` +
          `(extrapolated=${extrapolated.toFixed(2)}, actual=${newAnchor.serverTick})`
      );
    }
  }
}
