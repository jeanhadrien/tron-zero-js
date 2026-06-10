import { query } from 'bitecs';
import type { SimulationContext } from '../interfaces/SimulationContext';
import { IsAlive, Player, Position, TrailPointsXs, TrailPointsYs } from '../systems/PlayerSystem';

/** Return alive players with at least one trail point. */
export function resolveActiveSegmentOwners(ctx: SimulationContext): number[] {
  const result: number[] = [];
  for (const eid of Array.from(query(ctx.world, [Player]))) {
    if (IsAlive[eid] !== 1) continue;
    if (TrailPointsXs.data[eid].length === 0) continue;
    result.push(eid);
  }
  return result;
}

/** Build the live active trail segment for a player (last point → position). */
export function buildActiveSegment(eid: number): {
  ownerEid: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} | null {
  const xs = TrailPointsXs.data[eid];
  const n = xs.length;
  if (n === 0) return null;
  return {
    ownerEid: eid,
    x1: xs[n - 1],
    y1: TrailPointsYs.data[eid][n - 1],
    x2: Position.x[eid],
    y2: Position.y[eid],
  };
}