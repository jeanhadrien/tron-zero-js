import type { NetworkDiffPayload } from '@tron0/shared/interfaces/Network';
import { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';
import type { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import { buffersEqual } from '@tron0/shared/utils/buffers';
import { SnapshotRing } from '../SnapshotRing';
import type { ECSGameRoom } from '@tron0/shared/ECSGameRoom';

/** Owns rollback lifecycle: diff storage, acknowledgment, anchor lookup, rewind. */
export class StateReconciler {
  private localInputBuffer: PlayerInputTickRingBuffer;
  private snapshots: SnapshotRing;

  /** Tick-indexed authoritative diffs — decoupled from ring-buffer window for dedup + replay. */
  private diffByTick = new Map<number, NetworkDiffPayload>();

  private lastAcknowledgedInputTick: number = -1;
  private pendingResimTick: number | null = null;
  private localPlayerId: string = '';

  isReplaying: boolean = false;

  private static readonly MAX_DIFF_RETENTION_TICKS = 512;

  constructor(localInputBuffer: PlayerInputTickRingBuffer, snapshots: SnapshotRing) {
    this.localInputBuffer = localInputBuffer;
    this.snapshots = snapshots;
  }

  /** Exposed for InputSource construction — the local prediction buffer. */
  get inputBuffer(): PlayerInputTickRingBuffer {
    return this.localInputBuffer;
  }

  setLocalPlayer(playerId: string): void {
    this.localPlayerId = playerId;
  }

  /** Queue a local-predicted input into the local buffer. */
  addLocalInput(input: PlayerInput): void {
    this.localInputBuffer.record(input.tick, input.playerId, input);
  }

  /** Store authoritative diffs, acknowledge inputs, and schedule a rollback if needed. */
  addNetworkDiffBatch(diffs: NetworkDiffPayload[], serverTick: number, clientTick: number): void {
    let earliestChangedTick = Infinity;
    let newestDiffTick = -1;

    for (const diff of diffs) {
      if (diff.tick > newestDiffTick) newestDiffTick = diff.tick;

      const stored = this.diffByTick.get(diff.tick);
      if (stored && buffersEqual(stored.data, diff.data) && buffersEqual(stored.struct, diff.struct)) {
        continue;
      }

      this.diffByTick.set(diff.tick, {
        data: diff.data,
        struct: diff.struct,
        tick: diff.tick,
      });

      if (diff.tick < earliestChangedTick) {
        earliestChangedTick = diff.tick;
      }
    }

    if (newestDiffTick >= 0) {
      this.pruneDiffs(newestDiffTick);
    }

    const ackTick = serverTick - 1;
    if (ackTick > this.lastAcknowledgedInputTick) {
      this.lastAcknowledgedInputTick = ackTick;
      if (this.localPlayerId) {
        this.localInputBuffer.discardUpTo(ackTick, this.localPlayerId);
      }
    }

    if (!isFinite(earliestChangedTick)) return;

    // Diff is for the current or a future tick — forward preTick will apply it inline.
    if (earliestChangedTick >= clientTick) {
      console.warn(
        `[StateRec] diff deferred to forward: earliestChanged=${earliestChangedTick} clientTick=${clientTick}`
      );
      return;
    }

    const resimTick = earliestChangedTick - 1;
    if (resimTick >= 0) {
      const prev = this.pendingResimTick;
      this.pendingResimTick = this.pendingResimTick === null
        ? resimTick
        : Math.min(this.pendingResimTick, resimTick);
      if (prev === null || this.pendingResimTick < prev) {
        console.warn(
          `[StateRec] pendingResimTick set: ${this.pendingResimTick} (was ${prev === null ? 'null' : prev}) ` +
            `| earliestChanged=${earliestChangedTick} serverTick=${serverTick} newDiffs=${diffs.length} ackTick=${ackTick}`
        );
      }
    }
  }

  needsRollback(currentTick: number): boolean {
    return this.pendingResimTick !== null && currentTick > this.pendingResimTick + 1;
  }

  findAnchor(targetTick: number): { tick: number; buffer: ArrayBuffer } | null {
    return this.snapshots.findBestAnchor(targetTick);
  }

  /** Oldest snapshot in the ring — used when pendingResim predates all anchors. */
  findOldestAnchor(): { tick: number; buffer: ArrayBuffer } | null {
    return this.snapshots.findOldestAnchor();
  }

  /** Rewind the room to a past snapshot anchor. */
  rewind(room: ECSGameRoom, anchor: { tick: number; buffer: ArrayBuffer }): void {
    room.resetWorld();
    room.rebuildSerializers();
    room.snapshotDeserialize(anchor.buffer, new Map());
    room.tick = anchor.tick;
  }

  getDiff(tick: number): NetworkDiffPayload | null {
    return this.diffByTick.get(tick) ?? null;
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
    this.pendingResimTick = null;
    this.diffByTick.clear();
    this.snapshots.seed(tick, buffer);
  }

  private pruneDiffs(newestTick: number): void {
    const cutoff = newestTick - StateReconciler.MAX_DIFF_RETENTION_TICKS;
    for (const tick of this.diffByTick.keys()) {
      if (tick < cutoff) this.diffByTick.delete(tick);
    }
  }
}