import { GameEvent } from './GameEvent';

export class GameEventTickRingBuffer {
  private readonly slots: Array<{ tick: number; events: GameEvent[] }>;
  private readonly capacity: number;
  private newestTick: number = -1;

  constructor(capacity = 1024) {
    this.capacity = capacity;
    this.slots = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.slots[i] = { tick: -1, events: [] };
    }
  }

  record(tick: number, event: GameEvent): void {
    if (tick > this.newestTick) this.newestTick = tick;
    const slot = this.slots[this.slotIndex(tick)];
    if (slot.tick !== tick) {
      slot.tick = tick;
      slot.events = [];
    }
    slot.events.push(event);
  }

  get(tick: number): readonly GameEvent[] {
    if (!this.isInWindow(tick)) return [];
    const slot = this.slots[this.slotIndex(tick)];
    if (slot.tick !== tick) return [];
    return slot.events;
  }

  getWindow(fromTick: number, toTick: number): readonly (readonly GameEvent[])[] {
    const result: (readonly GameEvent[])[] = [];
    for (let t = fromTick; t <= toTick; t++) {
      result.push(this.get(t));
    }
    return result;
  }

  get latestTick(): number {
    return this.newestTick;
  }

  private slotIndex(tick: number): number {
    return ((tick % this.capacity) + this.capacity) % this.capacity;
  }

  private isInWindow(tick: number): boolean {
    if (this.newestTick < 0) return false;
    return tick > this.newestTick - this.capacity && tick <= this.newestTick;
  }
}
