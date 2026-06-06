import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import GameClock from '@tron0/shared/GameClock';
import type { System } from '@tron0/shared/interfaces/System';
import { NetworkDiffTickRingBuffer, type NetworkDiffPayload } from '@tron0/shared/interfaces/Network';
import { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';
import type { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import { SnapshotRing } from './SnapshotRing';
import { StateReconciler } from './simulation/StateReconciler';
import { ForwardPipeline } from './simulation/ForwardPipeline';
import { ReplayPipeline } from './simulation/ReplayPipeline';
import {
  ConsumingLocalSource,
  NonConsumingLocalSource,
  AuthoritativeSource,
  CompositeInputSource,
  type InputSource,
} from './simulation/InputSource';

interface ClientSimOptions {
  minSnapshotCoverageMs?: number;
  snapshotPeriodX?: number;
  snapshotRingCapacity?: number;
}

/**
 * Client-side simulation layer wired from injectable components:
 * - StateReconciler — diff storage, acknowledgment, rollback lifecycle
 * - ForwardPipeline / ReplayPipeline — tick processing strategies
 * - InputSource compositions — input resolution priority chains
 */
export class ClientSimulation {
  readonly room: ECSGameRoom;
  readonly clock: GameClock;

  snapshotGapTicks: number = 0;
  snapshotPeriodX: number = 10;
  localPlayerEid: number = -1;
  localPlayerId: string = '';

  readonly reconciler: StateReconciler;

  private forwardPipeline: ForwardPipeline;
  private replayPipeline: ReplayPipeline;
  private forwardSource: InputSource;
  private replaySource: InputSource;
  private static readonly DEFAULT_MIN_SNAPSHOT_COVERAGE_MS = 100;

  constructor(clock: GameClock, systems: System[], options?: ClientSimOptions) {
    this.clock = clock;
    if (options?.snapshotPeriodX !== undefined) this.snapshotPeriodX = options.snapshotPeriodX;

    const localInputBuffer = new PlayerInputTickRingBuffer(64);
    const networkDiffBuffer = new NetworkDiffTickRingBuffer(64);
    this.room = new ECSGameRoom(clock, systems);

    const minCoverageMs = options?.minSnapshotCoverageMs ?? ClientSimulation.DEFAULT_MIN_SNAPSHOT_COVERAGE_MS;
    const minCoverageTicks = Math.ceil(minCoverageMs / clock.referenceTickTimeMs);
    const maxPeriodTicks = Math.max(1, this.snapshotPeriodX);
    const ringCapacity = Math.max(
      options?.snapshotRingCapacity ?? 16,
      Math.ceil(minCoverageTicks / maxPeriodTicks) + 3,
    );
    const snapshots = new SnapshotRing(ringCapacity);

    this.reconciler = new StateReconciler(networkDiffBuffer, localInputBuffer, snapshots);

    const authoritativeSource = new AuthoritativeSource(this.room.playerInputBuffer, this.room);
    const consumingLocal = new ConsumingLocalSource(localInputBuffer, this.room);
    this.forwardSource = new CompositeInputSource([consumingLocal, authoritativeSource]);

    this.replayPipeline = new ReplayPipeline(snapshots);
    this.forwardPipeline = new ForwardPipeline(
      snapshots,
      () => {}, // placeholder — replaced in wirePlayer()
      () => this.snapshotPeriodX,
      () => this.snapshotGapTicks,
    );
  }

  /** Load the initial world snapshot from the server and seed everything. */
  initFromSnapshot(tick: number, buffer: ArrayBuffer): void {
    this.room.resetWorld();
    this.room.rebuildSerializers();
    this.room.snapshotDeserialize(buffer);
    this.room.tick = tick;
    this.reconciler.seedInitialState(tick, this.room.snapshotSerialize());
  }

  /** Queue a local-predicted input into the reconciler's local buffer. */
  addLocalInput(input: PlayerInput): void {
    this.reconciler.addLocalInput(input);
  }

  /** Delegate to reconciler to store diffs and schedule rollback. */
  addNetworkDiffBatch(diffs: NetworkDiffPayload[], serverTick: number): void {
    this.reconciler.addNetworkDiffBatch(diffs, serverTick);
  }

  /**
   * Process a single simulation tick, or a replay batch if a rollback
   * is pending. Returns true if tick(s) were processed.
   */
  processNextTick(): boolean {
    if (this.clock.pendingTicks() <= 0) return false;

    if (this.reconciler.needsRollback(this.room.tick)) {
      const pendingTick = this.reconciler.getPendingResimTick()!;
      const anchor = this.reconciler.findAnchor(pendingTick);
      if (!anchor) {
        this.reconciler.clearPendingResim();
        return false;
      }

      const currentTick = this.room.tick;

      this.reconciler.rewind(this.room, anchor);
      this.reconciler.isReplaying = true;

      const ticksReplayed = currentTick - anchor.tick;
      while (this.room.tick < currentTick) {
        this.replayPipeline.preTick(this.room, this.reconciler);
        this.replayPipeline.tick(this.room, this.replaySource);
        this.replayPipeline.postTick(this.room, this.reconciler);
      }

      this.clock.consumeTicks(ticksReplayed);
      this.reconciler.isReplaying = false;
      this.reconciler.clearPendingResim();
      return true;
    }

    this.forwardPipeline.preTick(this.room, this.reconciler);
    this.forwardPipeline.tick(this.room, this.forwardSource);
    this.forwardPipeline.postTick(this.room, this.reconciler);

    this.clock.consumeTicks(1);
    return true;
  }

  /**
   * Wire the player identity, set up replay input sources, and bind the
   * render-capture callback. Must be called after initFromSnapshot when
   * the player eid/stringId are known.
   */
  wirePlayer(localPlayerEid: number, localPlayerId: string, onTick: (tick: number) => void): void {
    this.localPlayerEid = localPlayerEid;
    this.localPlayerId = localPlayerId;

    this.reconciler.setLocalPlayer(localPlayerId);

    const replayLocalSource = new NonConsumingLocalSource(
      this.reconciler.inputBuffer,
      this.room,
      this.reconciler,
    );
    const authoritative = new AuthoritativeSource(this.room.playerInputBuffer, this.room);
    this.replaySource = new CompositeInputSource([replayLocalSource, authoritative]);

    this.forwardPipeline.setOnTick(onTick);
  }
}
