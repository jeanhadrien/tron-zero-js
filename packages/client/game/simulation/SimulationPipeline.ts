import type { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import type { InputSource } from './InputSource';
import type { StateReconciler } from './StateReconciler';
import { SnapshotRing } from '../SnapshotRing';
import type { EntityIdMapStore } from './EntityIdMapStore';

/** Coarse 3-stage pipeline contract for processing a single simulation tick. */
export interface SimulationPipeline {
  preTick(room: ECSGameRoom, reconciler: StateReconciler): void;
  tick(room: ECSGameRoom, inputSource: InputSource): void;
  postTick(room: ECSGameRoom, reconciler: StateReconciler): void;
}

/**
 * Runs one simulation tick: apply server diff if present, run ECS with the
 * given input source, snapshot when an authoritative diff was applied, and
 * optionally capture render state (forward path only).
 */
export class TickPipeline implements SimulationPipeline {
  private diffWasApplied: boolean = false;

  constructor(
    private snapshots: SnapshotRing,
    private entityIdMap: EntityIdMapStore,
    private onTick?: (tick: number) => void
  ) {}

  preTick(room: ECSGameRoom, reconciler: StateReconciler): void {
    this.diffWasApplied = false;
    const diff = reconciler.getDiff(room.tick);
    if (diff) {
      const map = this.entityIdMap.asMap();
      room.observerDeserializeNetwork(diff.struct, map);
      room.soaDeserialize(diff.data, map);
      reconciler.clearLocalInputForSimulatedTick(diff.tick - 1);
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
    this.onTick?.(room.tick);
  }

  /** Replace the render capture callback at runtime. */
  setOnTick(onTick: (tick: number) => void): void {
    this.onTick = onTick;
  }
}