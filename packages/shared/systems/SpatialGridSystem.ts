import { query } from 'bitecs';
import { System } from '../interfaces/System';
import type { SimulationContext } from '../interfaces/SimulationContext';
import { Arena, AreaWidth, AreaHeight, Lines } from './GameArenaSystem';
import { Player, TrailPointsXs, TrailPointsYs } from './PlayerSystem';
import { SPATIAL_CELL_SIZE, SPATIAL_DEBUG_VALIDATE } from '../spatial/constants';
import { SpatialGrid } from '../spatial/SpatialGrid';
import type { ISpatialGridMutator } from '../spatial/SpatialGridMutator';
import { SpatialQueryImpl } from '../spatial/SpatialQuery';
import type { TrailConsumeDiff } from '../spatial/trailDiff';
import { validateGridConsistency } from '../spatial/validateGrid';
import { Logger } from '../Logger';

const logger = new Logger('SpatialGridSystem');

/** Maintains the derived spatial grid over arena walls and static trail segments. */
export class SpatialGridSystem implements System, ISpatialGridMutator {
  readonly key = 'spatial';

  private grid: SpatialGrid | null = null;
  private queryImpl: SpatialQueryImpl | null = null;

  getComponents(): object[] {
    return [];
  }

  init(ctx: SimulationContext): void {
    const [arenaEid] = query(ctx.world, [Arena]);
    if (arenaEid === undefined) {
      logger.warn('SpatialGridSystem.init: no arena entity');
      return;
    }

    const width = AreaWidth[arenaEid];
    const height = AreaHeight[arenaEid];
    this.grid = new SpatialGrid(width, height, SPATIAL_CELL_SIZE);
    this.queryImpl = new SpatialQueryImpl(this.grid, ctx);

    ctx.spatialQuery = this.queryImpl;
    ctx.spatialGrid = this;

    this.indexArenaWalls(arenaEid);
  }

  onPlayerSpawn(eid: number): void {
    this.grid?.registerPlayer(eid);
  }

  onTrailTurnNewPoint(eid: number, pointIndex: number): void {
    if (!this.grid || pointIndex < 1) return;

    const xs = TrailPointsXs.data[eid];
    const ys = TrailPointsYs.data[eid];
    const staticIndex = pointIndex - 1;

    this.grid.insertSegment(
      'trail_static',
      eid,
      staticIndex,
      xs[staticIndex],
      ys[staticIndex],
      xs[staticIndex + 1],
      ys[staticIndex + 1]
    );
  }

  onTrailTailConsumed(eid: number, diff: TrailConsumeDiff): void {
    if (!this.grid) return;

    const ids = [...this.grid.getPlayerStaticSegmentIds(eid)];

    for (const idx of [...diff.removedStaticIndices].sort((a, b) => b - a)) {
      if (idx < ids.length) {
        this.grid.removeSegment(ids[idx]);
      }
    }

    const remaining = [...this.grid.getPlayerStaticSegmentIds(eid)];
    if (diff.updatedStatic0 && remaining.length > 0) {
      const { x1, y1, x2, y2 } = diff.updatedStatic0;
      this.grid.updateSegmentGeometry(remaining[0], x1, y1, x2, y2);
    }

    if (diff.singlePointReanchored) {
      for (const id of [...this.grid.getPlayerStaticSegmentIds(eid)]) {
        this.grid.removeSegment(id);
      }
    }
  }

  onPlayerDisabled(eid: number): void {
    this.grid?.removePlayerSegments(eid);
  }

  onPlayerRemoved(eid: number): void {
    this.grid?.removePlayerSegments(eid);
  }

  rebuildFromWorld(ctx: SimulationContext): void {
    if (!this.grid) return;

    const t0 = performance.now();
    const [arenaEid] = query(ctx.world, [Arena]);
    if (arenaEid === undefined) return;

    const width = AreaWidth[arenaEid];
    const height = AreaHeight[arenaEid];

    if (width !== this.grid.width || height !== this.grid.height) {
      this.grid = new SpatialGrid(width, height, SPATIAL_CELL_SIZE);
      this.queryImpl = new SpatialQueryImpl(this.grid, ctx);
      ctx.spatialQuery = this.queryImpl;
    } else {
      this.grid.clear();
    }

    this.indexArenaWalls(arenaEid);

    for (const eid of Array.from(query(ctx.world, [Player]))) {
      this.grid.registerPlayer(eid);
      const xs = TrailPointsXs.data[eid];
      const ys = TrailPointsYs.data[eid];
      const n = xs.length;
      for (let i = 0; i < n - 1; i++) {
        this.grid.insertSegment('trail_static', eid, i, xs[i], ys[i], xs[i + 1], ys[i + 1]);
      }
    }

    let segmentCount = 0;
    for (const _ of this.grid.getAllSegments()) segmentCount++;

    const ms = performance.now() - t0;
    logger.debug('spatial rebuild ms', { ms: ms.toFixed(2), segments: segmentCount });

    if (SPATIAL_DEBUG_VALIDATE) {
      validateGridConsistency(ctx, this.grid);
    }
  }

  private indexArenaWalls(arenaEid: number): void {
    if (!this.grid) return;
    const x1s = Lines.x1[arenaEid];
    const y1s = Lines.y1[arenaEid];
    const x2s = Lines.x2[arenaEid];
    const y2s = Lines.y2[arenaEid];

    for (let i = 0; i < x1s.length; i++) {
      this.grid.insertSegment('arena', -1, i, x1s[i], y1s[i], x2s[i], y2s[i]);
    }
  }
}