import type { SimulationContext } from './SimulationContext';
import type { GameEvent } from './GameEvent';
import type { PlayerInput } from './PlayerInput';

export type inputGetter = (entityId: string) => PlayerInput | null;
export type eventGetter = () => readonly GameEvent[] | [];

export abstract class System {
  key: string;
  abstract getComponents(): object[];
  abstract update?(getInput: inputGetter, getEvents: eventGetter): void;
  abstract init?(ctx: SimulationContext): void;
}

export abstract class SystemSerializable extends System {
  abstract serialize(ctx: SimulationContext, eids: readonly number[]): ArrayBuffer;
  abstract deserialize(ctx: SimulationContext, buffer: ArrayBuffer): Map<number, number>;
}
