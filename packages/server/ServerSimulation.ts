import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import GameClock from '@tron0/shared/GameClock';
import type { System } from '@tron0/shared/interfaces/System';

/**
 * Server-side simulation layer wrapping an ECSGameRoom with a
 * batch-mode tick loop (server simulates all pending ticks each frame).
 *
 * Includes a self-correcting P-controller that adjusts {@code clock.tickTimeMs}
 * so the server stays locked to {@code referenceTickTimeMs} regardless of OS
 * timer jitter or event-loop drift.  Without this, {@code setInterval} drift
 * accumulates over time and the client's extrapolation-based clock sync
 * systematically overestimates the server's position.
 */
export class ServerSimulation {
  readonly room: ECSGameRoom;
  readonly clock: GameClock;

  /** Wall-clock time when this simulation was constructed (anchor for drift correction). */
  private _startTime: number;

  /** Toggle the drift self-correction P-controller on/off at compile time. */
  private static readonly DRIFT_CORRECTION_ENABLED = true;
  private static readonly DRIFT_GAIN = 0.05;
  private static readonly DRIFT_MAX_CORRECTION = 0.25;
  /** Error magnitude beyond this threshold (in ticks) triggers a warning. */
  private static readonly DRIFT_LARGE_ERROR_TICKS = 2;

  constructor(clock: GameClock, systems: System[]) {
    this.clock = clock;
    this.room = new ECSGameRoom(clock, systems);
    this._startTime = performance.now();
  }

  /**
   * Process all accumulated ticks in one batch.
   *
   * Before draining the accumulator, a P-controller compares {@code room.tick}
   * against the wall-clock ideal ({@code elapsed / referenceTickTimeMs}) and
   * nudges {@code tickTimeMs} to eliminate drift.
   */
  updateFixed(deltaTime: number): void {
    if (ServerSimulation.DRIFT_CORRECTION_ENABLED) {
      // Drift correction: lock the server to the reference timeline
      const elapsed = performance.now() - this._startTime;
      const expectedTick = Math.floor(elapsed / this.clock.referenceTickTimeMs);
      const error = expectedTick - this.room.tick;
      const correction = ServerSimulation.DRIFT_GAIN * error;
      const clamped = Math.max(
        -ServerSimulation.DRIFT_MAX_CORRECTION,
        Math.min(ServerSimulation.DRIFT_MAX_CORRECTION, correction),
      );
      const scale = 1 - clamped;
      this.clock.tickTimeMs = this.clock.referenceTickTimeMs * scale;

      if (Math.abs(error) > ServerSimulation.DRIFT_LARGE_ERROR_TICKS) {
        console.warn(
          `[ServerDrift] large drift: error=${error} ticks ` +
          `| expected=${expectedTick} actual=${this.room.tick} scale=${scale.toFixed(3)}`
        );
      }
      if (Math.abs(correction) >= ServerSimulation.DRIFT_MAX_CORRECTION) {
        console.warn(
          `[ServerDrift] saturation: correction=${correction.toFixed(4)} clamped to ${clamped.toFixed(4)} ` +
          `| error=${error} scale=${scale.toFixed(3)}`
        );
      }
    }

    const ticksToProcess = this.clock.update(deltaTime);
    this.room.ticksInBatch = ticksToProcess;
    for (let i = 0; i < ticksToProcess; i++) {
      this.room.update();
    }
    this.room.ticksInBatch = 1;
  }
}
