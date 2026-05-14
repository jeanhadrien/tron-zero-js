import { World } from 'bitecs';

export type ECSGameWorld = World<{
  tick: number;
  tickTimeMs: number;
}>;
