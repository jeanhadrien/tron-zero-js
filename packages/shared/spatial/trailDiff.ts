import { EPSILON } from '../math';

export interface TrailSnapshot {
  xs: readonly number[];
  ys: readonly number[];
  n: number;
}

export interface TrailConsumeDiff {
  removedStaticIndices: number[];
  updatedStatic0?: { x1: number; y1: number; x2: number; y2: number };
  singlePointReanchored: boolean;
}

/** Compute grid mutation delta after tail consumption. */
export function diffTrailConsume(
  before: TrailSnapshot,
  after: TrailSnapshot,
  _px: number,
  _py: number
): TrailConsumeDiff {
  const diff: TrailConsumeDiff = {
    removedStaticIndices: [],
    singlePointReanchored: false,
  };

  const beforeStatic = Math.max(0, before.n - 1);
  const afterStatic = Math.max(0, after.n - 1);

  const removedCount = beforeStatic - afterStatic;
  for (let i = 0; i < removedCount; i++) {
    diff.removedStaticIndices.push(i);
  }

  if (afterStatic === 0 && beforeStatic > 0) {
    diff.singlePointReanchored = after.n === 1;
    return diff;
  }

  if (afterStatic > 0 && beforeStatic > 0) {
    const headIdx = removedCount;
    const bx1 = before.xs[headIdx];
    const by1 = before.ys[headIdx];
    const bx2 = before.xs[headIdx + 1];
    const by2 = before.ys[headIdx + 1];
    const ax1 = after.xs[0];
    const ay1 = after.ys[0];
    const ax2 = after.xs[1];
    const ay2 = after.ys[1];

    if (
      Math.abs(bx1 - ax1) > EPSILON ||
      Math.abs(by1 - ay1) > EPSILON ||
      Math.abs(bx2 - ax2) > EPSILON ||
      Math.abs(by2 - ay2) > EPSILON
    ) {
      diff.updatedStatic0 = { x1: ax1, y1: ay1, x2: ax2, y2: ay2 };
    }
  }

  if (after.n === 1 && before.n > 1 && afterStatic === 0) {
    diff.singlePointReanchored = true;
  }

  return diff;
}