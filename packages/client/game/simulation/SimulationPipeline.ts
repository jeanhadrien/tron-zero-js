import type { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import type { InputSource } from './InputSource';
import type { StateReconciler } from './StateReconciler';

/** Coarse 3-stage pipeline contract for processing a single simulation tick. */
export interface SimulationPipeline {
  preTick(room: ECSGameRoom, reconciler: StateReconciler): void;
  tick(room: ECSGameRoom, inputSource: InputSource): void;
  postTick(room: ECSGameRoom, reconciler: StateReconciler): void;
}
