const HISTORY_LEN = 8;

/** Per-bot ring buffer tracking freedom trends for entrapment detection. */
export class BotMemory {
  private reachableHistory: number[] = [];
  private exitsHistory: number[] = [];
  private entrapmentHistory: number[] = [];
  lastGoodHeading = 0;
  panicTicks = 0;

  /** Slope of reachable-area history before recording this tick. */
  getFreedomTrend(): number {
    if (this.reachableHistory.length < 2) return 0;
    const first = this.reachableHistory[0];
    const last = this.reachableHistory[this.reachableHistory.length - 1];
    return (last - first) / this.reachableHistory.length;
  }

  /** Record a tick snapshot and return the updated freedom trend slope. */
  update(reachableArea: number, cardinalExits: number, entrapmentScore: number): number {
    this.reachableHistory.push(reachableArea);
    this.exitsHistory.push(cardinalExits);
    this.entrapmentHistory.push(entrapmentScore);
    if (this.reachableHistory.length > HISTORY_LEN) this.reachableHistory.shift();
    if (this.exitsHistory.length > HISTORY_LEN) this.exitsHistory.shift();
    if (this.entrapmentHistory.length > HISTORY_LEN) this.entrapmentHistory.shift();

    if (this.reachableHistory.length < 2) return 0;
    const first = this.reachableHistory[0];
    const last = this.reachableHistory[this.reachableHistory.length - 1];
    return (last - first) / this.reachableHistory.length;
  }

  /** Clear history on death or respawn. */
  reset(): void {
    this.reachableHistory = [];
    this.exitsHistory = [];
    this.entrapmentHistory = [];
    this.lastGoodHeading = 0;
    this.panicTicks = 0;
  }
}