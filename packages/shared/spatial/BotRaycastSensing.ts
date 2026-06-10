import { buildDetectionLines, Position, SpeedMult } from '../systems/PlayerSystem';
import { BOT_AI_BUDGET } from './BotAiBudget';
import { SharedLine } from '../math';
import type { ISpatialQuery, RayQueryOptions } from './SpatialQuery';

const BASE_SPEED = 360;

export interface RaycastFan {
  distFront: number;
  distLeft: number;
  distRight: number;
  distFrontLeft: number;
  distFrontRight: number;
  distRearLeft: number;
  distRearRight: number;
}

/** Cast a 7-ray sensor fan via the spatial query surface. */
export function castRayFan(
  spatial: ISpatialQuery,
  eid: number,
  rayOpts: RayQueryOptions
): RaycastFan {
  const front = new SharedLine();
  const left = new SharedLine();
  const right = new SharedLine();
  buildDetectionLines(eid, front, left, right);

  const ox = Position.x[eid];
  const oy = Position.y[eid];
  const currentSpeed = SpeedMult[eid] || 0;
  const lookAhead = Math.max(2000, BASE_SPEED * currentSpeed * 0.5);

  const frontLeft = new SharedLine();
  const frontRight = new SharedLine();
  const rearLeft = new SharedLine();
  const rearRight = new SharedLine();

  const heading = Math.atan2(front.y2 - front.y1, front.x2 - front.x1);
  frontLeft.setToAngle(ox, oy, heading - Math.PI / 4, lookAhead * 0.7);
  frontRight.setToAngle(ox, oy, heading + Math.PI / 4, lookAhead * 0.7);
  rearLeft.setToAngle(ox, oy, heading - (3 * Math.PI) / 4, BOT_AI_BUDGET.REAR_RAY_LENGTH);
  rearRight.setToAngle(ox, oy, heading + (3 * Math.PI) / 4, BOT_AI_BUDGET.REAR_RAY_LENGTH);

  return {
    distFront: spatial.queryNearestAlongRay(front, ox, oy, rayOpts).distance,
    distLeft: spatial.queryNearestAlongRay(left, ox, oy, rayOpts).distance,
    distRight: spatial.queryNearestAlongRay(right, ox, oy, rayOpts).distance,
    distFrontLeft: spatial.queryNearestAlongRay(frontLeft, ox, oy, rayOpts).distance,
    distFrontRight: spatial.queryNearestAlongRay(frontRight, ox, oy, rayOpts).distance,
    distRearLeft: spatial.queryNearestAlongRay(rearLeft, ox, oy, rayOpts).distance,
    distRearRight: spatial.queryNearestAlongRay(rearRight, ox, oy, rayOpts).distance,
  };
}

/** Build ray options for bot sensing including all active trail segments. */
export function botRayOptions(activeOwners: readonly number[]): RayQueryOptions {
  return { includeActiveFor: activeOwners };
}