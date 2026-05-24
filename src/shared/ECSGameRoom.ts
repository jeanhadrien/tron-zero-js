import { EventEmitter } from 'eventemitter3';
import { GameEventBus } from './GameEventBus';
import GameClock from './GameClock';
import { PlayerEventBus } from './PlayerStateEventBus';

import { createWorld, createEntityIndex, resetWorld } from 'bitecs';
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

import { ECSGameWorld } from './ECSGameWorld';
import { WorldStateTickRingBuffer } from './WorldStateBuffer';
import { System } from './ECSSystem';
import { NetworkDiffPayload } from './ECSNetworkSystem';
import { NetworkDiffTickRingBuffer } from './ECSNetworkSystem';
import { PlayerInput } from './PlayerInput';
import { PlayerInputTickRingBuffer } from './PlayerInputBuffer';
import { GameEvent, GameEventType } from './GameEvent';
import { GameEventTickRingBuffer } from './GameEventBuffer';
import { Networked } from './ECSNetworkSystem';
import { TickLogger } from './otel/Logger';
import PlayerSystem, { PingInTicks } from './ECSPlayerSystem';

const logger = new TickLogger('GameRoom');

export default class ECSGameRoom {
  playerEventBus: PlayerEventBus;
  gameEventBus: GameEventBus;
  gameClock: GameClock;
  private networkDiffEmitter = new EventEmitter<string>();
  private pendingResimTick: number | null = null;
  world: ECSGameWorld;
  worldBuffer: WorldStateTickRingBuffer;
  playerInputBuffer: PlayerInputTickRingBuffer;
  networkDiffTickRingBuffer: NetworkDiffTickRingBuffer;
  gameEventBuffer: GameEventTickRingBuffer;
  worldEntityIndex: object;
  systems: System[];
  worldComponents: object[];
  worldSnapshotSerialize: (selectedEntities?: readonly number[]) => ArrayBuffer;
  worldSnapshotDeserialize: (packet: ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number>;

  worldObserverSerializeNet;
  worldSoASerializeDiff;
  worldObserverDeserializeNet;
  worldSoADeserialize: (packet: ArrayBuffer, entityIdMapping?: Map<number, number>) => void;

  constructor(
    bus: GameEventBus,
    clock: GameClock,
    systems: System[] = [],
    onDeltas?: (deltas: NetworkDiffPayload[]) => void
  ) {
    if (onDeltas) this.networkDiffEmitter.on('diff', onDeltas);
    this.gameEventBus = bus;
    this.playerEventBus = new PlayerEventBus();
    this.gameClock = clock;

    this.systems = systems;
    this.worldBuffer = new WorldStateTickRingBuffer(128);
    this.playerInputBuffer = new PlayerInputTickRingBuffer(128);
    this.networkDiffTickRingBuffer = new NetworkDiffTickRingBuffer(128);
    this.gameEventBuffer = new GameEventTickRingBuffer(128);

    this.worldEntityIndex = createEntityIndex();
    this.world = createWorld(
      {
        tick: 0,
        tickTimeMs: this.gameClock.tickTimeMs,
        dirtyEntities: new Set<number>(),
      },
      this.worldEntityIndex
    );
    this.worldComponents = systems.flatMap((s) => s.getComponents());
    this.worldSnapshotSerialize = createSnapshotSerializer(
      this.world,
      this.worldComponents,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.worldSnapshotDeserialize = createSnapshotDeserializer(this.world, this.worldComponents);

    this.worldObserverSerializeNet = createObserverSerializer(this.world, Networked, this.worldComponents);
    this.worldObserverDeserializeNet = createObserverDeserializer(this.world, Networked, this.worldComponents);

    this.worldSoASerializeDiff = createSoASerializer(this.worldComponents, {
      diff: false,
      buffer: new ArrayBuffer(DIFF_BUFFER_SIZE),
      epsilon: 0,
    });
    this.worldSoADeserialize = createSoADeserializer(this.worldComponents, { diff: false });

    logger.setWorld(this.world);

    // Initialize all systems before anything else runs
    for (const sys of this.systems) {
      sys.init?.(this.world);
    }
  }

  /** Replace the current world with a server-provided full snapshot.
   *  Resets the world, then deserializes the buffer. Sets world.tick to the
   *  given tick without advancing the game clock (caller should also
   *  gameClock.setTick(tick) to keep them in sync). */
  initFromSnapshot(tick: number, buffer: ArrayBuffer): void {
    resetWorld(this.world);
    this.worldSnapshotDeserialize(buffer);
    this.world.tick = tick;
    // Record the initial state so replayFrom can roll back to this tick
    this.worldBuffer.record(tick, this.worldSnapshotSerialize());
    // Rebuild serializers (existing code)
    this.worldSnapshotSerialize = createSnapshotSerializer(
      this.world,
      this.worldComponents,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.worldSnapshotDeserialize = createSnapshotDeserializer(this.world, this.worldComponents);
  }

  onNetworkDiff(handler: (diff: NetworkDiffPayload) => void): void {
    this.networkDiffEmitter.on('diff', handler);
  }

  offNetworkDiff(handler: (diff: NetworkDiffPayload) => void): void {
    this.networkDiffEmitter.off('diff', handler);
  }

  addEvent(tick: number, event: GameEvent): void {
    this.gameEventBuffer.record(tick, event);
    logger.debug('event at tick', tick, 'of type ', GameEventType[event.type]);
    // Event at tick T is consumed during the update that transitions T-1 → T.
    const resimTick = tick - 1;
    if (resimTick <= this.world.tick) {
      logger.debug('=> ');
      this.pendingResimTick = this.pendingResimTick === null ? resimTick : Math.min(this.pendingResimTick, resimTick);
    }
  }

  addInput(tick: number, playerId: string, input: PlayerInput): void {
    this.playerInputBuffer.record(tick, playerId, input);
    logger.warn('input at tick', tick, 'for player', playerId, input.turn, input.break);
    const eid = PlayerSystem.getPlayerEidByStringId(this.world, playerId);
    if (!eid) {
      logger.warn('No player for input', eid);
      return;
    }
    PingInTicks[eid] = Math.max(0, this.world.tick - tick);
    const resimTick = tick - 1;
    if (resimTick <= this.world.tick) {
      this.pendingResimTick = this.pendingResimTick === null ? resimTick : Math.min(this.pendingResimTick, resimTick);
    }
  }

  addNetworkDiffPayloads(diffs: NetworkDiffPayload[]): void {
    for (const d of diffs) {
      this.addNetworkDiffPayload(d);
    }
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
    if (resimTick < this.world.tick) {
      this.pendingResimTick = this.pendingResimTick === null ? resimTick : Math.min(this.pendingResimTick, resimTick);
    }
  }

  /**
   * Runs the world for the current world tick and then updates the world tick.
   * When reading the world tick externally, the simulation has not happened yet for that tick.
   * This means it is safe to add events or inputs for that tick that the systems will read.
   * @param world
   */
  private update(world: ECSGameWorld): void {
    const input = (entityId: string) => this.playerInputBuffer.get(world.tick, entityId);
    const events = () => this.gameEventBuffer.get(world.tick);
    for (const sys of this.systems) {
      sys.update(world, input, events);
    }
    world.tick += 1;
  }

  updateFixed(deltaTime: number): void {
    if (this.pendingResimTick !== null && this.world.tick > this.pendingResimTick) {
      logger.info('replaying from', this.pendingResimTick);
      this.replayFrom(this.pendingResimTick);
      this.pendingResimTick = null;
    }

    const ticksToProcess = this.gameClock.update(deltaTime);
    for (let index = 0; index < ticksToProcess; index++) {
      this.update(this.world);
      this.worldBuffer.record(this.world.tick, this.worldSnapshotSerialize());
    }

    const diff = this.getSerializedDiffs();
    if (diff.struct.byteLength > 0 || diff.data.byteLength > 0) {
      this.networkDiffEmitter.emit('diff', diff);
    }
  }

  /** Computes internally-tracked entity updates. Each calls computes a new diff.*/
  getSerializedDiffs() {
    const dirtyEntities = [...this.world.dirtyEntities];
    this.world.dirtyEntities.clear();
    return {
      tick: this.world.tick,
      struct: this.worldObserverSerializeNet(),
      data: this.worldSoASerializeDiff(dirtyEntities),
    };
  }

  private replayFrom(pastTick: number): void {
    const snapshot = this.worldBuffer.get(pastTick);
    const currentTick = this.world.tick;
    if (!snapshot) {
      logger.error(`No snapshot found for tick ${pastTick}, cannot resimulate.`);
      return;
    }

    // Load past world
    resetWorld(this.world);
    this.world.dirtyEntities.clear();

    this.worldSnapshotDeserialize(snapshot, new Map());
    this.world.tick = pastTick;

    if (this.world.tick !== pastTick) throw new Error('Snapshot is not the tick we expected');

    logger.info(`Replaying from ${pastTick} to ${currentTick} (${currentTick - pastTick} ticks)`);
    for (let _tick = this.world.tick; _tick < currentTick; _tick++) {
      // Load authorithative state diffs from server
      const diff = this.networkDiffTickRingBuffer.get(_tick, 'network');
      if (diff) {
        this.worldSoADeserialize(diff.data);
        this.worldObserverDeserializeNet(diff.struct, new Map());
      }
      this.update(this.world);
      // Updated buffered world snapshots with the new state
      this.worldBuffer.record(this.world.tick, this.worldSnapshotSerialize());
    }
  }
}
