import { query } from 'bitecs';
import { ECSGameWorld } from './ECSGameWorld';
import { System, GetInput, GetEvents } from './ECSSystem';
import { TickRingBuffer } from './TickRingBuffer';

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

// export class ECSNetworkSystem extends System {
//   readonly key = 'network';
//   private changedEids: number[] = [];

//   getComponents(): {}[] {
//     return [NetworkUpdated];
//   }

//   update(world: ECSGameWorld, _getInput?: GetInput, _getEvents?: GetEvents): void {
//     for (const eid of query(world, [NetworkUpdated])) {
//       this.changedEids.push(eid);
//     }
//   }

//   getChangedEids(): number[] {
//     const eids = this.changedEids;
//     this.changedEids = [];
//     return eids;
//   }
// }
