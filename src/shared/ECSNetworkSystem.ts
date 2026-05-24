import { query, removeEntity } from 'bitecs';
import { TickRingBuffer } from './TickRingBuffer';
import { ECSGameWorld } from './ECSGameWorld';
import PlayerSystem from './ECSPlayerSystem';
import { System, GetInput, GetEvents } from './ECSSystem';
import { GameEventType } from './GameEvent';

export const Networked = {};
export const NetworkUpdated = {};

export class NetworkDiffTickRingBuffer extends TickRingBuffer<NetworkDiffPayload> {
  constructor(capacity = 1024) {
    super(capacity);
  }
}
export interface NetworkDiffPayload {
  tick: number;
  data: ArrayBuffer;
  struct: ArrayBuffer;
}

export class ECSNetworkSystem extends System {
  readonly key = 'network';

  getComponents(): object[] {
    return [NetworkUpdated];
  }

  update(world: ECSGameWorld, _getInput?: GetInput, _getEvents?: GetEvents): void {
    if (_getEvents) {
      for (const event of _getEvents()) {
        continue;
      }
    }
  }
}
