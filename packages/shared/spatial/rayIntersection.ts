import { SharedLine, lineToLineIntersection, distanceBetween, aabbOverlapsRay, EPSILON } from '../math';
import type { SegmentId, SegmentKind } from './SpatialSegment';

export interface MutableNearestHit {
  x: number;
  y: number;
  distance: number;
  segmentId?: SegmentId;
  ownerEid: number;
  kind: SegmentKind | 'trail_active';
}

export interface SegmentHitInput {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ownerEid: number;
  kind: SegmentKind | 'trail_active';
  id?: SegmentId;
}

const _scratchPoint = { x: -1, y: -1 };
const _scratchSeg = new SharedLine();

/** Updates `best` if segment intersects ray closer than current best. */
export function closestRaySegmentHit(
  ray: SharedLine,
  segment: SegmentHitInput,
  originX: number,
  originY: number,
  best: MutableNearestHit
): void {
  _scratchSeg.x1 = segment.x1;
  _scratchSeg.y1 = segment.y1;
  _scratchSeg.x2 = segment.x2;
  _scratchSeg.y2 = segment.y2;

  if (!aabbOverlapsRay(ray, _scratchSeg)) return;

  _scratchPoint.x = -1;
  _scratchPoint.y = -1;

  if (!lineToLineIntersection(ray, _scratchSeg, _scratchPoint)) return;

  const pointDistance = distanceBetween(_scratchPoint.x, _scratchPoint.y, originX, originY);
  if (pointDistance < EPSILON) return;

  if (pointDistance < best.distance) {
    best.x = _scratchPoint.x;
    best.y = _scratchPoint.y;
    best.distance = pointDistance;
    best.segmentId = segment.id;
    best.ownerEid = segment.ownerEid;
    best.kind = segment.kind;
  }
}

/** Brute-force closest hit against a line list — legacy collision path. */
export function closestHitAmongLines(
  sensorLine: SharedLine,
  obstacleLines: SharedLine[],
  originX: number,
  originY: number
): { x: number; y: number } {
  const best: MutableNearestHit = {
    x: Infinity,
    y: Infinity,
    distance: Infinity,
    ownerEid: -1,
    kind: 'trail_active',
  };

  for (const line of obstacleLines) {
    closestRaySegmentHit(
      sensorLine,
      { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2, ownerEid: -1, kind: 'trail_active' },
      originX,
      originY,
      best
    );
  }

  return { x: best.x, y: best.y };
}