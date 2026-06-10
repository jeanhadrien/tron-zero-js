import { angleBetween, distanceBetween, EPSILON } from './math';

export const TRAIL_MAX_LENGTH = 200;

/** Pure geometry — usable without eid for render datum evaluation. */
export function computeTrailArcLengthFromArrays(
  xs: readonly number[],
  ys: readonly number[],
  x: number,
  y: number
): number {
  const n = xs.length;
  if (n === 0) return 0;

  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    total += distanceBetween(xs[i], ys[i], xs[i + 1], ys[i + 1]);
  }
  total += distanceBetween(xs[n - 1], ys[n - 1], x, y);
  return total;
}

/** Returns true when arc length is within ε of cap — for render polish. */
export function isTrailAtCap(xs: readonly number[], ys: readonly number[], x: number, y: number): boolean {
  return computeTrailArcLengthFromArrays(xs, ys, x, y) >= TRAIL_MAX_LENGTH - EPSILON;
}

/**
 * Pure: remove `distance` world-units from the tail. Returns new array references.
 * Caller (PlayerSystem) assigns results to bitecs components.
 *
 * @param distance Non-negative world-units to consume. Values ≤ EPSILON are a no-op.
 * Negative values throw — callers must not pass invalid distances.
 */
export function consumeTrailFromTailPure(
  xsIn: readonly number[],
  ysIn: readonly number[],
  dirsIn: readonly number[],
  px: number,
  py: number,
  direction: number,
  distance: number
): { xs: number[]; ys: number[]; dirs: number[] } {
  if (distance < 0) {
    throw new Error(`consumeTrailFromTailPure: distance must be non-negative, got ${distance}`);
  }
  if (distance <= EPSILON) {
    return { xs: [...xsIn], ys: [...ysIn], dirs: [...dirsIn] };
  }

  let xs = [...xsIn];
  let ys = [...ysIn];
  let dirs = [...dirsIn];
  let remaining = distance;

  while (remaining > EPSILON && xs.length > 0) {
    const nextX = xs.length > 1 ? xs[1] : px;
    const nextY = xs.length > 1 ? ys[1] : py;

    const segLen = distanceBetween(xs[0], ys[0], nextX, nextY);
    if (segLen <= EPSILON) {
      if (xs.length > 1) {
        xs = xs.slice(1);
        ys = ys.slice(1);
        dirs = dirs.slice(1);
      } else {
        _reanchorSinglePointTrail(px, py, direction, xs, ys, dirs);
        remaining = 0;
        break;
      }
      continue;
    }

    if (remaining >= segLen - EPSILON) {
      remaining -= segLen;
      if (xs.length > 1) {
        xs = xs.slice(1);
        ys = ys.slice(1);
        dirs = dirs.slice(1);
      } else {
        const segDir = angleBetween(xs[0], ys[0], px, py);
        xs[0] = px - ((px - xs[0]) / segLen) * TRAIL_MAX_LENGTH;
        ys[0] = py - ((py - ys[0]) / segLen) * TRAIL_MAX_LENGTH;
        dirs[0] = segDir;
        remaining = 0;
      }
    } else {
      const t = remaining / segLen;
      xs[0] = xs[0] + (nextX - xs[0]) * t;
      ys[0] = ys[0] + (nextY - ys[0]) * t;
      remaining = 0;
    }
  }

  return { xs, ys, dirs };
}

/** Module-private — not exported. */
function _reanchorSinglePointTrail(
  px: number,
  py: number,
  direction: number,
  xs: number[],
  ys: number[],
  dirs: number[]
): void {
  xs[0] = px - Math.cos(direction) * TRAIL_MAX_LENGTH;
  ys[0] = py - Math.sin(direction) * TRAIL_MAX_LENGTH;
  dirs[0] = direction;
}
