import { ECSGameRoom } from './ECSGameRoom';
import { GameEvent } from './GameEvent';
import { PlayerInput } from './PlayerInput';

export type inputGetter = (entityId: string) => PlayerInput | null;
export type eventGetter = () => readonly GameEvent[] | [];

export abstract class System {
  key: string;
  abstract getComponents(): object[];
  abstract update?(getInput: inputGetter, getEvents: eventGetter): void;
  abstract init?(room: ECSGameRoom): void;
}

export abstract class SystemSerializable extends System {
  abstract serialize(room: ECSGameRoom, eids: readonly number[]): ArrayBuffer;
  abstract deserialize(room: ECSGameRoom, buffer: ArrayBuffer): Map<number, number>;
}
