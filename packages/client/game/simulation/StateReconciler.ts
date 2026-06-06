import { NetworkDiffTickRingBuffer, type NetworkDiffPayload } from '@tron0/shared/interfaces/Network';
import { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';
import type { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import { buffersEqual } from '@tron0/shared/utils/buffers';
import { SnapshotRing } from '../SnapshotRing';
import type { ECSGameRoom } from '@tron0/shared/ECSGameRoom';

/** Owns rollback lifecycle: diff storage, acknowledgment, anchor lookup, rewind. */
export class StateReconciler {
  private networkDiffBuffer: NetworkDiffTickRingBuffer;
  private localInputBuffer: PlayerInputTickRingBuffer;
  private snapshots: SnapshotRing;

  private lastAcknowledgedInputTick: number = -1;
  private pendingResimTick: number | null = null;
  private localPlayerId: string = '';

  isReplaying: boolean = false;

  constructor(
    networkDiffBuffer: NetworkDiffTickRingBuffer,
    localInputBuffer: PlayerInputTickRingBuffer,
    snapshots: SnapshotRing,
  ) {
    this.networkDiffBuffer = networkDiffBuffer;
    this.localInputBuffer = localInputBuffer;
    this.snapshots = snapshots;
  }

  /** Exposed for InputSource construction — the local prediction buffer. */
  get inputBuffer(): PlayerInputTickRingBuffer {
    return this.localInputBuffer;
  }

  /** Exposed for ForwardPipeline construction — the snapshot ring. */
  get snapshotRing(): SnapshotRing {
    return this.snapshots;
  }

  setLocalPlayer(playerId: string): void {
    this.localPlayerId = playerId;
  }

  /** Queue a local-predicted input into the local buffer. */
  addLocalInput(input: PlayerInput): void {
    this.localInputBuffer.record(input.tick, input.playerId, input);
  }

  /** Store authoritative diffs, acknowledge inputs, and schedule a rollback if needed. */
  addNetworkDiffBatch(diffs: NetworkDiffPayload[], serverTick: number): void {
    let earliestChangedTick = Infinity;

    for (const diff of diffs) {
      const stored = this.networkDiffBuffer.get(diff.tick, 'network');
      if (stored && buffersEqual(stored.data, diff.data) && buffersEqual(stored.struct, diff.struct)) {
        continue;
      }

      this.networkDiffBuffer.record(diff.tick, 'network', {
        data: diff.data,
        struct: diff.struct,
        tick: diff.tick,
      });

      if (diff.tick < earliestChangedTick) {
        earliestChangedTick = diff.tick;
      }
    }

    const ackTick = serverTick - 1;
    if (ackTick > this.lastAcknowledgedInputTick) {
      this.lastAcknowledgedInputTick = ackTick;
      if (this.localPlayerId) {
        this.localInputBuffer.discardUpTo(ackTick, this.localPlayerId);
      }
    }

    if (!isFinite(earliestChangedTick)) return;

    const resimTick = earliestChangedTick - 1;
    if (resimTick >= 0) {
      this.pendingResimTick = this.pendingResimTick === null
        ? resimTick
        : Math.min(this.pendingResimTick, resimTick);
    }
  }

  needsRollback(currentTick: number): boolean {
    return this.pendingResimTick !== null && currentTick >= this.pendingResimTick;
  }

  findAnchor(targetTick: number): { tick: number; buffer: ArrayBuffer } | null {
    return this.snapshots.findBestAnchor(targetTick);
  }

  /** Rewind the room to a past snapshot anchor. */
  rewind(room: ECSGameRoom, anchor: { tick: number; buffer: ArrayBuffer }): void {
    room.resetWorld();
    room.rebuildSerializers();
    room.snapshotDeserialize(anchor.buffer, new Map());
    room.tick = anchor.tick;
  }

  getDiff(tick: number): NetworkDiffPayload | null {
    return this.networkDiffBuffer.get(tick, 'network');
  }

  getAcknowledgedUpTo(): number {
    return this.lastAcknowledgedInputTick;
  }

  getPendingResimTick(): number | null {
    return this.pendingResimTick;
  }

  clearPendingResim(): void {
    this.pendingResimTick = null;
  }

  seedInitialState(tick: number, buffer: ArrayBuffer): void {
    this.lastAcknowledgedInputTick = tick;
    this.snapshots.seed(tick, buffer);
  }
}
