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

import { WorldStateTickRingBuffer } from './WorldStateBuffer';
import { System } from './interfaces/System';
import { NetworkDiffPayload } from './interfaces/Network';
import { NetworkDiffTickRingBuffer } from './interfaces/Network';
import { PlayerInput } from './interfaces/PlayerInput';
import { PlayerInputTickRingBuffer } from './PlayerInputBuffer';
import { GameEvent, GameEventType } from './interfaces/GameEvent';
import { GameEventTickRingBuffer } from './GameEventBuffer';
import { Networked } from './interfaces/Network';
import { RoomLogger } from './otel/Logger';
import PlayerSystem, { PingInTicks } from './systems/PlayerSystem';
import GameClock from './GameClock';

const logger = new RoomLogger('GameRoom');

export class ECSGameRoom {
  clock: GameClock;
  private networkDiffEmitter = new EventEmitter<string>();
  private pendingResimTick: number | null = null;
  world: World;
  worldBuffer: WorldStateTickRingBuffer;
  playerInputBuffer: PlayerInputTickRingBuffer;
  networkDiffTickRingBuffer: NetworkDiffTickRingBuffer;
  gameEventBuffer: GameEventTickRingBuffer;
  entityIndex: object;
  systems: System[];
  components: object[];
  replaying: boolean;
  tick: number = 0;
  snapshotBuffer: WorldStateTickRingBuffer;
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
    this.worldBuffer = new WorldStateTickRingBuffer(128);
    this.playerInputBuffer = new PlayerInputTickRingBuffer(128);
    this.networkDiffTickRingBuffer = new NetworkDiffTickRingBuffer(128);
    this.gameEventBuffer = new GameEventTickRingBuffer(128);
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

    // Initialize all systems before anything else runs
    for (const sys of this.systems) {
      sys.init?.(this);
    }
  }

  initFromSnapshot(tick: number, buffer: ArrayBuffer): void {
    resetWorld(this.world);
    this.snapshotDeserialize(buffer);
    this.tick = tick;
    // Record the initial state so replayFrom can roll back to this tick
    this.worldBuffer.record(tick, this.snapshotSerialize());
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
    const input = (entityId: string) => this.playerInputBuffer.get(this.tick, entityId);
    const events = () => this.gameEventBuffer.get(this.tick);
    for (const sys of this.systems) {
      if (sys.update) sys?.update(input, events);
    }
    this.tick += 1;
  }

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
      this.worldBuffer.record(this.tick, this.snapshotSerialize());
    }
  }

  private replayFrom(pastTick: number): void {
    const snapshot = this.worldBuffer.get(pastTick);
    const currentTick = this.tick;
    if (!snapshot) {
      logger.error(`No snapshot found for tick ${pastTick}, cannot resimulate.`);
      return;
    }

    // Load past world
    resetWorld(this.world);
    this.dirtyEntities.clear();
    this.replaying = true;

    this.snapshotDeserialize(snapshot, new Map());
    this.tick = pastTick;

    if (this.tick !== pastTick) throw new Error('Snapshot is not the tick we expected');

    logger.debug(`Replaying from ${pastTick} to ${currentTick} (${currentTick - pastTick} ticks)`);
    for (let _tick = this.tick; _tick < currentTick; _tick++) {
      // Load authorithative state diffs from server
      const diff = this.networkDiffTickRingBuffer.get(_tick, 'network');
      if (diff) {
        this.soaDeserialize(diff.data);
        this.observerDeserializeNetwork(diff.struct, new Map());
      }
      this.update();
      // Updated buffered world snapshots with the new state
      this.worldBuffer.record(this.tick, this.snapshotSerialize());
    }
    this.replaying = false;
  }
}
