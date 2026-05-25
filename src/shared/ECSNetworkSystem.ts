import { TickRingBuffer } from './TickRingBuffer';

export const Networked = {};

export class NetworkDiffTickRingBuffer extends TickRingBuffer<NetworkDiffPayload> {
  constructor(capacity = 1024) {
    super(capacity);
  }
}
export interface NetworkDiffPayload {
  tick: number;
  data: ArrayBuffer;
  struct: ArrayBuffer;
}
