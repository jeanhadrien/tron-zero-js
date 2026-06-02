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

export const SNAPSHOT_BUFFER_SIZE = 1024 * 1024 * 5; //  avoids 100MB default in bitecs that kills perf via slice()
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
import PlayerSystem, { Direction, PingInTicks } from './systems/PlayerSystem';
import GameClock from './GameClock';

const logger = new RoomLogger('GameRoom');

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
  /** Ticks in the current replay pass that have server-authoritative state for the local player. */
  private _authStateTicks: Set<number> = new Set();
  tick: number = 0;

  /** Current valid rewind anchor — always positioned ≤ currentTick - gap - 1. */
  private _rewindAnchor: { tick: number; buffer: ArrayBuffer } | null = null;
  /** Next anchor being aged in — promoted to _rewindAnchor once gap+1 ticks have passed. */
  private _nextAnchor: { tick: number; buffer: ArrayBuffer } | null = null;
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

  constructor(clock: GameClock, systems: System[] = [], onDeltas?: (deltas: NetworkDiffPayload[]) => void) {
    if (onDeltas) this.networkDiffEmitter.on('diff', onDeltas);
    this.clock = clock;
    this.dirtyEntities = new Set<number>();
    this.channelPlayerIds = new Map();
    this.systems = systems;
    this.playerInputBuffer = new PlayerInputTickRingBuffer(32);
    this.localInputBuffer = new PlayerInputTickRingBuffer(32); // client only
    this.networkDiffTickRingBuffer = new NetworkDiffTickRingBuffer(32);
    this.gameEventBuffer = new GameEventTickRingBuffer(32);
    this.entityIndex = createEntityIndex();
    this.components = systems.flatMap((s) => s.getComponents());
    this.soaSerialize = createSoASerializer(this.components, {
      diff: true,
      buffer: new ArrayBuffer(DIFF_BUFFER_SIZE),
      epsilon: 0,
    });
    this.soaDeserialize = createSoADeserializer(this.components, { diff: true });

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

    // Initialize all systems before anything else runs
    for (const sys of this.systems) {
      sys.init?.(this);
    }
  }

  initFromSnapshot(tick: number, buffer: ArrayBuffer): void {
    resetWorld(this.world);
    this.snapshotDeserialize(buffer);
    this.tick = tick;
    // Record the initial state as the rewind anchor (immediately valid)
    this._rewindAnchor = { tick, buffer: this.snapshotSerialize() };
    this._nextAnchor = null;
    // Rebuild serializers (existing code)
    this.snapshotSerialize = createSnapshotSerializer(
      this.world,
      this.components,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.snapshotDeserialize = createSnapshotDeserializer(this.world, this.components);
  }

  onNetworkDiff(handler: (diff: NetworkDiffPayload) => void): void {
    this.networkDiffEmitter.on('diff', handler);
  }

  offNetworkDiff(handler: (diff: NetworkDiffPayload) => void): void {
    this.networkDiffEmitter.off('diff', handler);
  }

  serverAddEvent(event: GameEvent): void {
    if (event.tick < this.tick) {
      logger.error('ignoring event', event);
      return;
    }
    this.gameEventBuffer.record(event.tick, event);
    logger.debug('event at tick', event.tick, 'of type ', GameEventType[event.type]);
    // Event at tick T is consumed during the update that transitions T-1 → T.
    const resimTick = event.tick;
    if (resimTick < this.tick) {
      //   this.pendingResimTick = this.pendingResimTick === null ? resimTick : Math.min(this.pendingResimTick, resimTick);
    }
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
    PingInTicks[eid] = Math.max(0, this.tick - input.tick);
    const resimTick = input.tick;
    if (resimTick <= this.tick) {
      //   this.pendingResimTick = this.pendingResimTick === null ? resimTick : Math.min(this.pendingResimTick, resimTick);
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
    const isLocal = (entityId: string) =>
      this.replaying && entityId === this.localPlayerId && this._authStateTicks.has(this.tick);
    const input = (entityId: string) => {
      if (isLocal(entityId)) return this.playerInputBuffer.get(this.tick, entityId);
      return this.localInputBuffer.get(this.tick, entityId) ?? this.playerInputBuffer.get(this.tick, entityId);
    };
    const events = () => this.gameEventBuffer.get(this.tick);
    for (const sys of this.systems) {
      if (sys.update) sys?.update(input, events);
    }
    this.tick += 1;
  }

  /** Batch-mode simulation — consume all accumulated ticks at once (server). */
  updateFixed(deltaTime: number): void {
    if (this.pendingResimTick !== null && this.tick > this.pendingResimTick) {
      this.replayFrom(this.pendingResimTick);
      this.pendingResimTick = null;
    }

    // Also load the diff for current tick
    const diff = this.networkDiffTickRingBuffer.get(this.tick, 'network');
    if (diff) {
      logger.info('loading remote network auth diff');
      this.soaDeserialize(diff.data);
      this.observerDeserializeNetwork(diff.struct, new Map());
    }

    const ticksToProcess = this.clock.update(deltaTime);
    for (let index = 0; index < ticksToProcess; index++) {
      this.update();
      this._tryTakeSnapshot(this.tick);
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
   * Conditionally refresh the rewind anchor snapshot.
   *
   * Uses two slots to avoid the cooldown gap where a freshly-taken snapshot
   * (at currentTick) is too recent to anchor a replay.  _nextAnchor ages
   * for gap+1 ticks before being promoted to _rewindAnchor, guaranteeing at
   * least one valid anchor is always available.
   */
  private _tryTakeSnapshot(currentTick: number): void {
    if (this.snapshotPeriodX <= 0 || this.snapshotGapTicks <= 0) return;

    const gap = this.snapshotGapTicks;

    // Promote the aging candidate once it's old enough to anchor any replay
    if (this._nextAnchor !== null && currentTick - this._nextAnchor.tick >= gap + 1) {
      this._rewindAnchor = this._nextAnchor;
      this._nextAnchor = null;
    }

    // Start aging a new candidate when the current anchor is getting stale
    // (or if we have no anchor at all — edge case before initFromSnapshot)
    const needsCandidate =
      this._nextAnchor === null &&
      (this._rewindAnchor === null || currentTick - this._rewindAnchor.tick > gap + 1 + this.snapshotPeriodX);

    if (needsCandidate) {
      this._nextAnchor = {
        tick: currentTick,
        buffer: this.snapshotSerialize(),
      };
    }
  }

  private replayFrom(pastTick: number): void {
    const currentTick = this.tick;

    if (!this._rewindAnchor) {
      logger.error('No rewind anchor, cannot resimulate.');
      return;
    }

    if (this._rewindAnchor.tick > pastTick) {
      logger.error(`Anchor tick ${this._rewindAnchor.tick} > resim tick ${pastTick}, cannot resimulate.`);
      return;
    }

    // Load past world from rewind anchor
    resetWorld(this.world);
    this.dirtyEntities.clear();
    this._authStateTicks.clear();
    this.replaying = true;

    this.snapshotDeserialize(this._rewindAnchor.buffer, new Map());
    this.tick = this._rewindAnchor.tick;

    logger.debug(`Replaying from ${this._rewindAnchor.tick} to ${currentTick} (${currentTick - this._rewindAnchor.tick} ticks)`);
    for (let _tick = this.tick; _tick < currentTick; _tick++) {
      // Load authorithative state diffs from server
      const diff = this.networkDiffTickRingBuffer.get(_tick, 'network');
      if (diff) {
        const prevDir = this.localPlayerEid >= 0 ? Direction[this.localPlayerEid] : undefined;
        this.soaDeserialize(diff.data);
        this.observerDeserializeNetwork(diff.struct, new Map());
        if (this.localPlayerEid >= 0 && Direction[this.localPlayerEid] !== prevDir) {
          this._authStateTicks.add(_tick);
        }
      }
      this.update();
    }
    this.replaying = false;
  }
}
