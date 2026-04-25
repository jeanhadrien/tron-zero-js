export default class GameClock {
  tick: number = 0;
  readonly tickRate: number; // 60 tick rate (16.666... ms)
  accumulator: number = 0;

  constructor(tickRate: number = 1000 / 60, startTick: number = 0) {
    this.tickRate = tickRate;
    this.tick = startTick;
  }

  /**
   * Updates the accumulator and returns the number of fixed ticks that should be processed.
   * @param delta The time elapsed since the last update in milliseconds.
   * @returns The number of ticks to process this frame.
   */
  update(delta: number): number {
    this.accumulator += delta;
    let ticksToProcess = 0;

    while (this.accumulator >= this.tickRate) {
      this.accumulator -= this.tickRate;
      this.tick++;
      ticksToProcess++;
    }

    console.debug('Ticked at', this.tick, 'for', ticksToProcess);
    return ticksToProcess;
  }

  /**
   * Returns the interpolation alpha (0.0 to 1.0) for rendering between fixed ticks.
   * This is useful for smoothing out movement on the client side.
   */
  getAlpha(): number {
    return this.accumulator / this.tickRate;
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
    this.accumulator = 0;
  }
}
