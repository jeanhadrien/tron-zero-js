/**
 * Fixed-size circular buffer of world snapshots for rollback anchoring.
 * Stores pre-serialized ArrayBuffer snapshots indexed by tick.
 */
export class SnapshotRing {
  private ring: Array<{ tick: number; buffer: ArrayBuffer } | null>;
  private head: number = -1;
  private count: number = 0;
  private lastTick: number = -1;

  constructor(capacity: number) {
    this.ring = new Array(capacity).fill(null);
  }

  /** Seed the ring with an initial snapshot (called at world bootstrap). */
  seed(tick: number, buffer: ArrayBuffer): void {
    this.head = 0;
    this.ring[0] = { tick, buffer };
    this.count = 1;
    this.lastTick = tick;
  }

  /** Whether a new snapshot should be taken this tick. */
  shouldTake(tick: number, periodX: number, gapTicks: number): boolean {
    if (periodX <= 0 || gapTicks <= 0) return false;
    return this.lastTick < 0 || tick - this.lastTick >= periodX;
  }

  /** Store a pre-serialized snapshot for the given tick. */
  push(tick: number, buffer: ArrayBuffer): void {
    this.head = (this.head + 1) % this.ring.length;
    this.ring[this.head] = { tick, buffer };
    this.count = Math.min(this.count + 1, this.ring.length);
    this.lastTick = tick;
  }

  /**
   * Overwrite an existing entry for the given tick, or fall back to push if
   * none found. Used during replay to replace a local-prediction snapshot
   * with the authoritative state derived from a server diff.
   */
  overwrite(tick: number, buffer: ArrayBuffer): void {
    for (let i = 0; i < this.ring.length; i++) {
      if (this.ring[i]?.tick === tick) {
        this.ring[i] = { tick, buffer };
        this.lastTick = tick;
        return;
      }
    }
    this.push(tick, buffer);
  }

  /** Find the best anchor snapshot ≤ targetTick, or null if none found. */
  findBestAnchor(targetTick: number): { tick: number; buffer: ArrayBuffer } | null {
    let best: { tick: number; buffer: ArrayBuffer } | null = null;
    for (const snap of this.ring) {
      if (!snap) continue;
      if (snap.tick <= targetTick && (!best || snap.tick > best.tick)) {
        best = snap;
      }
    }
    return best;
  }
}
