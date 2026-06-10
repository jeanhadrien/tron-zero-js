import { query } from 'bitecs';
import { EPSILON } from '../math';
import type { SimulationContext } from '../interfaces/SimulationContext';
import { Player, TrailPointsXs, TrailPointsYs } from '../systems/PlayerSystem';
import type { SpatialGrid } from './SpatialGrid';
import { Logger } from '../Logger';

const logger = new Logger('SpatialGrid');

/** Compare ECS trail static segments against grid entries for one or all players. */
export function validateGridConsistency(ctx: SimulationContext, grid: SpatialGrid, eid?: number): boolean {
  const eids = eid !== undefined ? [eid] : Array.from(query(ctx.world, [Player]));
  let ok = true;

  for (const id of eids) {
    const xs = TrailPointsXs.data[id];
    const ys = TrailPointsYs.data[id];
    const n = xs.length;
    const expectedStatic = Math.max(0, n - 1);

    const gridIds = grid.getPlayerStaticSegmentIds(id);
    if (gridIds.length !== expectedStatic) {
      logger.error('spatial grid desync: segment count', { eid: id, expected: expectedStatic, actual: gridIds.length });
      ok = false;
      continue;
    }

    for (let i = 0; i < expectedStatic; i++) {
      const segId = gridIds[i];
      const seg = grid.getSegment(segId);
      if (!seg) {
        logger.error('spatial grid desync: missing segment', { eid: id, index: i, segId });
        ok = false;
        continue;
      }

      const ex1 = xs[i];
      const ey1 = ys[i];
      const ex2 = xs[i + 1];
      const ey2 = ys[i + 1];

      if (
        Math.abs(seg.x1 - ex1) > EPSILON ||
        Math.abs(seg.y1 - ey1) > EPSILON ||
        Math.abs(seg.x2 - ex2) > EPSILON ||
        Math.abs(seg.y2 - ey2) > EPSILON
      ) {
        logger.error('spatial grid desync: geometry mismatch', {
          eid: id,
          index: i,
          expected: { x1: ex1, y1: ey1, x2: ex2, y2: ey2 },
          actual: { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 },
        });
        ok = false;
      }
    }
  }

  return ok;
}