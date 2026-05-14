import { GameEventBus } from './GameEventBus';
import GameClock from './GameClock';
import { PlayerEventBus } from './PlayerStateEventBus';

import { createWorld, createEntityIndex, resetWorld } from 'bitecs';
import { ECSGameWorld } from './ECSGameWorld';
import { WorldStateTickRingBuffer } from './WorldStateBuffer';
import { createSnapshotDeserializer, createSnapshotSerializer } from 'bitecs/serialization';
import { System, SystemDiffPayload, SystemSerializable } from './ECSSystem';
import { PlayerInput } from './PlayerInput';
import { PlayerInputTickRingBuffer } from './PlayerInputBuffer';
import { GameEvent } from './GameEvent';
import { GameEventTickRingBuffer } from './GameEventBuffer';

type DeltasHandler = (deltas: SystemDiffPayload[]) => void;

export default class ECSGameRoom {
  playerEventBus: PlayerEventBus;
  gameEventBus: GameEventBus;
  gameClock: GameClock;
  private pendingResimTick: number | null = null;
  world: ECSGameWorld;
  cursorWorld: ECSGameWorld;
  worldBuffer: WorldStateTickRingBuffer;
  playerInputBuffer: PlayerInputTickRingBuffer;
  gameEventBuffer: GameEventTickRingBuffer;
  worldEntityIndex: any;
  systems: System[];
  worldComponents: {}[];
  worldSnapshotSerializer: (selectedEntities?: readonly number[]) => ArrayBuffer;
  cursorSnapshotSerializer: (selectedEntities?: readonly number[]) => ArrayBuffer;
  worldSnapshotDeserializer: (packet: ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number>;
  cursorSnapshotDeserializer: (packet: ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number>;

  constructor(
    bus: GameEventBus,
    clock: GameClock,
    systems: System[] = [],
    private onDeltas?: DeltasHandler
  ) {
    this.gameEventBus = bus;
    this.playerEventBus = new PlayerEventBus();
    this.gameClock = clock;
    this.systems = systems;
    this.worldBuffer = new WorldStateTickRingBuffer(128);
    this.playerInputBuffer = new PlayerInputTickRingBuffer(128);
    this.gameEventBuffer = new GameEventTickRingBuffer(128);
    this.worldEntityIndex = createEntityIndex();
    this.world = createWorld(
      {
        tick: 0,
        tickTimeMs: this.gameClock.tickTimeMs,
      },
      this.worldEntityIndex
    );
    this.worldComponents = systems.flatMap((s) => s.getComponents());
    this.worldSnapshotSerializer = createSnapshotSerializer(this.world, this.worldComponents);
    this.worldSnapshotDeserializer = createSnapshotDeserializer(this.world, this.worldComponents);

    this.cursorWorld = createWorld(
      {
        tick: 0,
        tickTimeMs: this.gameClock.tickTimeMs,
      },
      this.worldEntityIndex
    );
    this.cursorSnapshotSerializer = createSnapshotSerializer(this.cursorWorld, this.worldComponents);
    this.cursorSnapshotDeserializer = createSnapshotDeserializer(this.cursorWorld, this.worldComponents);

    // Initialize all systems before anything else runs
    for (const sys of this.systems) {
      sys.init?.(this.world);
    }
  }

  addEvent(tick: number, event: GameEvent): void {
    this.gameEventBuffer.record(tick, event);
    if (tick < this.world.tick) {
      this.pendingResimTick = this.pendingResimTick === null ? tick : Math.min(this.pendingResimTick, tick);
    }
  }

  addInput(tick: number, playerId: string, input: PlayerInput): void {
    this.playerInputBuffer.record(tick, playerId, input);
    if (tick < this.world.tick) {
      this.pendingResimTick = this.pendingResimTick === null ? tick : Math.min(this.pendingResimTick, tick);
    }
  }

  private update(world: ECSGameWorld): void {
    world.tick += 1;
    const input = (entityId: string) => this.playerInputBuffer.get(world.tick, entityId);
    const events = () => this.gameEventBuffer.get(world.tick);
    for (const sys of this.systems) {
      sys.update(world, input, events);
    }
  }

  updateFixed(deltaTime: number): void {
    if (this.pendingResimTick !== null) {
      this.resimulateForwardFrom(this.pendingResimTick);
      this.pendingResimTick = null;
    }

    const ticksToProcess = this.gameClock.update(deltaTime);
    for (let index = -1; index < ticksToProcess; index++) {
      this.update(this.world);
      this.worldBuffer.record(this.world.tick, this.worldSnapshotSerializer());
    }
  }

  private buildDiffPayloads(): SystemDiffPayload[] {
    const payloads: SystemDiffPayload[] = [];
    for (const sys of this.systems) {
      if (!(sys instanceof SystemSerializable)) continue;
      const changedEids = sys.diff(this.cursorWorld, this.world);
      if (changedEids.length === 0) continue;
      const buffer = sys.serialize(this.world, changedEids);
      payloads.push({ systemKey: sys.key, buffer });
    }
    return payloads;
  }

  private resimulateForwardFrom(pastTick: number): void {
    const snapshot = this.worldBuffer.get(pastTick);
    if (!snapshot) return;

    resetWorld(this.cursorWorld);
    this.cursorSnapshotDeserializer(snapshot);
    this.cursorWorld.tick = pastTick;

    const currentTick = this.world.tick;
    for (let tick = pastTick + 1; tick <= currentTick; tick++) {
      this.update(this.cursorWorld);
      this.worldBuffer.record(this.cursorWorld.tick, this.cursorSnapshotSerializer());
    }

    [this.world, this.cursorWorld] = [this.cursorWorld, this.world];
    [this.worldSnapshotSerializer, this.cursorSnapshotSerializer] = [
      this.cursorSnapshotSerializer,
      this.worldSnapshotSerializer,
    ];
    [this.worldSnapshotDeserializer, this.cursorSnapshotDeserializer] = [
      this.cursorSnapshotDeserializer,
      this.worldSnapshotDeserializer,
    ];

    this.onDeltas?.(this.buildDiffPayloads());
  }
}
