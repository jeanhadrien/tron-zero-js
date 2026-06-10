/**
 * Fixed-size circular buffer of world snapshots for rollback anchoring.
 * Entries are stored only at ticks where an authoritative server diff was
 * applied — never from pure local prediction.
 */
export class SnapshotRing {
  private ring: Array<{ tick: number; buffer: ArrayBuffer } | null>;
  private head: number = -1;
  private count: number = 0;

  constructor(capacity: number) {
    this.ring = new Array(capacity).fill(null);
  }

  /** Seed the ring with an initial snapshot (called at world bootstrap). */
  seed(tick: number, buffer: ArrayBuffer): void {
    this.head = 0;
    this.ring[0] = { tick, buffer };
    this.count = 1;
  }

  /** Store a pre-serialized snapshot for the given tick. */
  push(tick: number, buffer: ArrayBuffer): void {
    this.head = (this.head + 1) % this.ring.length;
    this.ring[this.head] = { tick, buffer };
    this.count = Math.min(this.count + 1, this.ring.length);
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

  /** Find the oldest snapshot in the ring, regardless of target tick. */
  findOldestAnchor(): { tick: number; buffer: ArrayBuffer } | null {
    let oldest: { tick: number; buffer: ArrayBuffer } | null = null;
    for (const snap of this.ring) {
      if (!snap) continue;
      if (!oldest || snap.tick < oldest.tick) {
        oldest = snap;
      }
    }
    return oldest;
  }
}
