export type SegmentId = number;
export type SegmentKind = 'arena' | 'trail_static';

/** Cached geometry for a collidable segment indexed in the spatial grid. */
export interface SpatialSegment {
  id: SegmentId;
  kind: SegmentKind;
  ownerEid: number;
  segmentIndex: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}