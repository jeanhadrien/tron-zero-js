import PlayerStateManager from './PlayerStateManager';
import { GameEventBus } from './GameEventBus';
import GameClock from './GameClock';
import GameArea from './GameArea';
import { PlayerEventBus } from './PlayerStateEventBus';
import { Logger } from './Logger';

import { createWorld, addEntity, addComponent, addComponents, query, World, removeEntity, createEntityIndex, resetWorld } from 'bitecs';
import { createPlayer, getPlayerEidByStringId, PLAYER_COMPONENTS, spawnPlayer, tickPlayerSystem } from './ECSPlayerSystem';
import { ECSGameWorld } from './ECSGameWorld';
import { WorldStateTickRingBuffer } from './WorldStateBuffer';
import { createSnapshotDeserializer, createSnapshotSerializer } from 'bitecs/serialization';

const MIN_COLOR_COMPONENT = 0x66;
const logger = new Logger('GameRoom');

function generatePlayerColor(): number {
  const r = MIN_COLOR_COMPONENT + Math.floor(Math.random() * (0x100 - MIN_COLOR_COMPONENT));
  const g = MIN_COLOR_COMPONENT + Math.floor(Math.random() * (0x100 - MIN_COLOR_COMPONENT));
  const b = MIN_COLOR_COMPONENT + Math.floor(Math.random() * (0x100 - MIN_COLOR_COMPONENT));
  return (r << 16) | (g << 8) | b;
}

export default class GameRoom {
  playerEventBus: PlayerEventBus;
  gameArea: GameArea;
  gameEventBus: GameEventBus;
  gameClock: GameClock;
  world: ECSGameWorld;
  cursorWorld: ECSGameWorld;
  worldBuffer: WorldStateTickRingBuffer;
  worldEntityIndex: any;
  worldComponents: {}[][];
  worldSnapshotSerializer: (selectedEntities?: readonly number[]) => ArrayBuffer;
  worldSnapshotDeserializer: (packet: ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number>;
  cursorSnapshotDeserializer: (packet: ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number>;

  constructor(bus: GameEventBus, area: GameArea, clock: GameClock) {
    this.gameEventBus = bus;
    this.playerEventBus = new PlayerEventBus();
    this.gameArea = area;
    this.gameClock = clock;
    this.worldBuffer = new WorldStateTickRingBuffer(128);
    this.worldEntityIndex = createEntityIndex();
    this.world = createWorld(
      {
        tick: 0,
        tickTimeMs: this.gameClock.tickTimeMs,
        area: this.gameArea,
        turnQueues: new Map(),
      },
      this.worldEntityIndex
    );
    this.worldComponents = [PLAYER_COMPONENTS];
    this.worldSnapshotSerializer = createSnapshotSerializer(this.world, this.worldComponents);
    this.worldSnapshotDeserializer = createSnapshotDeserializer(this.world, this.worldComponents);

    this.cursorWorld = createWorld(
      {
        tick: 0,
        tickTimeMs: this.gameClock.tickTimeMs,
        area: this.gameArea,
        turnQueues: new Map(),
      },
      this.worldEntityIndex
    );
    this.cursorSnapshotDeserializer = createSnapshotDeserializer(this.cursorWorld, this.worldComponents);
  }

  createPlayer(playerId: string) {
    createPlayer(this.world, playerId, generatePlayerColor());
    logger.info('+++ Registered player', playerId);
  }

  spawnPlayer(playerId: string) {
    logger.info('&&& Spawning player', playerId);

    const eid = getPlayerEidByStringId(this.world, playerId);
    spawnPlayer(
      eid,
      100 + Math.random() * (this.gameArea.width - 200),
      100 + Math.random() * (this.gameArea.height - 200),
      Math.floor(Math.random() * 4) * (Math.PI / 2),
      this.gameClock.tickTimeMs
    );
  }

  removePlayerById(playerId: string) {
    let eid = getPlayerEidByStringId(this.world, playerId);
    if (eid >= 0) {
      removeEntity(this.world, eid);
      logger.debug('--- Removed player', playerId);
      return;
    }
    logger.warn(`${playerId} doesn't exist`);
  }

  private tick(world: ECSGameWorld): void {
    tickPlayerSystem(world);
    world.tick += 1;
  }

  updateFixed(deltaTime: number) {
    const ticksToProcess = this.gameClock.update(deltaTime);
    for (let index = 0; index < ticksToProcess; index++) {
      this.tick(this.world);
      this.worldBuffer.record(this.world.tick, this.worldSnapshotSerializer());
    }
  }

  // restore the cursor state to pastTick state taken from the buffer at that tick
  // and simulates forward until this.gameClock.tick (current state)
  // then leave blank for future implementation
  rollback(pastTick: number): void {
    const snapshot = this.worldBuffer.get(pastTick);
    if (!snapshot) return;

    resetWorld(this.cursorWorld);
    this.cursorWorld.turnQueues = new Map();
    this.cursorSnapshotDeserializer(snapshot);
    this.cursorWorld.tick = pastTick;

    const currentTick = this.world.tick;
    for (let tick = pastTick + 1; tick <= currentTick; tick++) {
      this.tick(this.cursorWorld);
    }
  }
}
