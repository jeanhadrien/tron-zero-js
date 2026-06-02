/**
 * Contract for any tick-indexed, entity-keyed circular buffer.
 * Useful for dependency injection — tests can provide a trivial
 * in-memory implementation or a mock.
 */
export interface ITickRingBuffer<V, K extends string = string> {
  record(tick: number, key: K, value: V): void;
  get(tick: number, key: K): V | null;
  /** Inclusive range [fromTick, toTick]. Gaps are filled by repeating the
   *  last-known value (mirrors server-side input starvation). */
  getWindow(fromTick: number, toTick: number, key: K): (V | null)[];
  /** Values from `lastAckedTick + 1` up to the newest recorded tick. */
  getUnacked(lastAckedTick: number, key: K): (V | null)[];
  readonly latestTick: number;
}

/**
 * Fixed-size circular buffer parameterised on the stored value type.
 *
 * Key is `string` by default (entity / player / monster ID) but can be
 * narrowed to a union literal if you want compile-time safety on IDs.
 *
 * @typeParam V  – the value stored (PlayerInput, MonsterAICommand, …)
 * @typeParam K  – the entity key type (default `string`)
 */
export class TickRingBuffer<V, K extends string = string> implements ITickRingBuffer<V, K> {
  private readonly slots: Array<{
    tick: number;
    map: Map<K, V>;
  }>;
  private readonly capacity: number;
  private newestTick: number = -1;
  constructor(capacity: number = 128) {
    this.capacity = capacity;
    this.slots = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.slots[i] = { tick: -1, map: new Map() };
    }
  }
  // ---- Public API ----------------------------------------------------------
  record(tick: number, key: K, value: V): void {
    if (tick > this.newestTick) this.newestTick = tick;
    const slot = this.slots[this.slotIndex(tick)];
    if (slot.tick !== tick) {
      slot.tick = tick;
      slot.map.clear();
    }
    slot.map.set(key, value);
  }
  get(tick: number, key: K): V | null {
    if (!this.isInWindow(tick)) return null;
    const slot = this.slots[this.slotIndex(tick)];
    if (slot.tick !== tick) return null;
    return slot.map.get(key) ?? null;
  }
  getWindow(fromTick: number, toTick: number, key: K): (V | null)[] {
    const result: (V | null)[] = [];
    let lastKnown: V | null = null;
    for (let t = fromTick; t <= toTick; t++) {
      const val = this.get(t, key);
      if (val !== null) lastKnown = val;
      result.push(lastKnown);
    }
    return result;
  }
  getUnacked(lastAckedTick: number, key: K): (V | null)[] {
    return this.getWindow(lastAckedTick + 1, this.newestTick, key);
  }
  /** Get and remove — one-shot read for inputs that must not survive replay. */
  consume(tick: number, key: K): V | null {
    const val = this.get(tick, key);
    if (val !== null) {
      const slot = this.slots[this.slotIndex(tick)];
      slot.map.delete(key);
    }
    return val;
  }
  get latestTick(): number {
    return this.newestTick;
  }
  // ---- Internal ------------------------------------------------------------
  private slotIndex(tick: number): number {
    return ((tick % this.capacity) + this.capacity) % this.capacity;
  }
  private isInWindow(tick: number): boolean {
    if (this.newestTick < 0) return false;
    return tick > this.newestTick - this.capacity && tick <= this.newestTick;
  }
}
