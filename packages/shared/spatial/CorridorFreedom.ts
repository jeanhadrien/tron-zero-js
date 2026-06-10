import { buildActiveSegment } from './activeSegments';
import { BOT_AI_BUDGET } from './BotAiBudget';
import { rasterizeAxisAlignedSegment } from './segmentRaster';
import type { ISpatialQuery } from './SpatialQuery';

export interface FreedomSnapshot {
  reachableArea: number;
  cardinalExits: number;
  centroidX: number;
  centroidY: number;
}

export interface FreedomOptions {
  visitBudget?: number;
  maxRadius?: number;
  /** Extra blocked cell keys (cy * cols + cx) layered on top of the grid. */
  extraBlocked?: ReadonlySet<number>;
}

/** Return true when a cell is blocked by grid segments or extra overlay cells. */
export function isCellTraversable(
  query: ISpatialQuery,
  cx: number,
  cy: number,
  extraBlocked?: ReadonlySet<number>
): boolean {
  const { cols } = query.getGridDimensions();
  const key = cy * cols + cx;
  if (extraBlocked?.has(key)) return false;
  return !query.isCellBlocked(cx, cy);
}

/** Collect blocked cell keys from active trail segments for all given owners. */
export function collectActiveSegmentCells(query: ISpatialQuery, owners: readonly number[]): Set<number> {
  const { cols, rows, cellSize, width, height } = query.getGridDimensions();
  const blocked = new Set<number>();

  for (const eid of owners) {
    const active = buildActiveSegment(eid);
    if (!active) continue;
    for (const key of rasterizeAxisAlignedSegment(
      active.x1,
      active.y1,
      active.x2,
      active.y2,
      cellSize,
      cols,
      rows,
      0,
      0
    )) {
      blocked.add(key);
    }
  }

  void width;
  void height;
  return blocked;
}

/** Capped BFS freedom metrics from a world position using the spatial grid. */
export function measureFreedom(
  query: ISpatialQuery,
  x: number,
  y: number,
  options: FreedomOptions = {}
): FreedomSnapshot {
  const visitBudget = options.visitBudget ?? BOT_AI_BUDGET.BFS_VISIT_BUDGET_CURRENT;
  const maxRadius = options.maxRadius ?? BOT_AI_BUDGET.BFS_MAX_RADIUS;
  const extraBlocked = options.extraBlocked;
  const { cols, rows, cellSize } = query.getGridDimensions();

  const { cx: seedCx, cy: seedCy } = query.worldToCell(x, y);
  if (seedCx < 0 || seedCx >= cols || seedCy < 0 || seedCy >= rows) {
    return { reachableArea: 0, cardinalExits: 0, centroidX: x, centroidY: y };
  }

  const seedKey = seedCy * cols + seedCx;
  const visited = new Set<number>();
  const queue: { cx: number; cy: number; depth: number }[] = [{ cx: seedCx, cy: seedCy, depth: 0 }];
  visited.add(seedKey);

  let reachableArea = 0;
  let sumX = 0;
  let sumY = 0;

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  while (queue.length > 0 && reachableArea < visitBudget) {
    const { cx, cy, depth } = queue.shift()!;
    reachableArea++;
    sumX += (cx + 0.5) * cellSize;
    sumY += (cy + 0.5) * cellSize;

    if (depth >= maxRadius) continue;

    for (const [dx, dy] of neighbors) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

      const key = ny * cols + nx;
      if (visited.has(key)) continue;

      const traversable = key === seedKey || isCellTraversable(query, nx, ny, extraBlocked);
      if (!traversable) continue;

      visited.add(key);
      queue.push({ cx: nx, cy: ny, depth: depth + 1 });
    }
  }

  let cardinalExits = 0;
  for (const [dx, dy] of neighbors) {
    const nx = seedCx + dx;
    const ny = seedCy + dy;
    if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
    if (isCellTraversable(query, nx, ny, extraBlocked)) cardinalExits++;
  }

  return {
    reachableArea,
    cardinalExits,
    centroidX: reachableArea > 0 ? sumX / reachableArea : x,
    centroidY: reachableArea > 0 ? sumY / reachableArea : y,
  };
}