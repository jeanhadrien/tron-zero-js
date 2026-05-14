import { World } from 'bitecs';
import GameArea from './GameArea';

export type ECSGameWorld = World<{
  tick: number;
  tickTimeMs: number;
  turnQueues: Map<number, { tick: number; turn: 'left' | 'right' }[]>;
  area: GameArea;
}>;
