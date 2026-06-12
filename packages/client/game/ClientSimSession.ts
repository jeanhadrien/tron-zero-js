import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import GameClock from '@tron0/shared/GameClock';
import type { System } from '@tron0/shared/interfaces/System';
import type { NetworkDiffPayload } from '@tron0/shared/interfaces/Network';
import type { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';
import { GameEventType } from '@tron0/shared/interfaces/GameEvent';
import type { PlayerRenderDatum, TickRenderOutput } from './workers/WorkerProtocol';
import { query } from 'bitecs';
import PlayerSystem, {
  Player,
  Position,
  Direction,
  Color,
  SpeedMult,
  Velocity,
  IsAlive,
  TrailPointsXs,
  TrailPointsYs,
  PlayerId,
  Rubber,
  IsColliding,
} from '@tron0/shared/systems/PlayerSystem';
import { SnapshotRing } from './SnapshotRing';
import { StateReconciler } from './simulation/StateReconciler';
import { EntityIdMapStore } from './simulation/EntityIdMapStore';
import { TickPipeline } from './simulation/SimulationPipeline';
import {
  LocalPredictionSource,
  AuthoritativeSource,
  CompositeInputSource,
  type InputSource,
} from './simulation/InputSource';
import { ClockSyncManager } from './managers/ClockSyncManager';

interface ClientSimSessionOptions {
  minSnapshotCoverageMs?: number;
  snapshotPeriodX?: number;
  snapshotRingCapacity?: number;
  sessionToken: string;
}

/** Result of loading the initial server snapshot and advancing to lead. */
export interface SimReadyResult {
  tick: number;
  leadTicks: number;
  localPlayerEid: number;
  renderBatch: TickRenderOutput[];
}

/** Per-frame simulation output for the worker to post back to main. */
export interface FrameResult {
  renderBatch: TickRenderOutput[];
  currentTick: number;
  localPlayerEid: number;
  leadTicks: number;
  alpha: number;
  tickTimeMs: number;
  owd: number;
  tickError: number;
  scale: number;
}

/**
 * Worker-side simulation session: clock sync, prediction, rollback, and render
 * extraction behind a single façade. The worker script only routes messages here.
 */
export class ClientSimSession {
  readonly room: ECSGameRoom;
  readonly clock: GameClock;

  snapshotPeriodX: number = 10;
  localPlayerEid: number = -1;
  localPlayerId: string = '';

  private readonly entityIdMap: EntityIdMapStore;
  private readonly reconciler: StateReconciler;
  private readonly clockSync: ClockSyncManager;
  private readonly sessionToken: string;

  private forwardPipeline: TickPipeline;
  private replayPipeline: TickPipeline;
  private forwardSource: InputSource;
  private replaySource: InputSource;

  private pendingOutputs: TickRenderOutput[] = [];
  private lastAppliedServerTick = -1;
  private lastTrailLengths = new Map<number, number>();

  private static readonly DEFAULT_MIN_SNAPSHOT_COVERAGE_MS = 100;

  constructor(clock: GameClock, systems: System[], options: ClientSimSessionOptions) {
    this.clock = clock;
    this.sessionToken = options.sessionToken;
    if (options.snapshotPeriodX !== undefined) this.snapshotPeriodX = options.snapshotPeriodX;

    const localInputBuffer = new PlayerInputTickRingBuffer(64);
    this.room = new ECSGameRoom(clock, systems);

    const minCoverageMs = options?.minSnapshotCoverageMs ?? ClientSimSession.DEFAULT_MIN_SNAPSHOT_COVERAGE_MS;
    const minCoverageTicks = Math.ceil(minCoverageMs / clock.referenceTickTimeMs);
    const maxPeriodTicks = Math.max(1, this.snapshotPeriodX);
    const ringCapacity = Math.max(
      options?.snapshotRingCapacity ?? 16,
      Math.ceil(minCoverageTicks / maxPeriodTicks) + 3
    );
    const snapshots = new SnapshotRing(ringCapacity);

    this.entityIdMap = new EntityIdMapStore();
    this.reconciler = new StateReconciler(localInputBuffer, snapshots, this.entityIdMap);
    this.clockSync = new ClockSyncManager();
    this.clockSync.attach(this.room, () => this.reconciler.isReplaying);

    const authoritativeSource = new AuthoritativeSource(this.room.playerInputBuffer, this.room);
    const localPrediction = new LocalPredictionSource(localInputBuffer, this.room);
    this.forwardSource = new CompositeInputSource([localPrediction, authoritativeSource]);
    this.replaySource = this.forwardSource;

    this.replayPipeline = new TickPipeline(snapshots, this.entityIdMap);
    this.forwardPipeline = new TickPipeline(snapshots, this.entityIdMap, () => {});
  }

  /** Load the initial world snapshot, wire the local player, and advance to lead. */
  loadSnapshot(tick: number, buffer: ArrayBuffer): SimReadyResult {
    this.clock.resetAccumulator();

    const leadTicks = this.clockSync.getLeadTicks();
    this.room.resetWorld();
    this.room.rebuildSerializers();
    const idMap = this.room.snapshotDeserialize(buffer);
    this.entityIdMap.replace(idMap);
    this.room.spatialGrid?.rebuildFromWorld(this.room);
    this.room.tick = tick;
    this.reconciler.seedInitialState(tick, this.room.snapshotSerialize());

    this.wirePlayer();

    this.clock.accumulatorTimeMs = leadTicks * this.clock.referenceTickTimeMs + this.clock.referenceTickTimeMs;
    for (let i = 0; i < leadTicks; i++) {
      this.processNextTick();
    }
    this.clock.resetAccumulator();

    console.warn(
      `[ClockSync] init_state: msg.tick=${tick} leadTicks=${leadTicks} ` +
        `room.tick=${this.room.tick} owd=${this.clockSync.smoothedOWD.toFixed(1)}ms`
    );

    const renderBatch = this.takeRenderBatch();

    return {
      tick: this.room.tick,
      leadTicks,
      localPlayerEid: this.localPlayerEid,
      renderBatch,
    };
  }

  /** Store authoritative diffs, sync clock, and run eager rollback if needed. */
  onSyncBatch(diffs: NetworkDiffPayload[], serverTick: number): void {
    if (serverTick <= this.lastAppliedServerTick) return;

    const aheadBy = serverTick - this.room.tick;
    if (aheadBy > 0) {
      console.warn(
        `[ClockSync] SERVER AHEAD: serverTick=${serverTick} > clientTick=${this.room.tick} ` +
          `(client behind by ${aheadBy} ticks)`
      );
    }
    const diffTicks = diffs.map((d) => d.tick).join(',');
    console.warn(
      `[SimWkr] sync_batch: serverTick=${serverTick} clientTick=${this.room.tick} ` +
        `aheadBy=${aheadBy} diffs=[${diffTicks}] isReplaying=${this.reconciler.isReplaying}`
    );

    this.reconciler.addNetworkDiffBatch(diffs, serverTick, this.room.tick);
    this.clockSync.recordServerTick(serverTick);
    this.lastAppliedServerTick = serverTick;
    this.reconcilePending();
  }

  /** Feed a pong sample into clock sync. */
  onPong(rttMs: number, serverTick: number): void {
    this.clockSync.recordPing(rttMs, serverTick);
  }

  /** Queue a local-predicted input. */
  onLocalInput(input: PlayerInput): void {
    this.reconciler.addLocalInput(input);
  }

  /** Record a local respawn event when the player is dead. */
  onRespawn(): void {
    const eid = this.localPlayerEid;
    if (eid >= 0 && IsAlive[eid] !== 1) {
      const tick = this.room.tick;
      this.room.gameEventBuffer.record(tick, {
        tick,
        type: GameEventType.PlayerSpawn,
        playerId: this.localPlayerId,
      });
    }
  }

  /**
   * Advance the simulation by one frame: adjust clock, consume accumulator
   * budget, and return render output for the main thread.
   */
  frame(deltaMs: number, maxTicks = 3): FrameResult {
    this.clockSync.adjustClock();
    this.clock.addDelta(deltaMs);

    for (let i = 0; i < maxTicks; i++) {
      if (!this.processNextTick()) break;
    }

    return {
      renderBatch: this.takeRenderBatch(),
      currentTick: this.room.tick,
      localPlayerEid: this.localPlayerEid,
      leadTicks: this.clockSync.getLeadTicks(),
      alpha: this.clock.getAlpha(),
      tickTimeMs: this.clock.tickTimeMs,
      owd: this.clockSync.smoothedOWD,
      tickError: this.clockSync.lastTickError,
      scale: this.clockSync.lastScale,
    };
  }

  /** Run a pending rollback immediately — does not require accumulator budget. */
  private reconcilePending(): boolean {
    if (!this.reconciler.needsRollback(this.room.tick)) return false;
    return this.processRollback();
  }

  /**
   * Process a single simulation tick, or a replay batch if a rollback
   * is pending. Returns true if tick(s) were processed.
   */
  private processNextTick(): boolean {
    if (this.reconciler.needsRollback(this.room.tick)) {
      return this.processRollback();
    }
    if (this.clock.pendingTicks() <= 0) return false;

    this.forwardPipeline.preTick(this.room, this.reconciler);
    this.forwardPipeline.tick(this.room, this.forwardSource);
    this.forwardPipeline.postTick(this.room, this.reconciler);

    this.clock.consumeTicks(1);
    return true;
  }

  /** Rewind to the best anchor and replay forward to the current tick. */
  private processRollback(): boolean {
    const pendingTick = this.reconciler.getPendingResimTick()!;
    let anchor = this.reconciler.findAnchor(pendingTick);
    if (!anchor) {
      anchor = this.reconciler.findOldestAnchor();
      if (!anchor) {
        console.warn(
          `[ClientSim] rollback DEFERRED — no snapshots | pendingResim=${pendingTick} ` +
            `room.tick=${this.room.tick} pendingAcc=${this.clock.pendingTicks()}`
        );
        return false;
      }
      console.warn(
        `[ClientSim] rollback CLAMPED — no anchor ≤ ${pendingTick}, using ${anchor.tick} | ` +
          `room.tick=${this.room.tick} pendingAcc=${this.clock.pendingTicks()}`
      );
    }

    const currentTick = this.room.tick;
    const replayLen = currentTick - anchor.tick;
    console.warn(
      `[ClientSim] rollback START | anchor=${anchor.tick} → current=${currentTick} ` +
        `replay=${replayLen}t pendingResim=${pendingTick} pendingAcc=${this.clock.pendingTicks()}`
    );

    this.reconciler.rewind(this.room, anchor);
    this.reconciler.isReplaying = true;

    while (this.room.tick < currentTick) {
      this.replayPipeline.preTick(this.room, this.reconciler);
      this.replayPipeline.tick(this.room, this.replaySource);
      this.replayPipeline.postTick(this.room, this.reconciler);
    }

    const consumed = this.clock.consumeTicks(replayLen);
    this.reconciler.isReplaying = false;
    this.reconciler.clearPendingResim();

    console.warn(
      `[ClientSim] rollback DONE | room.tick=${this.room.tick} replayed=${replayLen}t consumed=${consumed}t`
    );
    return true;
  }

  private wirePlayer(): void {
    const eid = PlayerSystem.getPlayerEidByStringId(this.room, this.sessionToken);
    this.localPlayerEid = eid ?? -1;
    this.localPlayerId = this.sessionToken;
    this.reconciler.setLocalPlayer(this.sessionToken);

    // Capture render state on *both* pipelines.
    // The forward pipeline handles normal predicted ticks.
    // The replay pipeline is used during rollbacks/reconciliation: diffs are applied
    // in preTick, systems run with authoritative state (including corrected local player),
    // and postTick now triggers captureRenderState for each resimmed tick.
    // This emits TickRenderOutput for the historical ticks with post-rollback data.
    // The worker sends them in the next batch; the renderer's _renderRing then
    // records the corrected local (and remote) data via record() for those exact ticks,
    // so lagged local render at (current - leadTicks) sees authoritative history.
    const onTick = (tick: number) => {
      this.pendingOutputs.push(this.captureRenderState(tick));
    };
    this.forwardPipeline.setOnTick(onTick);
    this.replayPipeline.setOnTick(onTick);
  }

  private captureRenderState(tick: number): TickRenderOutput {
    const players: PlayerRenderDatum[] = [];

    for (const eid of query(this.room.world, [Player])) {
      const trailLen = (TrailPointsXs.data[eid] ?? []).length;

      this.lastTrailLengths.set(eid, trailLen);

      players.push({
        eid,
        tick,
        x: Position.x[eid] ?? 0,
        y: Position.y[eid] ?? 0,
        direction: Direction[eid] ?? 0,
        color: Color[eid] ?? 0xffffff,
        speedMult: SpeedMult[eid] ?? 1,
        rubber: Rubber[eid] ?? 0,
        isColliding: IsColliding[eid] === 1,
        isAlive: IsAlive[eid] === 1,
        playerId: PlayerId[eid] ?? '',
        tickTimeMs: this.clock.tickTimeMs,
        vx: Velocity.vx[eid] ?? 0,
        vy: Velocity.vy[eid] ?? 0,
        trailXs: [...(TrailPointsXs.data[eid] ?? [])],
        trailYs: [...(TrailPointsYs.data[eid] ?? [])],
      });
    }

    return { tick, players, events: [] };
  }

  private takeRenderBatch(): TickRenderOutput[] {
    const batch = this.pendingOutputs;
    this.pendingOutputs = [];
    return batch;
  }
}
