import type { SimulationContext } from '../interfaces/SimulationContext';
import type { TrailConsumeDiff } from './trailDiff';

/** Mutation hooks and rebuild entry points for the spatial grid. */
export interface ISpatialGridMutator {
  onPlayerSpawn(eid: number): void;
  onTrailTurnNewPoint(eid: number, pointIndex: number): void;
  onTrailTailConsumed(eid: number, diff: TrailConsumeDiff): void;
  onPlayerDisabled(eid: number): void;
  onPlayerRemoved(eid: number): void;
  rebuildFromWorld(ctx: SimulationContext): void;
}