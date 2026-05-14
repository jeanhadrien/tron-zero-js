import { ECSGameWorld } from './ECSGameWorld';
import { GameEvent } from './GameEvent';

export type GetInput = (entityId: string) => any;

export type GetEvents = () => readonly GameEvent[];

export interface SystemDiffPayload {
  systemKey: string;
  buffer: ArrayBuffer;
}

export abstract class System {
  key: string;
  abstract getComponents(): {}[];
  abstract update(world: ECSGameWorld, getInput?: GetInput, getEvents?: GetEvents): void;
  init?(world: ECSGameWorld): void;
}

export abstract class SystemSerializable extends System {
  abstract diff(worldA: ECSGameWorld, worldB: ECSGameWorld): number[];
  abstract serialize(world: ECSGameWorld, eids: readonly number[]): ArrayBuffer;
  abstract deserialize(world: ECSGameWorld, buffer: ArrayBuffer): Map<number, number>;
}
