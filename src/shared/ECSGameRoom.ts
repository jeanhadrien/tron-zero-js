import { GameEventBus } from './GameEventBus';
import GameClock from './GameClock';
import GameArea from './GameArea';
import { PlayerEventBus } from './PlayerStateEventBus';
import { Logger } from './Logger';

import { createWorld, removeEntity, createEntityIndex, resetWorld } from 'bitecs';
import { ECSGameWorld } from './ECSGameWorld';
import { WorldStateTickRingBuffer } from './WorldStateBuffer';
import { createSnapshotDeserializer, createSnapshotSerializer } from 'bitecs/serialization';
import { System, SystemDiffPayload, SystemSerializable } from './ECSSystem';

const logger = new Logger('GameRoom');

export default class ECSGameRoom {
  playerEventBus: PlayerEventBus;
  gameEventBus: GameEventBus;
  gameClock: GameClock;
  world: ECSGameWorld;
  cursorWorld: ECSGameWorld;
  worldBuffer: WorldStateTickRingBuffer;
  worldEntityIndex: any;
  systems: System[];
  worldComponents: {}[][];
  worldSnapshotSerializer: (selectedEntities?: readonly number[]) => ArrayBuffer;
  worldSnapshotDeserializer: (packet: ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number>;
  cursorSnapshotDeserializer: (packet: ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number>;

  constructor(bus: GameEventBus, clock: GameClock, systems: System[] = []) {
    this.gameEventBus = bus;
    this.playerEventBus = new PlayerEventBus();
    this.gameClock = clock;
    this.systems = systems;
    this.worldBuffer = new WorldStateTickRingBuffer(128);
    this.worldEntityIndex = createEntityIndex();
    this.world = createWorld(
      {
        tick: 0,
        tickTimeMs: this.gameClock.tickTimeMs,
        turnQueues: new Map(),
      },
      this.worldEntityIndex
    );
    this.worldComponents = systems.map((s) => s.getComponents());
    this.worldSnapshotSerializer = createSnapshotSerializer(this.world, this.worldComponents);
    this.worldSnapshotDeserializer = createSnapshotDeserializer(this.world, this.worldComponents);

    this.cursorWorld = createWorld(
      {
        tick: 0,
        tickTimeMs: this.gameClock.tickTimeMs,
        turnQueues: new Map(),
      },
      this.worldEntityIndex
    );
    this.cursorSnapshotDeserializer = createSnapshotDeserializer(this.cursorWorld, this.worldComponents);
  }

  private update(world: ECSGameWorld): void {
    world.tick += 1;
    for (const sys of this.systems) {
      sys.update(world);
    }
  }

  updateFixed(deltaTime: number) {
    const ticksToProcess = this.gameClock.update(deltaTime);
    for (let index = -1; index < ticksToProcess; index++) {
      this.update(this.world);
      this.worldBuffer.record(this.world.tick, this.worldSnapshotSerializer());
    }
  }

  buildDiffPayloads(): SystemDiffPayload[] {
    const payloads: SystemDiffPayload[] = [];
    for (const sys of this.systems) {
      if (!(sys instanceof SystemSerializable)) continue;
      const dirtyEids = sys.diff(this.cursorWorld, this.world);
      if (dirtyEids.length === 0) continue;
      const buffer = sys.serialize(this.world, dirtyEids);
      payloads.push({ systemKey: sys.key, buffer });
    }
    return payloads;
  }

  rollback(pastTick: number): SystemDiffPayload[] {
    const snapshot = this.worldBuffer.get(pastTick);
    if (!snapshot) return [];

    resetWorld(this.cursorWorld);
    this.cursorSnapshotDeserializer(snapshot);
    this.cursorWorld.tick = pastTick;

    const currentTick = this.world.tick;
    for (let tick = pastTick + 1; tick <= currentTick; tick++) {
      this.update(this.cursorWorld);
    }

    return this.buildDiffPayloads();
  }
}
