import type { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import { SnapshotRing } from '../SnapshotRing';
import type { InputSource } from './InputSource';
import type { SimulationPipeline } from './SimulationPipeline';
import type { StateReconciler } from './StateReconciler';

/** Runs one forward tick: apply server diff, run ECS with local prediction, snapshot + render. */
export class ForwardPipeline implements SimulationPipeline {
  constructor(
    private snapshots: SnapshotRing,
    private onTick: (tick: number) => void,
    private getSnapshotPeriodX: () => number,
    private getSnapshotGapTicks: () => number,
  ) {}

  preTick(room: ECSGameRoom, reconciler: StateReconciler): void {
    const diff = reconciler.getDiff(room.tick);
    if (diff) {
      room.soaDeserialize(diff.data);
      room.observerDeserializeNetwork(diff.struct, new Map());
    }
  }

  tick(room: ECSGameRoom, inputSource: InputSource): void {
    room.update({ resolveInput: (id: string) => inputSource.resolve(id) });
  }

  postTick(room: ECSGameRoom, _reconciler: StateReconciler): void {
    if (this.snapshots.shouldTake(room.tick, this.getSnapshotPeriodX(), this.getSnapshotGapTicks())) {
      this.snapshots.push(room.tick, room.snapshotSerialize());
    }
    this.onTick(room.tick);
  }

  /** Replace the render capture callback at runtime. */
  setOnTick(onTick: (tick: number) => void): void {
    this.onTick = onTick;
  }
}
