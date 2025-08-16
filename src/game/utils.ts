// Calculate distance from a point to a line segment
export function pointToLineDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length === 0) {
    // Line segment is actually a point
    return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
  }

  // Calculate the t parameter for the closest point on the line segment
  let t = ((px - x1) * dx + (py - y1) * dy) / (length * length);
  t = Math.max(0, Math.min(1, t)); // Clamp t to [0, 1]

  // Find the closest point on the line segment
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  // Return distance from point to closest point on line segment
  return Math.sqrt(
    (px - closestX) * (px - closestX) + (py - closestY) * (py - closestY)
  );
}
