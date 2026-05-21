/**
 * PlayerSystem — ECS-based player management for bitECS.
 *
 * Mirrors the game mechanics of the original Player class (Player.ts) but stores all
 * state in SoA component arrays, making snapshot/rollback trivial via bitECS's built-in
 * createSnapshotSerializer / createSnapshotDeserializer.
 */

import { addEntity, addComponents, hasComponent, query, resetWorld, removeEntity } from 'bitecs';
import { createSnapshotSerializer, createSnapshotDeserializer, f32, u8, u32, str, array } from 'bitecs/serialization';
import { SharedLine, lineToLineIntersection, distanceBetween, clamp, aabbOverlapsRay } from './math';
import { Arena, AreaWidth, AreaHeight, Lines } from './GameArea';
import { Logger } from './Logger';
import { ECSGameWorld } from './ECSGameWorld';
import { SystemSerializable, GetEvents } from './ECSSystem';
import { Networked } from './ECSNetworkSystem';
import { GameEventType } from './GameEvent';

const logger = new Logger('PlayerSystem');

// ─── Constants (mirroring Player statics) ────────────────────────────────────
const ROTATION_ANGLE = Math.PI / 2;
const BASE_SPEED = 150;
const BASE_RUBBER = 30;
const EPSILON = 1e-12;
const SLOW_DOWN_DISTANCE = 10;
const DELTA_STUFF = 12;

// ─── Components (SoA, typed for bitECS serialization) ────────────────────────

/** GameWorld-space position */
export const Position = { x: f32([]), y: f32([]) };

/** Per-tick velocity (x, y movement per tick × 1000) */
export const Velocity = { vx: f32([]), vy: f32([]) };

/** Heading in radians (must be multiple of PI/2) */
export const Direction = f32([]);

/** Current speed multiplier */
export const SpeedMult = f32([]);

/** Desired / target speed multiplier (drifts toward 1 when not sliding) */
export const TargetSpeedMult = f32([]);

/** Rubber resource (0 = death) */
export const Rubber = f32([]);

/** Whether the player is alive (1 = alive, 0 = dead) */
export const IsAlive = u8([]);

/** Flag to prevent death handling from firing more than once */
export const ShouldHandleDeath = u8([]);

/** Whether the player is currently sliding near a wall */
export const IsSliding = u8([]);

/** Whether the front sensor is inside the slow-down zone */
export const IsColliding = u8([]);

/** Player colour as 24-bit RGB integer */
export const Color = u32([]);

/** Human-readable player id (string) */
export const PlayerId = str([]);

/** Trail points stored as parallel SoA arrays per entity.
 *  TrailPoints.ticks[eid] is a number[], TrailPoints.xs[eid] is a number[], etc.
 *  All arrays for a given entity have the same length. */
export const TrailPoints = {
  xs: array(f32),
  ys: array(f32),
  dirs: array(f32),
};

/** Marker component — every player entity MUST have this tag */
export const Player = {};

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

// ─── Snapshot helpers ────────────────────────────────────────────────────────

export function createPlayerSnapshotSerializer(world: ECSGameWorld) {
  return createSnapshotSerializer(world, PLAYER_COMPONENTS);
}

export function createPlayerSnapshotDeserializer(world: ECSGameWorld) {
  return createSnapshotDeserializer(world, PLAYER_COMPONENTS);
}

/** Convenience: fully snapshot the GameWorld and reset it to a previous snapshot. */
export function rollbackWorld(
  world: ECSGameWorld,
  deserialize: ReturnType<typeof createSnapshotDeserializer>,
  buffer: ArrayBuffer
): void {
  resetWorld(world);
  deserialize(buffer);
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
  const lines: SharedLine[] = [];

  const [arenaEid] = query(world, [Arena]);
  if (arenaEid !== undefined) {
    for (let i = 0; i < Lines.x1[arenaEid].length; i++) {
      lines.push(
        new SharedLine(Lines.x1[arenaEid][i], Lines.y1[arenaEid][i], Lines.x2[arenaEid][i], Lines.y2[arenaEid][i])
      );
    }
  }

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

const MIN_COLOR_COMPONENT = 0x66;

function generatePlayerColor(): number {
  const r = MIN_COLOR_COMPONENT + Math.floor(Math.random() * (0x100 - MIN_COLOR_COMPONENT));
  const g = MIN_COLOR_COMPONENT + Math.floor(Math.random() * (0x100 - MIN_COLOR_COMPONENT));
  const b = MIN_COLOR_COMPONENT + Math.floor(Math.random() * (0x100 - MIN_COLOR_COMPONENT));
  return (r << 16) | (g << 8) | b;
}

export default class PlayerSystem extends SystemSerializable {
  readonly key = 'player';

  private _serializers = new Map<ECSGameWorld, ReturnType<typeof createSnapshotSerializer>>();
  private _deserializers = new Map<ECSGameWorld, ReturnType<typeof createSnapshotDeserializer>>();

  getComponents(): {}[] {
    return PLAYER_COMPONENTS;
  }

  /** Return true if the entity is a player. */
  static isPlayer(world: ECSGameWorld, eid: number): boolean {
    return hasComponent(world, eid, Player);
  }

  /** Return the eids of all player entities. */
  static getAllPlayerEids(world: ECSGameWorld): number[] {
    return Array.from(query(world, [Player]));
  }

  /** Get the entity id for a given player string id. Returns -1 if not found. */
  static getPlayerEidByStringId(world: ECSGameWorld, stringId: string): number {
    for (const eid of Array.from(query(world, [Player, PlayerId]))) {
      if (PlayerId[eid] === stringId) return eid;
    }
    return -1;
  }

  /** Add a new player entity and return its entity id. */
  static createPlayer(world: ECSGameWorld, id: string): number {
    const color = generatePlayerColor();
    const eid = addEntity(world);
    addComponents(world, eid, PLAYER_COMPONENTS);
    PlayerId[eid] = id;
    Color[eid] = color;

    // Defaults for lifecycle flags
    IsAlive[eid] = 0;
    ShouldHandleDeath[eid] = 0;
    IsSliding[eid] = 0;
    IsColliding[eid] = 0;

    // Position defaults (set to origin; spawnPlayer will place properly)
    Position.x[eid] = 0;
    Position.y[eid] = 0;
    Direction[eid] = 0;
    Rubber[eid] = BASE_RUBBER;
    TargetSpeedMult[eid] = 1;
    SpeedMult[eid] = 0;

    // Empty trail
    TrailPoints.xs[eid] = [];
    TrailPoints.ys[eid] = [];
    TrailPoints.dirs[eid] = [];

    // Zero velocity
    Velocity.vx[eid] = 0;
    Velocity.vy[eid] = 0;

    return eid;
  }

  static spawnPlayer(world: ECSGameWorld, eid: number) {
    logger.info('&&& Spawning entity ', eid);

    if (IsAlive[eid]) {
      logger.warn(`Entity ${eid} is already alive, cannot spawn.`);
      return;
    }

    const [arenaEid] = query(world, [Arena]);
    const width = AreaWidth[arenaEid];
    const height = AreaHeight[arenaEid];

    const x = 100 + Math.random() * (width - 200);
    const y = 100 + Math.random() * (height - 200);
    const direction = Math.floor(Math.random() * 4) * (Math.PI / 2);
    Position.x[eid] = x;
    Position.y[eid] = y;
    Direction[eid] = direction;
    Rubber[eid] = BASE_RUBBER;
    IsAlive[eid] = 1;
    ShouldHandleDeath[eid] = 1;
    TargetSpeedMult[eid] = 1;
    IsSliding[eid] = 0;
    IsColliding[eid] = 0;

    _setSpeedAndVelocity(eid, 1, world.tickTimeMs);

    // Single initial trail point at spawn location

    TrailPoints.xs[eid] = [x];
    TrailPoints.ys[eid] = [y];
    TrailPoints.dirs[eid] = [direction];

    logger.debug(PlayerId[eid], 'spawnPlayer()');
  }

  /** Immediately kill a player (zero speed, zero rubber, clear trail). */
  static disablePlayer(world: ECSGameWorld, eid: number): void {
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
    world.dirtyEntities.add(eid);
    logger.debug(PlayerId[eid], 'disable()');
  }

  static isAlive(world: ECSGameWorld, playerId: string): boolean {
    const eid = PlayerSystem.getPlayerEidByStringId(world, playerId);
    if (eid < 0) return false;
    return IsAlive[eid] === 1;
  }

  static removePlayerById(world: ECSGameWorld, playerId: string) {
    let eid = this.getPlayerEidByStringId(world, playerId);
    if (eid >= 0) {
      removeEntity(world, eid);
      logger.debug('--- Removed player', playerId);
      return;
    }
    logger.warn(`${playerId} doesn't exist`);
  }

  update(world: ECSGameWorld, getInput?: (entityId: string) => any, getEvents?: GetEvents): void {
    if (getEvents) {
      for (const event of getEvents()) {
        if (event.type === GameEventType.PlayerSpawn && event.entityId) {
          PlayerSystem.spawnPlayer(world, event.entityId);
          world.dirtyEntities.add(event.entityId);
        }
        if (event.type === GameEventType.PlayerLeft && event.entityId) {
          removeEntity(world, event.entityId);
          world.dirtyEntities.add(event.entityId);
        }
      }
    }

    for (const eid of Array.from(query(world, [Player]))) {
      // Check for death
      if (!IsAlive[eid] || Rubber[eid] <= 0) {
        if (ShouldHandleDeath[eid]) {
          PlayerSystem.disablePlayer(world, eid);
        }
        continue;
      }

      // Process one turn (max one per tick)
      const playerId = PlayerId[eid];
      const input = getInput?.(playerId);
      if (input?.turn) {
        executeTurn(eid, input.turn, world.tickTimeMs);
        world.dirtyEntities.add(eid);
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
  }

  serialize(world: ECSGameWorld, eids: readonly number[]): ArrayBuffer {
    let serializer = this._serializers.get(world);
    if (!serializer) {
      serializer = createSnapshotSerializer(world, PLAYER_COMPONENTS);
      this._serializers.set(world, serializer);
    }
    return serializer(eids);
  }

  deserialize(world: ECSGameWorld, buffer: ArrayBuffer): Map<number, number> {
    let deserializer = this._deserializers.get(world);
    if (!deserializer) {
      deserializer = createSnapshotDeserializer(world, PLAYER_COMPONENTS);
      this._deserializers.set(world, deserializer);
    }
    return deserializer(buffer);
  }
}
