import { PlayerInput } from './interfaces/PlayerInput';
import { TickRingBuffer } from './TickRingBuffer';

export class PlayerInputTickRingBuffer extends TickRingBuffer<PlayerInput> {
  constructor(capacity = 128) {
    super(capacity);
  }
}
