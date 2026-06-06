import type { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import type { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import type { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';
import type { StateReconciler } from './StateReconciler';

/** Contract for a single input resolution strategy. */
export interface InputSource {
  resolve(playerId: string): PlayerInput | null;
}

/** Reads and consumes from the local prediction buffer (forward mode). */
export class ConsumingLocalSource implements InputSource {
  constructor(
    private localInputBuffer: PlayerInputTickRingBuffer,
    private room: ECSGameRoom,
  ) {}

  resolve(playerId: string): PlayerInput | null {
    return this.localInputBuffer.consume(this.room.tick, playerId);
  }
}

/**
 * Reads without consuming from the local prediction buffer (replay mode).
 * Skips ticks ≤ the server's acknowledgment boundary — those inputs were
 * already baked into the authoritative diff.
 */
export class NonConsumingLocalSource implements InputSource {
  constructor(
    private localInputBuffer: PlayerInputTickRingBuffer,
    private room: ECSGameRoom,
    private reconciler: StateReconciler,
  ) {}

  resolve(playerId: string): PlayerInput | null {
    if (this.room.tick <= this.reconciler.getAcknowledgedUpTo()) return null;
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
