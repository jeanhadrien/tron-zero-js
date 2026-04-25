export default class GameClock {
  tick: number = 0;
  readonly tickTimeMs: number;
  accumulatorTimeMs: number = 0;

  constructor(tickTimeMs: number = 1000 / 240, startTick: number = 0) {
    this.tickTimeMs = tickTimeMs;
    this.tick = startTick;
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
      this.tick++;
      ticksToProcess++;
    }

    //console.debug('Ticked at', this.tick, 'for', ticksToProcess);
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
   * Forces the current tick to a specific value.
   * Useful when the client needs to resync with the server's tick.
   */
  setTick(tick: number) {
    this.tick = tick;
  }

  /**
   * Resets the clock's accumulator.
   */
  resetAccumulator() {
    this.accumulatorTimeMs = 0;
  }
}
