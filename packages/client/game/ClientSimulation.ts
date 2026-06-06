import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import GameClock from '@tron0/shared/GameClock';
import type { System } from '@tron0/shared/interfaces/System';
import { NetworkDiffTickRingBuffer, type NetworkDiffPayload } from '@tron0/shared/interfaces/Network';
import { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';
import type { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import { buffersEqual } from '@tron0/shared/utils/buffers';
import { Logger } from '@tron0/shared/Logger';
import { SnapshotRing } from './SnapshotRing';

const logger = new Logger('ClientSim');

interface ClientSimOptions {
  predictLocalInputs?: boolean;
  minSnapshotCoverageMs?: number;
  snapshotPeriodX?: number;
  snapshotRingCapacity?: number;
}

/**
 * Client-side simulation layer wrapping an ECSGameRoom with:
 * - Snapshot ring buffer for rollback anchoring
 * - Network diff reconciliation (addNetworkDiffBatch)
 * - Local input prediction (addLocalInput, injected via update hooks)
 * - Per-tick simulation loop (processNextTick)
 */
export class ClientSimulation {
  readonly room: ECSGameRoom;
  readonly clock: GameClock;

  predictLocalInputs: boolean;
  snapshotGapTicks: number = 0;
  snapshotPeriodX: number = 10;
  onTick?: (tick: number) => void;
  replaying: boolean = false;
  localPlayerEid: number = -1;
  localPlayerId: string = '';

  /** Highest tick for which the server has consumed inputs.
   *  During replay, local inputs at ticks ≤ this are skipped — the
   *  server diff already baked them in. */
  lastAcknowledgedInputTick: number = -1;

  private localInputBuffer: PlayerInputTickRingBuffer;
  private networkDiffTickRingBuffer: NetworkDiffTickRingBuffer;
  private pendingResimTick: number | null = null;
  private snapshots: SnapshotRing;
  private minSnapshotCoverageMs: number;
  private static readonly DEFAULT_MIN_SNAPSHOT_COVERAGE_MS = 100;

  constructor(clock: GameClock, systems: System[], options?: ClientSimOptions) {
    this.clock = clock;
    this.predictLocalInputs = options?.predictLocalInputs ?? false;
    this.minSnapshotCoverageMs = options?.minSnapshotCoverageMs ?? ClientSimulation.DEFAULT_MIN_SNAPSHOT_COVERAGE_MS;
    if (options?.snapshotPeriodX !== undefined) this.snapshotPeriodX = options.snapshotPeriodX;

    this.localInputBuffer = new PlayerInputTickRingBuffer(64);
    this.networkDiffTickRingBuffer = new NetworkDiffTickRingBuffer(64);
    this.room = new ECSGameRoom(clock, systems);

    const minCoverageTicks = Math.ceil(this.minSnapshotCoverageMs / clock.referenceTickTimeMs);
    const maxPeriodTicks = Math.max(1, this.snapshotPeriodX);
    const ringCapacity = Math.max(
      options?.snapshotRingCapacity ?? 16,
      Math.ceil(minCoverageTicks / maxPeriodTicks) + 3
    );
    this.snapshots = new SnapshotRing(ringCapacity);
  }

  /** Load the initial world snapshot from the server and seed the ring buffer. */
  initFromSnapshot(tick: number, buffer: ArrayBuffer): void {
    this.room.resetWorld();
    this.room.rebuildSerializers();
    this.room.snapshotDeserialize(buffer);
    this.room.tick = tick;
    this.lastAcknowledgedInputTick = tick;
    this.snapshots.seed(tick, this.room.snapshotSerialize());
  }

  /** Queue a local-predicted input (consumed once, never survives replay). */
  addLocalInput(input: PlayerInput): void {
    this.localInputBuffer.record(input.tick, input.playerId, input);
  }

  /**
   * Store a batch of authoritative network diffs and schedule a resim.
   * Only rewinds to the first tick whose diff changed. Byte-identical
   * diffs are skipped.
   *
   * @param serverTick The server's `tick + 1` — the next tick to process.
   *                   All inputs at ticks ≤ serverTick-1 are acknowledged.
   */
  addNetworkDiffBatch(diffs: NetworkDiffPayload[], serverTick: number): void {
    let earliestChangedTick = Infinity;

    for (const diff of diffs) {
      const stored = this.networkDiffTickRingBuffer.get(diff.tick, 'network');
      if (stored && buffersEqual(stored.data, diff.data) && buffersEqual(stored.struct, diff.struct)) {
        continue;
      }

      this.networkDiffTickRingBuffer.record(diff.tick, 'network', {
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
      this.localInputBuffer.discardUpTo(ackTick, this.localPlayerId);
    }

    if (!isFinite(earliestChangedTick)) return;

    const resimTick = earliestChangedTick - 1;
    if (resimTick < this.room.tick) {
      this.pendingResimTick = this.pendingResimTick === null ? resimTick : Math.min(this.pendingResimTick, resimTick);
    }
  }

  /**
   * Process a single simulation tick (or a replay batch).
   * Designed for the client's setInterval loop.
   * @returns true if a tick was processed, false if idle.
   */
  processNextTick(): boolean {
    if (this.clock.pendingTicks() <= 0) return false;

    if (this.pendingResimTick !== null && this.room.tick > this.pendingResimTick) {
      this.replayFrom(this.pendingResimTick);
      this.pendingResimTick = null;
      return true;
    }

    this._applyNetworkDiff(this.room.tick);

    this.room.update({ resolveInput: this._makeResolveInput('forward') });
    this.onTick?.(this.room.tick);

    if (this.snapshots.shouldTake(this.room.tick, this.snapshotPeriodX, this.snapshotGapTicks)) {
      this.snapshots.push(this.room.tick, this.room.snapshotSerialize());
    }

    this.clock.consumeTicks(1);
    return true;
  }

  private replayFrom(pastTick: number): void {
    const currentTick = this.room.tick;

    const anchor = this.snapshots.findBestAnchor(pastTick);
    if (!anchor) {
      logger.error(`No snapshot ≤ tick ${pastTick} in ring buffer, cannot resimulate.`);
      return;
    }

    this.room.resetWorld();
    this.replaying = true;
    this.room.snapshotDeserialize(anchor.buffer, new Map());
    this.room.tick = anchor.tick;

    logger.debug(`Replaying from ${anchor.tick} to ${currentTick} (${currentTick - anchor.tick} ticks)`);

    const ticksReplayed = currentTick - anchor.tick;
    while (this.room.tick < currentTick) {
      this._applyNetworkDiff(this.room.tick);

      this.room.update({ resolveInput: this._makeResolveInput('replay') });
      this.onTick?.(this.room.tick);
    }

    this.clock.consumeTicks(ticksReplayed);
    this.replaying = false;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /** Apply a server-authoritative network diff for the given tick, if one exists. */
  private _applyNetworkDiff(tick: number): void {
    const diff = this.networkDiffTickRingBuffer.get(tick, 'network');
    if (diff) {
      this.room.soaDeserialize(diff.data);
      this.room.observerDeserializeNetwork(diff.struct, new Map());
    }
  }

  /**
   * Build the resolveInput hook for room.update().
   *
   * @param mode 'forward' — consume local inputs once (prediction).
   *             'replay'  — read local inputs without consuming, but only
   *             for ticks past the server's acknowledgment boundary.
   */
  private _makeResolveInput(mode: 'forward' | 'replay'): (playerId: string) => PlayerInput | null {
    return (playerId: string): PlayerInput | null => {
      if (this.predictLocalInputs) {
        if (mode === 'replay' && this.room.tick <= this.lastAcknowledgedInputTick) {
          // Server already incorporated this tick — skip local
        } else {
          const local = mode === 'forward'
            ? this.localInputBuffer.consume(this.room.tick, playerId)
            : this.localInputBuffer.get(this.room.tick, playerId);
          if (local) return local;
        }
      }
      return this.room.playerInputBuffer.get(this.room.tick, playerId);
    };
  }
}
