import type { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import type { InputSource } from './InputSource';
import type { StateReconciler } from './StateReconciler';
import { SnapshotRing } from '../SnapshotRing';
import type { SimulationPipeline } from './SimulationPipeline';

/** Coarse 3-stage pipeline contract for processing a single simulation tick. */
export interface SimulationPipeline {
  preTick(room: ECSGameRoom, reconciler: StateReconciler): void;
  tick(room: ECSGameRoom, inputSource: InputSource): void;
  postTick(room: ECSGameRoom, reconciler: StateReconciler): void;
}
/** Runs one forward tick: apply server diff, run ECS with local prediction, render. */

export class ForwardPipeline implements SimulationPipeline {
  private diffWasApplied: boolean = false;

  constructor(
    private snapshots: SnapshotRing,
    private onTick: (tick: number) => void
  ) {}

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
    this.onTick(room.tick);
  }

  /** Replace the render capture callback at runtime. */
  setOnTick(onTick: (tick: number) => void): void {
    this.onTick = onTick;
  }
}
/**
 * Runs one replay tick: apply server diff if present, run ECS with replay
 * input source, snapshot only when an authoritative diff was applied.
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
