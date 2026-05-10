import { PlayerInput } from './PlayerInput';
import { TickRingBuffer } from './TickRingBuffer';

export class PlayerInputBuffer extends TickRingBuffer<PlayerInput> {
  constructor(capacity = 1024) {
    super(capacity);
  }
}
