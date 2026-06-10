import { EPSILON } from '../math';

/** Return flat cell keys (cy * cols + cx) an axis-aligned segment overlaps. */
export function rasterizeAxisAlignedSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cellSize: number,
  cols: number,
  rows: number,
  originX: number,
  originY: number
): number[] {
  const keys = new Set<number>();

  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  const cx0 = Math.max(0, Math.min(cols - 1, Math.floor((minX - originX) / cellSize)));
  const cx1 = Math.max(0, Math.min(cols - 1, Math.floor((maxX - originX) / cellSize)));
  const cy0 = Math.max(0, Math.min(rows - 1, Math.floor((minY - originY) / cellSize)));
  const cy1 = Math.max(0, Math.min(rows - 1, Math.floor((maxY - originY) / cellSize)));

  if (Math.abs(y1 - y2) <= EPSILON) {
    for (let cx = cx0; cx <= cx1; cx++) {
      keys.add(cy0 * cols + cx);
    }
  } else if (Math.abs(x1 - x2) <= EPSILON) {
    for (let cy = cy0; cy <= cy1; cy++) {
      keys.add(cy * cols + cx0);
    }
  } else {
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        keys.add(cy * cols + cx);
      }
    }
  }

  return Array.from(keys);
}