const EPSILON = 1e-12;

export class SharedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;

  constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }

  setToAngle(x: number, y: number, angle: number, length: number): SharedLine {
    this.x1 = x;
    this.y1 = y;
    this.x2 = x + Math.cos(angle) * length;
    this.y2 = y + Math.sin(angle) * length;
    return this;
  }
}

export function lineToLineIntersection(
  line1: SharedLine,
  line2: SharedLine,
  out: { x: number; y: number }
): boolean {
  const x1 = line1.x1, y1 = line1.y1, x2 = line1.x2, y2 = line1.y2;
  const x3 = line2.x1, y3 = line2.y1, x4 = line2.x2, y4 = line2.y2;

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < EPSILON) return false;

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return false;

  out.x = x1 + ua * (x2 - x1);
  out.y = y1 + ua * (y2 - y1);
  return true;
}

export function distanceBetween(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Cheap pre-filter to reject obstacle segments whose bounding box does not
 * overlap with the sensor ray's bounding box, before doing the expensive
 * line-to-line intersection test.
 */
export function aabbOverlapsRay(
  ray: SharedLine,
  segment: SharedLine
): boolean {
  const rayMinX = Math.min(ray.x1, ray.x2);
  const rayMaxX = Math.max(ray.x1, ray.x2);
  const rayMinY = Math.min(ray.y1, ray.y2);
  const rayMaxY = Math.max(ray.y1, ray.y2);
  const segMinX = Math.min(segment.x1, segment.x2);
  const segMaxX = Math.max(segment.x1, segment.x2);
  const segMinY = Math.min(segment.y1, segment.y2);
  const segMaxY = Math.max(segment.y1, segment.y2);
  return (
    segMaxX >= rayMinX &&
    segMinX <= rayMaxX &&
    segMaxY >= rayMinY &&
    segMinY <= rayMaxY
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function angleBetween(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

export function wrapAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) {
    wrapped -= Math.PI * 2;
  } else if (wrapped < -Math.PI) {
    wrapped += Math.PI * 2;
  }
  return wrapped;
}
