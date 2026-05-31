export default class GameClock {
  readonly referenceTickTimeMs: number;
  tickTimeMs: number;
  accumulatorTimeMs: number = 0;

  constructor(tickTimeMs: number = 1000 / 60) {
    this.referenceTickTimeMs = tickTimeMs;
    this.tickTimeMs = tickTimeMs;
  }

  /**
   * Updates the accumulator and returns the number of fixed ticks that should be processed.
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

  /**
   * Returns the interpolation alpha (0.0 to 1.0) for rendering between fixed ticks.
   * This is useful for smoothing out movement on the client side.
   */
  getAlpha(): number {
    return this.accumulatorTimeMs / this.tickTimeMs;
  }

  /**
   * Resets the clock's accumulator.
   */
  resetAccumulator() {
    this.accumulatorTimeMs = 0;
  }
}
