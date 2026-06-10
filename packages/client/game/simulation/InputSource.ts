import type { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import type { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import type { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';


/** Contract for a single input resolution strategy. */
export interface InputSource {
  resolve(playerId: string): PlayerInput | null;
}

/**
 * Reads without consuming from the local prediction buffer.
 * Inputs stay until cleared by StateReconciler when authoritative diff T+1 is applied.
 */
export class LocalPredictionSource implements InputSource {
  constructor(
    private localInputBuffer: PlayerInputTickRingBuffer,
    private room: ECSGameRoom,
  ) {}

  resolve(playerId: string): PlayerInput | null {
    return this.localInputBuffer.get(this.room.tick, playerId);
  }
}

/** Falls back to the room's authoritative input buffer. */
export class AuthoritativeSource implements InputSource {
  constructor(
    private buffer: PlayerInputTickRingBuffer,
    private room: ECSGameRoom,
  ) {}

  resolve(playerId: string): PlayerInput | null {
    return this.buffer.get(this.room.tick, playerId);
  }
}

/** Composes multiple InputSource implementations, trying each in order. */
export class CompositeInputSource implements InputSource {
  constructor(private sources: InputSource[]) {}

  resolve(playerId: string): PlayerInput | null {
    for (const source of this.sources) {
      const result = source.resolve(playerId);
      if (result) return result;
    }
    return null;
  }
}