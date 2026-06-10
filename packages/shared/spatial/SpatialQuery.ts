import { SharedLine, distanceBetween } from '../math';
import type { SimulationContext } from '../interfaces/SimulationContext';
import { buildActiveSegment, resolveActiveSegmentOwners } from './activeSegments';
import { SpatialGrid } from './SpatialGrid';
import type { SegmentKind, SpatialSegment } from './SpatialSegment';
import { traverseRayCells } from './gridTraversal';
import { closestRaySegmentHit, type MutableNearestHit } from './rayIntersection';

export interface RayQueryOptions {
  excludeOwnerEid?: number;
  includeActiveFor?: readonly number[];
  includeArena?: boolean;
  maxDistance?: number;
}

export interface NearestHit {
  x: number;
  y: number;
  distance: number;
  segmentId?: number;
  ownerEid: number;
  kind: SegmentKind | 'trail_active';
}

export interface GridDimensions {
  cols: number;
  rows: number;
  cellSize: number;
  width: number;
  height: number;
}

/** Read-only spatial query surface for collision and bot systems. */
export interface ISpatialQuery {
  queryNearestAlongRay(
    ray: SharedLine,
    originX: number,
    originY: number,
    options?: RayQueryOptions
  ): NearestHit;

  worldToCell(x: number, y: number): { cx: number; cy: number };
  getSegmentsInCell(cx: number, cy: number): readonly SpatialSegment[];
  getCellsAlongRay(ray: SharedLine): readonly { cx: number; cy: number }[];
  /** True when the cell contains any indexed static or arena segment. */
  isCellBlocked(cx: number, cy: number): boolean;
  getGridDimensions(): GridDimensions;
}

const NO_HIT: NearestHit = {
  x: Infinity,
  y: Infinity,
  distance: Infinity,
  ownerEid: -1,
  kind: 'trail_active',
};

export { resolveActiveSegmentOwners } from './activeSegments';

/** ISpatialQuery implementation backed by a SpatialGrid. */
export class SpatialQueryImpl implements ISpatialQuery {
  constructor(
    private readonly grid: SpatialGrid,
    private readonly ctx: SimulationContext
  ) {}

  queryNearestAlongRay(
    ray: SharedLine,
    originX: number,
    originY: number,
    options: RayQueryOptions = {}
  ): NearestHit {
    const includeArena = options.includeArena !== false;
    const excludeOwnerEid = options.excludeOwnerEid;

    const dirX = ray.x2 - ray.x1;
    const dirY = ray.y2 - ray.y1;
    const maxLength = options.maxDistance ?? distanceBetween(ray.x1, ray.y1, ray.x2, ray.y2);

    const best: MutableNearestHit = {
      x: Infinity,
      y: Infinity,
      distance: Infinity,
      ownerEid: -1,
      kind: 'trail_active',
    };

    const seen = new Set<number>();

    for (const cellKey of traverseRayCells(originX, originY, dirX, dirY, maxLength, this.grid)) {
      for (const segId of this.grid.getSegmentIdsAtKey(cellKey)) {
        if (seen.has(segId)) continue;
        seen.add(segId);

        const seg = this.grid.getSegment(segId);
        if (!seg) continue;
        if (!includeArena && seg.kind === 'arena') continue;
        if (excludeOwnerEid !== undefined && seg.ownerEid === excludeOwnerEid) continue;

        closestRaySegmentHit(ray, seg, originX, originY, best);
      }
    }

    const activeOwners = options.includeActiveFor ?? resolveActiveSegmentOwners(this.ctx);
    for (const eid of activeOwners) {
      if (excludeOwnerEid !== undefined && eid === excludeOwnerEid) continue;
      const active = buildActiveSegment(eid);
      if (!active) continue;
      closestRaySegmentHit(ray, { ...active, kind: 'trail_active' }, originX, originY, best);
    }

    if (best.distance === Infinity) return NO_HIT;
    return best;
  }

  worldToCell(x: number, y: number): { cx: number; cy: number } {
    return this.grid.worldToCell(x, y);
  }

  getSegmentsInCell(cx: number, cy: number): readonly SpatialSegment[] {
    return this.grid.getSegmentsInCell(cx, cy);
  }

  getCellsAlongRay(ray: SharedLine): readonly { cx: number; cy: number }[] {
    const dirX = ray.x2 - ray.x1;
    const dirY = ray.y2 - ray.y1;
    const maxLength = distanceBetween(ray.x1, ray.y1, ray.x2, ray.y2);
    const cells: { cx: number; cy: number }[] = [];

    for (const cellKey of traverseRayCells(ray.x1, ray.y1, dirX, dirY, maxLength, this.grid)) {
      const cx = cellKey % this.grid.cols;
      const cy = Math.floor(cellKey / this.grid.cols);
      cells.push({ cx, cy });
    }

    return cells;
  }

  isCellBlocked(cx: number, cy: number): boolean {
    return this.getSegmentsInCell(cx, cy).length > 0;
  }

  getGridDimensions(): GridDimensions {
    return {
      cols: this.grid.cols,
      rows: this.grid.rows,
      cellSize: this.grid.cellSize,
      width: this.grid.width,
      height: this.grid.height,
    };
  }
}