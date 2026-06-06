import type { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import { SnapshotRing } from '../SnapshotRing';
import type { InputSource } from './InputSource';
import type { SimulationPipeline } from './SimulationPipeline';
import type { StateReconciler } from './StateReconciler';

/**
 * Runs one replay tick: apply server diff if present, run ECS with replay
 * input source, overwrite snapshot for diff-applied ticks.
 * No render capture — replay is simulation-only.
 */
export class ReplayPipeline implements SimulationPipeline {
  private diffWasApplied: boolean = false;

  constructor(private snapshots: SnapshotRing) {}

  preTick(room: ECSGameRoom, reconciler: StateReconciler): void {
    this.diffWasApplied = false;
    const diff = reconciler.getDiff(room.tick);
    if (diff) {
      room.soaDeserialize(diff.data);
      room.observerDeserializeNetwork(diff.struct, new Map());
      this.diffWasApplied = true;
    }
  }

  tick(room: ECSGameRoom, inputSource: InputSource): void {
    room.update({ resolveInput: (id: string) => inputSource.resolve(id) });
  }

  postTick(room: ECSGameRoom, _reconciler: StateReconciler): void {
    if (this.diffWasApplied) {
      this.snapshots.overwrite(room.tick, room.snapshotSerialize());
    }
  }
}
