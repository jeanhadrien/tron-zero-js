/**
 * PlayerSystem — ECS-based player management for bitECS.
 *
 * Mirrors the game mechanics of the original Player class (Player.ts) but stores all
 * state in SoA component arrays, making snapshot/rollback trivial via bitECS's built-in
 * createSnapshotSerializer / createSnapshotDeserializer.
 */

import { addEntity, addComponents, hasComponent, query, resetWorld } from 'bitecs';
import { createSnapshotSerializer, createSnapshotDeserializer, f32, u8, u32, str, array } from 'bitecs/serialization';
import { SharedLine, lineToLineIntersection, distanceBetween, clamp, aabbOverlapsRay } from './math';
import GameArea from './GameArea';
import { Logger } from './Logger';
import { ECSGameWorld } from './ECSGameWorld';

const logger = new Logger('PlayerSystem');

// ─── Constants (mirroring Player statics) ────────────────────────────────────
const ROTATION_ANGLE = Math.PI / 2;
const BASE_SPEED = 150;
const MAX_SPEED = 500;
const BASE_RUBBER = 30;
const EPSILON = 1e-12;
const SLOW_DOWN_DISTANCE = 10;
const DELTA_STUFF = 12;

// ─── Components (SoA, typed for bitECS serialization) ────────────────────────

/** GameWorld-space position */
const Position = { x: f32([]), y: f32([]) };

/** Per-tick velocity (x, y movement per tick × 1000) */
const Velocity = { vx: f32([]), vy: f32([]) };

/** Heading in radians (must be multiple of PI/2) */
const Direction = f32([]);

/** Current speed multiplier */
const SpeedMult = f32([]);

/** Desired / target speed multiplier (drifts toward 1 when not sliding) */
const TargetSpeedMult = f32([]);

/** Rubber resource (0 = death) */
const Rubber = f32([]);

/** Whether the player is alive (1 = alive, 0 = dead) */
const IsAlive = u8([]);

/** Flag to prevent death handling from firing more than once */
const ShouldHandleDeath = u8([]);

/** Whether the player is currently sliding near a wall */
const IsSliding = u8([]);

/** Whether the front sensor is inside the slow-down zone */
const IsColliding = u8([]);

/** Player colour as 24-bit RGB integer */
const Color = u32([]);

/** Human-readable player id (string) */
const PlayerId = str([]);

/** Trail points stored as parallel SoA arrays per entity.
 *  TrailPoints.ticks[eid] is a number[], TrailPoints.xs[eid] is a number[], etc.
 *  All arrays for a given entity have the same length. */
const TrailPoints = {
  xs: array(f32),
  ys: array(f32),
  dirs: array(f32),
};

/** Marker component — every player entity MUST have this tag */
const Player = {};
const Networked = {};

/** All components that the snapshot serializer needs to capture.
 *  Used by createPlayerSnapshotSerializer / createPlayerSnapshotDeserializer. */
export const PLAYER_COMPONENTS = [
  Position,
  Velocity,
  Direction,
  SpeedMult,
  TargetSpeedMult,
  Rubber,
  IsAlive,
  ShouldHandleDeath,
  IsSliding,
  IsColliding,
  Color,
  PlayerId,
  TrailPoints,
  Player,
  Networked,
];

// ─── Turn Queue (sidecar — managed outside ECS, not in snapshots) ────────────

export interface TurnQueueItem {
  tick: number;
  turn: 'left' | 'right';
}

/** Map of entity id → ordered turn queue. Consumed by tickPlayerSystem. */
export type TurnQueueMap = Map<number, TurnQueueItem[]>;

// ─── Snapshot helpers ────────────────────────────────────────────────────────

export function createPlayerSnapshotSerializer(world: ECSGameWorld) {
  return createSnapshotSerializer(world, PLAYER_COMPONENTS);
}

export function createPlayerSnapshotDeserializer(world: ECSGameWorld) {
  return createSnapshotDeserializer(world, PLAYER_COMPONENTS);
}

/** Convenience: fully snapshot the GameWorld and reset it to a previous snapshot. */
export function rollbackWorld(world: ECSGameWorld, deserialize: ReturnType<typeof createSnapshotDeserializer>, buffer: ArrayBuffer): void {
  resetWorld(world);
  deserialize(buffer);
}

// ─── Entity lifecycle ────────────────────────────────────────────────────────

/** Add a new player entity and return its entity id. */
export function createPlayer(world: ECSGameWorld, id: string, color: number): number {
  const eid = addEntity(world);
  addComponents(world, eid, PLAYER_COMPONENTS);
  PlayerId[eid] = id;
  Color[eid] = color;

  // Defaults for lifecycle flags
  IsAlive[eid] = 0;
  ShouldHandleDeath[eid] = 0;
  IsSliding[eid] = 0;
  IsColliding[eid] = 0;

  // Empty trail
  TrailPoints.xs[eid] = [];
  TrailPoints.ys[eid] = [];
  TrailPoints.dirs[eid] = [];

  // Zero velocity
  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;

  return eid;
}

/** Reset a player to alive state at a given position. */
export function spawnPlayer(eid: number, x: number, y: number, direction: number, tickTimeMs: number): void {
  Position.x[eid] = x;
  Position.y[eid] = y;
  Direction[eid] = direction;
  Rubber[eid] = BASE_RUBBER;
  IsAlive[eid] = 1;
  ShouldHandleDeath[eid] = 1;
  TargetSpeedMult[eid] = 1;
  IsSliding[eid] = 0;
  IsColliding[eid] = 0;

  _setSpeedAndVelocity(eid, 1, tickTimeMs);

  // Single initial trail point at spawn location

  TrailPoints.xs[eid] = [x];
  TrailPoints.ys[eid] = [y];
  TrailPoints.dirs[eid] = [direction];

  logger.debug(PlayerId[eid], 'spawnPlayer()');
}

/** Immediately kill a player (zero speed, zero rubber, clear trail). */
export function disablePlayer(eid: number): void {
  SpeedMult[eid] = 0;
  TargetSpeedMult[eid] = 0;
  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Rubber[eid] = 0;
  IsAlive[eid] = 0;
  ShouldHandleDeath[eid] = 0;
  IsSliding[eid] = 0;
  IsColliding[eid] = 0;
  TrailPoints.xs[eid] = [];
  TrailPoints.ys[eid] = [];
  TrailPoints.dirs[eid] = [];
}

// ─── Turn queue ──────────────────────────────────────────────────────────────

/** Queue a turn for the player at a specific tick. */
export function queueTurn(turnQueues: TurnQueueMap, eid: number, turn: 'left' | 'right', tick: number = 0): void {
  if (IsAlive[eid]) {
    let queue = turnQueues.get(eid);
    if (!queue) {
      queue = [];
      turnQueues.set(eid, queue);
    }
    queue.push({ tick, turn });
  } else {
    logger.debug(PlayerId[eid], 'skipped turn, not alive');
  }
}

/** Pop and return the next turn from the queue, or null if empty. */
export function popTurn(turnQueues: TurnQueueMap, eid: number): TurnQueueItem | null {
  const queue = turnQueues.get(eid);
  if (!queue || queue.length === 0) return null;
  return queue.shift()!;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function _normalizeDirection(d: number): number {
  let nd = d % (Math.PI * 2);
  if (nd < 0) nd += Math.PI * 2;
  return nd;
}

function _setSpeedAndVelocity(eid: number, speedMult: number, tickTimeMs: number): void {
  let vx = Math.cos(Direction[eid]) * BASE_SPEED * speedMult * tickTimeMs;
  let vy = Math.sin(Direction[eid]) * BASE_SPEED * speedMult * tickTimeMs;
  if (Math.abs(vx) <= EPSILON) vx = 0;
  if (Math.abs(vy) <= EPSILON) vy = 0;
  Velocity.vx[eid] = vx;
  Velocity.vy[eid] = vy;
  SpeedMult[eid] = speedMult;
}

// ─── Public geometry helpers ─────────────────────────────────────────────────

/** Build SharedLine[] from a player's trail for collision detection. */
export function getPlayerTrailLines(eid: number): SharedLine[] {
  const lines: SharedLine[] = [];
  const xs = TrailPoints.xs[eid];
  const ys = TrailPoints.ys[eid];
  const n = xs.length;

  for (let i = 0; i < n - 1; i++) {
    lines.push(new SharedLine(xs[i], ys[i], xs[i + 1], ys[i + 1]));
  }

  // Last trail point to current position
  if (n > 0) {
    lines.push(new SharedLine(xs[n - 1], ys[n - 1], Position.x[eid], Position.y[eid]));
  }

  return lines;
}

/** Build all obstacle lines from all player trails + arena boundaries. */
export function buildObstacleLines(world: ECSGameWorld, gameArea: GameArea): SharedLine[] {
  const lines: SharedLine[] = [
    new SharedLine(0, 0, gameArea.width, 0),
    new SharedLine(gameArea.width, 0, gameArea.width, gameArea.height),
    new SharedLine(gameArea.width, gameArea.height, 0, gameArea.height),
    new SharedLine(0, gameArea.height, 0, 0),
  ];

  for (const eid of Array.from(query(world, [Player]))) {
    const xs = TrailPoints.xs[eid];
    const ys = TrailPoints.ys[eid];
    const n = xs.length;

    for (let i = 0; i < n - 1; i++) {
      lines.push(new SharedLine(xs[i], ys[i], xs[i + 1], ys[i + 1]));
    }

    if (n > 0) {
      lines.push(new SharedLine(xs[n - 1], ys[n - 1], Position.x[eid], Position.y[eid]));
    }
  }

  return lines;
}

/** Find the closest intersection of a sensor ray against a set of obstacle lines. */
export function getClosestIntersectingPoint(
  sensorLine: SharedLine,
  obstacleLines: SharedLine[],
  originX: number,
  originY: number
): { x: number; y: number } {
  let closestPoint = { x: Infinity, y: Infinity };
  const point = { x: -1, y: -1 };

  for (const line of obstacleLines) {
    if (!aabbOverlapsRay(sensorLine, line)) continue;
    point.x = -1;
    point.y = -1;

    if (lineToLineIntersection(sensorLine, line, point)) {
      const pointDistance = distanceBetween(point.x, point.y, originX, originY);
      if (pointDistance < EPSILON) continue;

      if (pointDistance < distanceBetween(originX, originY, closestPoint.x, closestPoint.y)) {
        closestPoint.x = point.x;
        closestPoint.y = point.y;
      }
    }
  }

  return closestPoint;
}

// ─── Core simulation tick ────────────────────────────────────────────────────

/**
 * Advance a single player entity by one tick.
 *
 * This is the ECS equivalent of Player.update(). It reads and writes component
 * arrays indexed by `eid`.
 *
 * @param GameWorld          ECS GameWorld
 * @param turnQueues     Sidecar map of entity → pending turns (consumed here)
 * @param targetTick     The tick we are advancing to
 * @param gameClock      Clock (for tickTimeMs)
 * @param obstacleLines  Pre-built collision lines (from buildObstacleLines)
 */
export function tickPlayerSystem(world: ECSGameWorld): void {
  for (const eid of Array.from(query(world, [Player]))) {
    tickPlayer(world, eid);
  }
}

/** Tick a single player entity (called from tickPlayerSystem or standalone). */
function tickPlayer(world: ECSGameWorld, eid: number): void {
  // Check for death
  if (!IsAlive[eid] || Rubber[eid] <= 0) {
    if (ShouldHandleDeath[eid]) {
      disablePlayer(eid);
    }
    return;
  }

  // Process one turn (max one per tick)
  const nextTurn = popTurn(world.turnQueues, eid);
  if (nextTurn) {
    executeTurn(eid, nextTurn.turn, world.tickTimeMs);
  }

  // Build detection rays
  const sensorFront = new SharedLine();
  const sensorLeft = new SharedLine();
  const sensorRight = new SharedLine();
  _buildDetectionLines(eid, sensorFront, sensorLeft, sensorRight);

  // Combine obstacle lines with self-trail for collision check
  const selfLines = getPlayerTrailLines(eid);
  const obstacleLines = _buildObstacleLinesExcluding(world, eid);
  const collisionLines = [...obstacleLines, ...selfLines];

  // Find closest intersections
  const pointFront = getClosestIntersectingPoint(sensorFront, collisionLines, Position.x[eid], Position.y[eid]);
  const pointLeft = getClosestIntersectingPoint(sensorLeft, collisionLines, Position.x[eid], Position.y[eid]);
  const pointRight = getClosestIntersectingPoint(sensorRight, collisionLines, Position.x[eid], Position.y[eid]);

  const distFront = distanceBetween(Position.x[eid], Position.y[eid], pointFront.x, pointFront.y);
  const distLeft = distanceBetween(Position.x[eid], Position.y[eid], pointLeft.x, pointLeft.y);
  const distRight = distanceBetween(Position.x[eid], Position.y[eid], pointRight.x, pointRight.y);

  // ─── Collision response ──────────────────────────────────────────────────
  IsColliding[eid] = 0;

  if (distFront < SLOW_DOWN_DISTANCE) {
    IsColliding[eid] = 1;

    const speedRatio = (distFront * distFront) / (SLOW_DOWN_DISTANCE * SLOW_DOWN_DISTANCE);
    _setSpeedAndVelocity(eid, TargetSpeedMult[eid] * speedRatio, world.tickTimeMs);

    // Drain rubber — faster at higher speeds
    Rubber[eid] -= DELTA_STUFF * 0.03 * (2 + TargetSpeedMult[eid]) ** 2;
  } else {
    // Recover rubber toward BASE_RUBBER
    if (Rubber[eid] < BASE_RUBBER) {
      Rubber[eid] += 0.006 * DELTA_STUFF;
    }
    // Restore normal speed
    _setSpeedAndVelocity(eid, TargetSpeedMult[eid], world.tickTimeMs);
  }

  // ─── Slide boost ─────────────────────────────────────────────────────────
  IsSliding[eid] = 0;

  if (distLeft < SLOW_DOWN_DISTANCE || distRight < SLOW_DOWN_DISTANCE) {
    TargetSpeedMult[eid] *= Math.pow(1.003, DELTA_STUFF / 16.666);
    IsSliding[eid] = 1;
  } else if (!IsColliding[eid] && TargetSpeedMult[eid] > 1) {
    TargetSpeedMult[eid] = Math.max(1, TargetSpeedMult[eid] - 0.0003 * DELTA_STUFF);
  }

  // ─── Move ────────────────────────────────────────────────────────────────
  Position.x[eid] += Velocity.vx[eid] / 1000;
  Position.y[eid] += Velocity.vy[eid] / 1000;

  // Clamp rubber
  Rubber[eid] = clamp(Rubber[eid], 0, BASE_RUBBER);
}

// ─── Turn execution ──────────────────────────────────────────────────────────

/** Execute a turn: update direction, add trail point, emit nothing (events are outside ECS). */
export function executeTurn(eid: number, type: 'left' | 'right', tickTimeMs: number): void {
  let newDirection = Direction[eid];

  if (type === 'left') {
    newDirection -= ROTATION_ANGLE;
  } else if (type === 'right') {
    newDirection += ROTATION_ANGLE;
  } else {
    throw new Error(`Invalid turn type: ${type}`);
  }

  newDirection = _normalizeDirection(newDirection);

  const trailN = TrailPoints.xs[eid].length;
  const lastX = trailN > 0 ? TrailPoints.xs[eid][trailN - 1] : Position.x[eid];
  const lastY = trailN > 0 ? TrailPoints.ys[eid][trailN - 1] : Position.y[eid];

  // If player hasn't moved since the last trail point, just update it
  if (trailN > 0 && Math.abs(Position.x[eid] - lastX) <= EPSILON && Math.abs(Position.y[eid] - lastY) <= EPSILON) {
    Direction[eid] = newDirection;
    _setSpeedAndVelocity(eid, SpeedMult[eid], tickTimeMs);
    TrailPoints.dirs[eid][trailN - 1] = newDirection;
    return;
  }

  // Add a new trail point at current position
  TrailPoints.xs[eid].push(Position.x[eid]);
  TrailPoints.ys[eid].push(Position.y[eid]);
  TrailPoints.dirs[eid].push(newDirection);

  Direction[eid] = newDirection;
  _setSpeedAndVelocity(eid, SpeedMult[eid], tickTimeMs);
}

// ─── Detection lines ─────────────────────────────────────────────────────────

function _buildDetectionLines(eid: number, front: SharedLine, left: SharedLine, right: SharedLine): void {
  const currentSpeed = SpeedMult[eid] || 0;
  const lookAheadLength = Math.max(2000, BASE_SPEED * currentSpeed * 0.5);

  front.setToAngle(Position.x[eid], Position.y[eid], Direction[eid], lookAheadLength);
  left.setToAngle(Position.x[eid], Position.y[eid], Direction[eid] - Math.PI / 2, lookAheadLength);
  right.setToAngle(Position.x[eid], Position.y[eid], Direction[eid] + Math.PI / 2, lookAheadLength);
}

/** Build obstacle lines from arena boundaries + all player trails except selfEid. */
function _buildObstacleLinesExcluding(world: ECSGameWorld, selfEid: number): SharedLine[] {
  const area = world.area;
  const lines: SharedLine[] = [
    new SharedLine(0, 0, area.width, 0),
    new SharedLine(area.width, 0, area.width, area.height),
    new SharedLine(area.width, area.height, 0, area.height),
    new SharedLine(0, area.height, 0, 0),
  ];

  for (const eid of Array.from(query(world, [Player]))) {
    if (eid === selfEid) continue;
    const xs = TrailPoints.xs[eid];
    const ys = TrailPoints.ys[eid];
    const n = xs.length;
    for (let i = 0; i < n - 1; i++) {
      lines.push(new SharedLine(xs[i], ys[i], xs[i + 1], ys[i + 1]));
    }
    if (n > 0) {
      lines.push(new SharedLine(xs[n - 1], ys[n - 1], Position.x[eid], Position.y[eid]));
    }
  }

  return lines;
}

// ─── Query helpers ───────────────────────────────────────────────────────────

/** Return true if the entity is a player. */
export function isPlayer(world: ECSGameWorld, eid: number): boolean {
  return hasComponent(world, eid, Player);
}

/** Return the eids of all player entities. */
export function getAllPlayerEids(world: ECSGameWorld): number[] {
  return Array.from(query(world, [Player]));
}

/** Get the entity id for a given player string id. Returns -1 if not found. */
export function getPlayerEidByStringId(world: ECSGameWorld, stringId: string): number {
  for (const eid of Array.from(query(world, [Player, PlayerId]))) {
    if (PlayerId[eid] === stringId) return eid;
  }
  return -1;
}
