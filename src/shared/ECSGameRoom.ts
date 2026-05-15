import { EventEmitter } from 'eventemitter3';
import { GameEventBus } from './GameEventBus';
import GameClock from './GameClock';
import { PlayerEventBus } from './PlayerStateEventBus';

import { createWorld, createEntityIndex, resetWorld } from 'bitecs';
import { createSnapshotSerializer, createSnapshotDeserializer } from 'bitecs/serialization';

const SNAPSHOT_BUFFER_SIZE = 1024 * 1024 * 5; //  avoids 100MB default in bitecs that kills perf via slice()
import { ECSGameWorld } from './ECSGameWorld';
import { WorldStateTickRingBuffer } from './WorldStateBuffer';
import { System, SystemDiffPayload, SystemSerializable } from './ECSSystem';
import { PlayerInput } from './PlayerInput';
import { PlayerInputTickRingBuffer } from './PlayerInputBuffer';
import { GameEvent } from './GameEvent';
import { GameEventTickRingBuffer } from './GameEventBuffer';

interface ECSGameRoomEvents {
  delta: (deltas: SystemDiffPayload[]) => void;
}

export default class ECSGameRoom {
  playerEventBus: PlayerEventBus;
  gameEventBus: GameEventBus;
  gameClock: GameClock;
  private deltasEmitter = new EventEmitter<ECSGameRoomEvents>();
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
    onDeltas?: (deltas: SystemDiffPayload[]) => void
  ) {
    if (onDeltas) this.deltasEmitter.on('delta', onDeltas);
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
    this.worldSnapshotSerializer = createSnapshotSerializer(
      this.world,
      this.worldComponents,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.worldSnapshotDeserializer = createSnapshotDeserializer(this.world, this.worldComponents);

    this.cursorWorld = createWorld(
      {
        tick: 0,
        tickTimeMs: this.gameClock.tickTimeMs,
      },
      this.worldEntityIndex
    );
    this.cursorSnapshotSerializer = createSnapshotSerializer(
      this.cursorWorld,
      this.worldComponents,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.cursorSnapshotDeserializer = createSnapshotDeserializer(this.cursorWorld, this.worldComponents);

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
    this.worldSnapshotDeserializer(buffer);
    this.world.tick = tick;

    // The old serializer/deserializer captured references to component stores
    // that are still valid, but we rebuild them to be safe.
    this.worldSnapshotSerializer = createSnapshotSerializer(
      this.world,
      this.worldComponents,
      new ArrayBuffer(SNAPSHOT_BUFFER_SIZE)
    );
    this.worldSnapshotDeserializer = createSnapshotDeserializer(this.world, this.worldComponents);
  }

  onDelta(handler: (deltas: SystemDiffPayload[]) => void): void {
    this.deltasEmitter.on('delta', handler);
  }

  offDelta(handler: (deltas: SystemDiffPayload[]) => void): void {
    this.deltasEmitter.off('delta', handler);
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
      console.log('resim', this.world.tick - this.pendingResimTick);
      this.pendingResimTick = null;
      // Prevent death spiral: sync game clock with world tick after resimulation
      // so the time spent resimulating doesn't compound into extra tick processing.
      // Without this, gameClock.tick falls behind world.tick during resim, and
      // the next gameClock.update(deltaTime) produces too many catch-up ticks,
      // widening the gap for the next input that arrives from the client.
      this.gameClock.setTick(this.world.tick);
      this.gameClock.resetAccumulator();
    }

    const ticksToProcess = this.gameClock.update(deltaTime);
    for (let index = 0; index < ticksToProcess; index++) {
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

    this.deltasEmitter.emit('delta', this.buildDiffPayloads());
  }
}
