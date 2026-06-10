import { EPSILON } from '../math';

export interface GridBounds {
  cols: number;
  rows: number;
  cellSize: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
}

/** Clip ray length so the endpoint stays inside the arena AABB. */
export function clipRayLengthToArena(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  maxLength: number,
  width: number,
  height: number
): number {
  let tMax = maxLength;

  if (dirX > EPSILON) {
    tMax = Math.min(tMax, (width - originX) / dirX);
  } else if (dirX < -EPSILON) {
    tMax = Math.min(tMax, -originX / dirX);
  }

  if (dirY > EPSILON) {
    tMax = Math.min(tMax, (height - originY) / dirY);
  } else if (dirY < -EPSILON) {
    tMax = Math.min(tMax, -originY / dirY);
  }

  return Math.max(0, tMax);
}

/** Amanatides & Woo grid walk over cells intersected by a ray (arena-clamped). */
export function* traverseRayCells(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  maxLength: number,
  grid: GridBounds
): Generator<number> {
  const { cols, rows, cellSize, width, height, originX: ox, originY: oy } = grid;

  const len = Math.hypot(dirX, dirY);
  if (len <= EPSILON || maxLength <= EPSILON) return;

  const ndx = dirX / len;
  const ndy = dirY / len;
  const effectiveLength = clipRayLengthToArena(originX, originY, ndx, ndy, maxLength, width, height);
  if (effectiveLength <= EPSILON) return;

  const endX = originX + ndx * effectiveLength;
  const endY = originY + ndy * effectiveLength;

  let cx = Math.floor((originX - ox) / cellSize);
  let cy = Math.floor((originY - oy) / cellSize);

  if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;

  const endCx = Math.floor((endX - ox) / cellSize);
  const endCy = Math.floor((endY - oy) / cellSize);

  const stepX = ndx > EPSILON ? 1 : ndx < -EPSILON ? -1 : 0;
  const stepY = ndy > EPSILON ? 1 : ndy < -EPSILON ? -1 : 0;

  const tDeltaX = stepX !== 0 ? cellSize / Math.abs(ndx) : Infinity;
  const tDeltaY = stepY !== 0 ? cellSize / Math.abs(ndy) : Infinity;

  const nextBoundaryX = stepX > 0 ? (cx + 1) * cellSize + ox : cx * cellSize + ox;
  const nextBoundaryY = stepY > 0 ? (cy + 1) * cellSize + oy : cy * cellSize + oy;

  let tMaxX = stepX !== 0 ? (nextBoundaryX - originX) / ndx : Infinity;
  let tMaxY = stepY !== 0 ? (nextBoundaryY - originY) / ndy : Infinity;

  if (tMaxX < 0) tMaxX = stepX > 0 ? tDeltaX : Infinity;
  if (tMaxY < 0) tMaxY = stepY > 0 ? tDeltaY : Infinity;

  const visited = new Set<number>();
  const maxSteps = cols * rows + 2;

  for (let step = 0; step < maxSteps; step++) {
    const key = cy * cols + cx;
    if (!visited.has(key)) {
      visited.add(key);
      yield key;
    }

    if (cx === endCx && cy === endCy) break;

    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }

    if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) break;
  }
}