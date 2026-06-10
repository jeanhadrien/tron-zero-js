import { createWorld, createEntityIndex, resetWorld, World } from 'bitecs';
import {
  createSnapshotSerializer,
  createSnapshotDeserializer,
  createObserverSerializer,
  createSoASerializer,
  createObserverDeserializer,
  createSoADeserializer,
} from 'bitecs/serialization';

import type { System } from './interfaces/System';
import { Networked } from './interfaces/Network';
import type { PlayerInput } from './interfaces/PlayerInput';
import { PlayerInputTickRingBuffer } from './PlayerInputBuffer';
import type { GameEvent } from './interfaces/GameEvent';
import { GameEventTickRingBuffer } from './GameEventBuffer';
import type { SimulationContext } from './interfaces/SimulationContext';
import type { ISpatialQuery } from './spatial/SpatialQuery';
import type { ISpatialGridMutator } from './spatial/SpatialGridMutator';
import { GameEventType } from './interfaces/GameEvent';
import { RoomLogger } from './otel/Logger';
import PlayerSystem from './systems/PlayerSystem';
import type GameClock from './GameClock';

const SNAPSHOT_BUFFER_SIZE = 1024 * 1024 * 5;
const DIFF_BUFFER_SIZE = 1024 * 1024 * 5;

const logger = new RoomLogger('GameRoom');

interface UpdateHooks {
  /** Override how input is resolved for each entity (client injects local prediction here). */
  resolveInput?: (playerId: string) => PlayerInput | null;
  /** Called after tick increments (client hooks render capture here). */
  postTick?: (tick: number) => void;
}

export class ECSGameRoom implements SimulationContext {
  clock: GameClock;
  world: World;
  playerInputBuffer: PlayerInputTickRingBuffer;
  gameEventBuffer: GameEventTickRingBuffer;
  entityIndex: object;
  systems: System[];
  components: object[];
  tick: number = 0;

  /** Entities that were modified this tick. Server reads this to build diffs. */
  dirtyEntities: Set<number>;

  spatialQuery?: ISpatialQuery;
  spatialGrid?: ISpatialGridMutator;
  ticksInBatch = 1;

  snapshotSerialize: (selectedEntities?: readonly number[]) => ArrayBuffer;
  snapshotDeserialize: (packet: ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number>;
  soaSerialize: (indices: number[] | readonly number[]) => ArrayBuffer;
  soaDeserialize: (packet: ArrayBuffer, entityIdMapping?: Map<number, number>) => void;
  observerSerializeNetwork: () => ArrayBuffer;
  observerDeserializeNetwork: (packet: ArrayBuffer, idMap?: Map<number, number>) => Map<number, number>;

  constructor(clock: GameClock, systems: System[] = []) {
    this.clock = clock;
    this.dirtyEntities = new Set<number>();
    this.systems = systems;
    this.playerInputBuffer = new PlayerInputTickRingBuffer(64);
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

    this.snapshotSerialize = createSnapshotSerializer(
      this.world,
      this.components,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.snapshotDeserialize = createSnapshotDeserializer(this.world, this.components);

    this.observerSerializeNetwork = createObserverSerializer(this.world, Networked, this.components);
    this.observerDeserializeNetwork = createObserverDeserializer(this.world, Networked, this.components);

    logger.setRoom(this);

    for (const sys of this.systems) {
      sys.init?.(this);
    }
    this.spatialGrid?.rebuildFromWorld(this);
  }

  /** Queue an authoritative input to be consumed during the next update cycle. */
  addInput(input: PlayerInput): void {
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

  /** Queue an event to be consumed during the next update cycle. */
  addEvent(event: GameEvent): void {
    if (event.tick < this.tick) {
      logger.error('ignoring event', event);
      return;
    }
    this.gameEventBuffer.record(event.tick, event);
    logger.debug('event at tick', event.tick, 'of type ', GameEventType[event.type]);
  }

  /**
   * Advance the simulation by one tick.
   *
   * @param hooks  Client-side injection points: resolveInput for local
   *               prediction, postTick for render capture. Server-side
   *               callers omit these.
   */
  update(hooks?: UpdateHooks): void {
    const resolveInput = hooks?.resolveInput ?? ((id: string) => this.playerInputBuffer.get(this.tick, id));
    const events = () => this.gameEventBuffer.get(this.tick);

    for (const sys of this.systems) {
      if (sys.update) sys.update(resolveInput, events);
    }

    this.tick += 1;
    hooks?.postTick?.(this.tick);
    this.dirtyEntities.clear();
  }

  /** Reset the world to a blank slate (used before loading a snapshot). */
  resetWorld(): void {
    resetWorld(this.world);
  }

  /** Rebuild snapshot serializers after a world reset (the old ones reference stale world state). */
  rebuildSerializers(): void {
    this.snapshotSerialize = createSnapshotSerializer(
      this.world,
      this.components,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.snapshotDeserialize = createSnapshotDeserializer(this.world, this.components);
  }
}
