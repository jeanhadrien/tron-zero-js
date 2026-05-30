import { TickRingBuffer } from './TickRingBuffer';

/**
 * Opaque snapshot produced by bitecs serialization (ArrayBuffer).
 */
export type Type = ArrayBuffer;

/**
 * Fixed-size circular buffer of ECS world snapshots, indexed by tick.
 *
 * Wraps {@link TickRingBuffer} with a hidden key since world state is global
 * (one snapshot per tick, not per entity).
 */
export class WorldStateTickRingBuffer {
  private buffer: TickRingBuffer<Type>;

  constructor(capacity = 1024) {
    this.buffer = new TickRingBuffer<Type>(capacity);
  }

  record(tick: number, snapshot: Type): void {
    this.buffer.record(tick, 'world', snapshot);
  }

  get(tick: number): Type | null {
    return this.buffer.get(tick, 'world');
  }

  getWindow(fromTick: number, toTick: number): (Type | null)[] {
    return this.buffer.getWindow(fromTick, toTick, 'world');
  }

  getUnacked(lastAckedTick: number): (Type | null)[] {
    return this.buffer.getUnacked(lastAckedTick, 'world');
  }

  get latestTick(): number {
    return this.buffer.latestTick;
  }
}
