import { EventEmitter } from 'eventemitter3';

import { createWorld, createEntityIndex, resetWorld, World } from 'bitecs';
import {
  createSnapshotSerializer,
  createSnapshotDeserializer,
  createObserverSerializer,
  createSoASerializer,
  createObserverDeserializer,
  createSoADeserializer,
} from 'bitecs/serialization';

const SNAPSHOT_BUFFER_SIZE = 1024 * 1024 * 5; //  avoids 100MB default in bitecs that kills perf via slice()
const DIFF_BUFFER_SIZE = 1024 * 1024 * 5;

import { System } from './interfaces/System';
import { NetworkDiffPayload } from './interfaces/Network';
import { NetworkDiffTickRingBuffer } from './interfaces/Network';
import { PlayerInput } from './interfaces/PlayerInput';
import { PlayerInputTickRingBuffer } from './PlayerInputBuffer';
import { GameEvent, GameEventType } from './interfaces/GameEvent';
import { GameEventTickRingBuffer } from './GameEventBuffer';
import { Networked } from './interfaces/Network';
import { RoomLogger } from './otel/Logger';
import PlayerSystem from './systems/PlayerSystem';
import GameClock from './GameClock';

const logger = new RoomLogger('GameRoom');

interface ECSGameRoomOptions {
  onDeltas?: (deltas: NetworkDiffPayload[]) => void;
  /** Minimum wall-clock time of past snapshots to keep (ms). Default 100ms. */
  minSnapshotCoverageMs?: number;
  /** When true, the client simulates local inputs ahead of the server for snappiness. Default false. */
  predictLocalInputs?: boolean;
  /** Minimum number of snapshot slots in the ring buffer. Default 16. */
  snapshotRingCapacity?: number;
}

export class ECSGameRoom {
  clock: GameClock;
  private networkDiffEmitter = new EventEmitter<string>();
  private pendingResimTick: number | null = null;
  world: World;
  playerInputBuffer: PlayerInputTickRingBuffer;
  localInputBuffer: PlayerInputTickRingBuffer;
  networkDiffTickRingBuffer: NetworkDiffTickRingBuffer;
  gameEventBuffer: GameEventTickRingBuffer;
  entityIndex: object;
  systems: System[];
  components: object[];
  replaying: boolean;
  tick: number = 0;
  /** When true, forward-simulated ticks use local-input prediction before server confirmation. */
  predictLocalInputs: boolean = false;

  /** Hook fired after every tick transition (replay or forward). Worker uses this to capture render state. */
  onTick?: (tick: number) => void;

  /** Minimum wall-clock coverage of past snapshots (ms). Ring buffer is sized to hold at least this much history. */
  minSnapshotCoverageMs: number;

  /** Ring buffer of past world snapshots for rollback anchoring. */
  private _snapshotRing: Array<{ tick: number; buffer: ArrayBuffer } | null> = [];
  private _snapshotHead: number = -1;
  private _snapshotCount: number = 0;
  private _lastSnapshotTick: number = -1;
  /** Tick gap between client and server (leadTicks + oneWayTicks). 0 disables snapshotting (server). */
  snapshotGapTicks: number = 0;
  /** Tick period between snapshot refreshes (bounds replay distance). */
  snapshotPeriodX: number = 10;

  snapshotSerialize: (selectedEntities?: readonly number[]) => ArrayBuffer;
  snapshotDeserialize: (packet: ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number>;
  soaSerialize: (indices: number[] | readonly number[]) => ArrayBuffer;
  soaDeserialize: (packet: ArrayBuffer, entityIdMapping?: Map<number, number>) => void;
  observerSerializeNetwork: () => ArrayBuffer;
  observerDeserializeNetwork: (packet: ArrayBuffer, idMap?: Map<number, number>) => Map<number, number>;
  dirtyEntities: Set<number>;
  localPlayerEid: number;
  localPlayerId: string;
  channelPlayerIds: Map<string, string>;

  private static readonly DEFAULT_MIN_SNAPSHOT_COVERAGE_MS = 100;

  constructor(clock: GameClock, systems: System[] = [], options?: ECSGameRoomOptions) {
    if (options?.onDeltas) this.networkDiffEmitter.on('diff', options.onDeltas);
    this.minSnapshotCoverageMs = options?.minSnapshotCoverageMs ?? ECSGameRoom.DEFAULT_MIN_SNAPSHOT_COVERAGE_MS;
    this.predictLocalInputs = options?.predictLocalInputs ?? false;
    this.clock = clock;
    this.dirtyEntities = new Set<number>();
    this.channelPlayerIds = new Map();
    this.systems = systems;
    this.playerInputBuffer = new PlayerInputTickRingBuffer(64);
    this.localInputBuffer = new PlayerInputTickRingBuffer(64); // client only
    this.networkDiffTickRingBuffer = new NetworkDiffTickRingBuffer(64);
    this.gameEventBuffer = new GameEventTickRingBuffer(64);
    this.entityIndex = createEntityIndex();
    this.components = systems.flatMap((s) => s.getComponents());
    this.soaSerialize = createSoASerializer(this.components, {
      diff: false,
      buffer: new ArrayBuffer(DIFF_BUFFER_SIZE),
      epsilon: 0,
    });
    this.soaDeserialize = createSoADeserializer(this.components, { diff: false });

    this.world = createWorld({}, this.entityIndex);
    this.components = systems.flatMap((s) => s.getComponents());
    this.snapshotSerialize = createSnapshotSerializer(
      this.world,
      this.components,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.snapshotDeserialize = createSnapshotDeserializer(this.world, this.components);

    this.observerSerializeNetwork = createObserverSerializer(this.world, Networked, this.components);
    this.observerDeserializeNetwork = createObserverDeserializer(this.world, Networked, this.components);

    logger.setRoom(this);

    // Size snapshot ring: enough slots to cover minCoverageMs even if snapshots are taken infrequently.
    // Conservative: assume snapshotPeriodX could be as low as 1, so slots = coverage in ticks + buffer.
    const minCoverageTicks = Math.ceil(this.minSnapshotCoverageMs / clock.referenceTickTimeMs);
    const maxPeriodTicks = Math.max(1, this.snapshotPeriodX);
    const ringCapacity = Math.max(
      options?.snapshotRingCapacity ?? 16,
      Math.ceil(minCoverageTicks / maxPeriodTicks) + 3
    );
    this._snapshotRing = new Array(ringCapacity).fill(null);

    // Initialize all systems before anything else runs
    for (const sys of this.systems) {
      sys.init?.(this);
    }
  }

  initFromSnapshot(tick: number, buffer: ArrayBuffer): void {
    resetWorld(this.world);
    this.snapshotDeserialize(buffer);
    this.tick = tick;
    // Seed the ring buffer with the initial state
    const initialSnapshot = this.snapshotSerialize();
    this._snapshotHead = 0;
    this._snapshotRing[0] = { tick, buffer: initialSnapshot };
    this._snapshotCount = 1;
    this._lastSnapshotTick = tick;
    // Rebuild serializers
    this.snapshotSerialize = createSnapshotSerializer(
      this.world,
      this.components,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.snapshotDeserialize = createSnapshotDeserializer(this.world, this.components);
  }

  serverAddEvent(event: GameEvent): void {
    if (event.tick < this.tick) {
      logger.error('ignoring event', event);
      return;
    }
    this.gameEventBuffer.record(event.tick, event);
    logger.debug('event at tick', event.tick, 'of type ', GameEventType[event.type]);
  }

  serverAddInput(input: PlayerInput): void {
    if (input.tick < this.tick) {
      logger.error('ignoring input', input);
      return;
    }
    this.playerInputBuffer.record(input.tick, input.playerId, input);
    logger.debug('input at tick', input.tick, 'for player', input.playerId, input.turn, input.break);
    const eid = PlayerSystem.getPlayerEidByStringId(this, input.playerId);
    if (!eid) {
      logger.error('No player for input', eid);
      return;
    }
  }

  /** Store a local-predicted input that is consumed on first read and never replayed. */
  clientAddLocalInput(input: PlayerInput): void {
    this.localInputBuffer.record(input.tick, input.playerId, input);
  }

  // How many players are currently connected (have an active WebRTC channel)
  getPlayerCount(): number {
    return this.channelPlayerIds.size;
  }

  addNetworkDiffPayload(diff: NetworkDiffPayload): void {
    logger.debug(`Applying diff at tick ${diff.tick}`);
    this.networkDiffTickRingBuffer.record(diff.tick, 'network', {
      data: diff.data,
      struct: diff.struct,
      tick: diff.tick,
    });
    // Diff at tick T corrects state after the update that transitions T-1 → T.
    // Roll back to T-1 so the diff is applied at the right point during replay.
    const resimTick = diff.tick - 1;
    if (resimTick < this.tick) {
      this.pendingResimTick = this.pendingResimTick === null ? resimTick : Math.min(this.pendingResimTick, resimTick);
    }
  }

  /**
   * Runs the world for the current world tick and then updates the world tick.
   * When reading the world tick externally, the simulation has not happened yet for that tick.
   * This means it is safe to add events or inputs for that tick that the systems will read.
   * @param world
   */
  private update(): void {
    const input = (entityId: string) => {
      if (this.predictLocalInputs) {
        const local = this.localInputBuffer.get(this.tick, entityId);
        if (local) return local;
      }
      return this.playerInputBuffer.get(this.tick, entityId);
    };
    const events = () => this.gameEventBuffer.get(this.tick);
    for (const sys of this.systems) {
      if (sys.update) sys?.update(input, events);
    }
    this.tick += 1;
    if (!this.replaying) this.onTick?.(this.tick);
    // client-specific because no ClientNetworkSystem consumes it
    this.dirtyEntities.clear();
  }

  /** Batch-mode simulation — consume all accumulated ticks at once (server). */
  updateFixed(deltaTime: number): void {
    if (this.pendingResimTick !== null && this.tick > this.pendingResimTick) {
      this.replayFrom(this.pendingResimTick);
      this.pendingResimTick = null;
    }

    const ticksToProcess = this.clock.update(deltaTime);
    for (let index = 0; index < ticksToProcess; index++) {
      this.update();
      this._tryTakeSnapshot(this.tick);
    }
    // Also load the diff for current tick
    const diff = this.networkDiffTickRingBuffer.get(this.tick, 'network');
    if (diff) {
      logger.info('loading remote network auth diff');
      this.soaDeserialize(diff.data);
      this.observerDeserializeNetwork(diff.struct, new Map());
    }
  }

  /**
   * Per-tick simulation — process a single tick, yielding to the event loop between calls.
   * Designed for the client's {@link setInterval} simulation loop.
   * @returns true if a simulation tick (or replay) was processed, false if idle.
   */
  processNextTick(): boolean {
    // 1. Handle pending resim first (synchronous — may process many ticks)
    if (this.pendingResimTick !== null && this.tick > this.pendingResimTick) {
      this.replayFrom(this.pendingResimTick);
      this.pendingResimTick = null;
      return true;
    }

    // 2. Nothing to do — accumulator hasn't filled a tick yet
    if (this.clock.pendingTicks() <= 0) return false;

    // 3. Load network diff for this specific tick
    const diff = this.networkDiffTickRingBuffer.get(this.tick, 'network');
    if (diff) {
      logger.info('loading remote network auth diff');
      this.soaDeserialize(diff.data);
      this.observerDeserializeNetwork(diff.struct, new Map());
    }

    // 4. Process one tick
    this.update();
    this._tryTakeSnapshot(this.tick);
    this.clock.consumeTicks(1);

    return true;
  }

  /**
   * Take a world snapshot at regular intervals and push it into the ring buffer.
   * The ring keeps multiple past snapshots so rollback anchors are always available
   * even when snapshotGapTicks is small (e.g. local play with near-zero ping).
   */
  private _tryTakeSnapshot(currentTick: number): void {
    if (this.snapshotPeriodX <= 0 || this.snapshotGapTicks <= 0) return;

    // Throttle to snapshotPeriodX interval
    if (this._lastSnapshotTick >= 0 && currentTick - this._lastSnapshotTick < this.snapshotPeriodX) return;

    const buf = this.snapshotSerialize();

    this._snapshotHead = (this._snapshotHead + 1) % this._snapshotRing.length;
    this._snapshotRing[this._snapshotHead] = { tick: currentTick, buffer: buf };
    this._snapshotCount = Math.min(this._snapshotCount + 1, this._snapshotRing.length);
    this._lastSnapshotTick = currentTick;
  }

  /**
   * Find the best rewind anchor: the most recent snapshot whose tick ≤ targetTick.
   * The ring naturally provides ageing — older snapshots have had plenty of time for
   * late network data to arrive.
   */
  private _findBestAnchor(targetTick: number): { tick: number; buffer: ArrayBuffer } | null {
    let best: { tick: number; buffer: ArrayBuffer } | null = null;
    for (let i = 0; i < this._snapshotRing.length; i++) {
      const snap = this._snapshotRing[i];
      if (!snap) continue;
      if (snap.tick <= targetTick && (!best || snap.tick > best.tick)) {
        best = snap;
      }
    }
    return best;
  }

  private replayFrom(pastTick: number): void {
    const currentTick = this.tick;

    const anchor = this._findBestAnchor(pastTick);
    if (!anchor) {
      logger.error(`No snapshot ≤ tick ${pastTick} in ring buffer, cannot resimulate.`);
      return;
    }

    // Load past world from rewind anchor
    resetWorld(this.world);
    this.dirtyEntities.clear();
    this.replaying = true;

    this.snapshotDeserialize(anchor.buffer, new Map());
    this.tick = anchor.tick;

    logger.debug(`Replaying from ${anchor.tick} to ${currentTick} (${currentTick - anchor.tick} ticks)`);
    while (this.tick < currentTick) {
      this.update();
      // Load authorithative state diff for the tick we are about to re-simulate
      const diff = this.networkDiffTickRingBuffer.get(this.tick, 'network');
      if (diff) {
        this.soaDeserialize(diff.data);
        this.observerDeserializeNetwork(diff.struct, new Map());
      }
    }
    this.replaying = false;
  }
}
