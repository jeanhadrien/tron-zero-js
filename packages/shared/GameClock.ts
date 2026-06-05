export default class GameClock {
  readonly referenceTickTimeMs: number;
  tickTimeMs: number;
  accumulatorTimeMs: number = 0;
  private _lastConsumedTickTime: number = performance.now();

  constructor(tickTimeMs: number = 1000 / 60) {
    this.referenceTickTimeMs = tickTimeMs;
    this.tickTimeMs = tickTimeMs;
    this._lastConsumedTickTime = performance.now();
  }

  // -- batch mode (server) ---------------------------------------------------

  /**
   * Updates the accumulator and returns the number of fixed ticks that should be processed.
   * Consumes all pending ticks at once — used by the server's batch simulation loop.
   * @param deltaTime The time elapsed since the last update in milliseconds.
   * @returns The number of ticks to process this frame.
   */
  update(deltaTime: number): number {
    this.accumulatorTimeMs += deltaTime;
    let ticksToProcess = 0;

    while (this.accumulatorTimeMs >= this.tickTimeMs) {
      this.accumulatorTimeMs -= this.tickTimeMs;
      ticksToProcess++;
    }

    return ticksToProcess;
  }

  // -- per-tick mode (client) ------------------------------------------------

  /**
   * Accumulates time without consuming ticks.
   * Use with {@link pendingTicks} and {@link consumeTicks} for budget-capped simulation.
   */
  addDelta(deltaTime: number): void {
    this.accumulatorTimeMs += deltaTime;
  }

  /** How many ticks are ready to process based on accumulated time. */
  pendingTicks(): number {
    return Math.floor(this.accumulatorTimeMs / this.tickTimeMs);
  }

  /**
   * Consume up to n ticks' worth of accumulated time. Returns the actual number consumed.
   * Call this after processing each simulation tick.
   */
  consumeTicks(n: number): number {
    let consumed = 0;
    while (consumed < n && this.accumulatorTimeMs >= this.tickTimeMs) {
      this.accumulatorTimeMs -= this.tickTimeMs;
      consumed++;
    }
    if (consumed > 0) {
      this._lastConsumedTickTime = performance.now();
    }
    return consumed;
  }

  /**
   * Returns the interpolation alpha (0.0 to 1.0) for rendering between fixed ticks.
   * 0 = just consumed a tick, 1 = about to process the next tick.
   * Uses wall-clock time since last consumption so render sees smooth progression
   * even when the simulation loop fires less frequently than the render loop.
   */
  getAlpha(): number {
    const elapsed = performance.now() - this._lastConsumedTickTime;
    return Math.min(1.0, elapsed / this.tickTimeMs);
  }

  /** Override the tick duration (used by clock-sync P-controller). */
  setTickTimeMs(ms: number): void {
    this.tickTimeMs = ms;
  }

  /**
   * Resets the clock's accumulator.
   */
  resetAccumulator() {
    this.accumulatorTimeMs = 0;
  }
}
