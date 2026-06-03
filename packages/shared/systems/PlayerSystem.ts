/**
 * PlayerSystem — ECS-based player management for bitECS.
 *
 * Mirrors the game mechanics of the original Player class (Player.ts) but stores all
 * state in SoA component arrays, making snapshot/rollback trivial via bitECS's built-in
 * createSnapshotSerializer / createSnapshotDeserializer.
 */

import { addEntity, addComponents, hasComponent, query, removeEntity } from 'bitecs';
import { createSnapshotSerializer, createSnapshotDeserializer, f32, u8, u32, str, array } from 'bitecs/serialization';
import { SharedLine, lineToLineIntersection, distanceBetween, clamp, aabbOverlapsRay } from '../math';
import { Arena, AreaWidth, AreaHeight, Lines } from './GameArenaSystem';
import { Logger } from '../Logger';
import { SystemSerializable, eventGetter, inputGetter } from '../interfaces/System';
import { Networked } from '../interfaces/Network';
import { GameEventType } from '../interfaces/GameEvent';
import { ECSGameRoom } from '../ECSGameRoom';

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

export const PingInTicks = f32([]);

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
  PingInTicks,
];

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
  const closestPoint = { x: Infinity, y: Infinity };
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

/** Execute a turn: update direction, add trail point at current position. */
export function executeTurn(room: ECSGameRoom, eid: number, type: 'left' | 'right', tickTimeMs: number): void {
  let newDirection = Direction[eid];

  if (type === 'left') {
    newDirection -= ROTATION_ANGLE;
  } else if (type === 'right') {
    newDirection += ROTATION_ANGLE;
  } else {
    throw new Error(`Invalid turn type: ${type}`);
  }

  newDirection = _normalizeDirection(newDirection);

  const interpX = Position.x[eid];
  const interpY = Position.y[eid];

  const trailN = TrailPoints.xs[eid].length;
  const lastX = trailN > 0 ? TrailPoints.xs[eid][trailN - 1] : interpX;
  const lastY = trailN > 0 ? TrailPoints.ys[eid][trailN - 1] : interpY;

  // If player hasn't moved since the last trail point, just update it
  if (trailN > 0 && Math.abs(interpX - lastX) <= EPSILON && Math.abs(interpY - lastY) <= EPSILON) {
    Direction[eid] = newDirection;
    _setSpeedAndVelocity(eid, SpeedMult[eid], tickTimeMs);
    TrailPoints.dirs[eid] = [...TrailPoints.dirs[eid]];
    TrailPoints.dirs[eid][trailN - 1] = newDirection;
    return;
  }

  // Add a new trail point at current position
  TrailPoints.xs[eid] = [...TrailPoints.xs[eid], interpX];
  TrailPoints.ys[eid] = [...TrailPoints.ys[eid], interpY];
  TrailPoints.dirs[eid] = [...TrailPoints.dirs[eid], newDirection];

  Direction[eid] = newDirection;
  _setSpeedAndVelocity(eid, SpeedMult[eid], tickTimeMs);
  room.dirtyEntities.add(eid);
}

// ─── Detection lines ─────────────────────────────────────────────────────────

export function buildDetectionLines(eid: number, front: SharedLine, left: SharedLine, right: SharedLine): void {
  const currentSpeed = SpeedMult[eid] || 0;
  const lookAheadLength = Math.max(2000, BASE_SPEED * currentSpeed * 0.5);

  front.setToAngle(Position.x[eid], Position.y[eid], Direction[eid], lookAheadLength);
  left.setToAngle(Position.x[eid], Position.y[eid], Direction[eid] - Math.PI / 2, lookAheadLength);
  right.setToAngle(Position.x[eid], Position.y[eid], Direction[eid] + Math.PI / 2, lookAheadLength);
}

/** Build obstacle lines from arena boundaries + all player trails except selfEid. */
export function buildObstacleLinesExcluding(room: ECSGameRoom, selfEid: number): SharedLine[] {
  const lines: SharedLine[] = [];

  const [arenaEid] = query(room.world, [Arena]);
  if (arenaEid !== undefined) {
    for (let i = 0; i < Lines.x1[arenaEid].length; i++) {
      lines.push(
        new SharedLine(Lines.x1[arenaEid][i], Lines.y1[arenaEid][i], Lines.x2[arenaEid][i], Lines.y2[arenaEid][i])
      );
    }
  }

  for (const eid of Array.from(query(room.world, [Player]))) {
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

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash;
}

/** mulberry32 — fast, good distribution, deterministic given a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generatePlayerColor(): number {
  const r = 0x66 + Math.floor(Math.random() * (0x100 - 0x66));
  const g = 0x66 + Math.floor(Math.random() * (0x100 - 0x66));
  const b = 0x66 + Math.floor(Math.random() * (0x100 - 0x66));
  return (r << 16) | (g << 8) | b;
}

export default class PlayerSystem extends SystemSerializable {
  readonly key = 'player';

  private _serializers = new Map<ECSGameRoom, ReturnType<typeof createSnapshotSerializer>>();
  private _deserializers = new Map<ECSGameRoom, ReturnType<typeof createSnapshotDeserializer>>();
  room: ECSGameRoom;

  getComponents(): object[] {
    return PLAYER_COMPONENTS;
  }

  init(room: ECSGameRoom) {
    this.room = room;
  }

  /** Return true if the entity is a player. */
  static isPlayer(room: ECSGameRoom, eid: number): boolean {
    return hasComponent(room.world, eid, Player);
  }

  /** Return the eids of all player entities. */
  static getAllPlayerEids(room: ECSGameRoom): number[] {
    return Array.from(query(room.world, [Player]));
  }

  /** Get the entity id for a given player string id. Returns -1 if not found. */
  static getPlayerEidByStringId(room: ECSGameRoom, stringId: string): number {
    for (const eid of Array.from(query(room.world, [Player, PlayerId]))) {
      if (PlayerId[eid] === stringId) return eid;
    }
    throw new Error(`Couldn't get eid for player ${stringId}`);
  }

  /** Add a new player entity and return its entity id. */
  static createPlayer(room: ECSGameRoom, playerId: string): number {
    logger.info('Creating Player', playerId);
    const color = generatePlayerColor();
    const eid = addEntity(room.world);
    addComponents(room.world, eid, PLAYER_COMPONENTS);
    PlayerId[eid] = playerId;
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

  /** Spawn a player at a deterministic position derived from playerId and the event's tick. */
  static spawnPlayer(room: ECSGameRoom, playerId: string, seedTick: number) {
    logger.info('&&& Spawning entity', playerId);
    const eid = this.getPlayerEidByStringId(room, playerId);

    if (IsAlive[eid]) {
      logger.warn(`Entity ${eid} is already alive, cannot spawn.`);
      return;
    }

    const [arenaEid] = query(room.world, [Arena]);
    const width = AreaWidth[arenaEid];
    const height = AreaHeight[arenaEid];

    const rng = mulberry32(hashString(playerId) ^ seedTick);
    const x = 100 + rng() * (width - 200);
    const y = 100 + rng() * (height - 200);
    const direction = Math.floor(rng() * 4) * (Math.PI / 2);
    Position.x[eid] = x;
    Position.y[eid] = y;
    Direction[eid] = direction;
    Rubber[eid] = BASE_RUBBER;
    IsAlive[eid] = 1;
    ShouldHandleDeath[eid] = 1;
    TargetSpeedMult[eid] = 1;
    IsSliding[eid] = 0;
    IsColliding[eid] = 0;

    _setSpeedAndVelocity(eid, 1, room.clock.tickTimeMs);

    // Single initial trail point at spawn location

    TrailPoints.xs[eid] = [x];
    TrailPoints.ys[eid] = [y];
    TrailPoints.dirs[eid] = [direction];
    room.dirtyEntities.add(eid);
    logger.debug(PlayerId[eid], 'spawnPlayer()');
  }

  /** Immediately kill a player (zero speed, zero rubber, clear trail). */
  static disablePlayer(room: ECSGameRoom, eid: number): void {
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
    room.dirtyEntities.add(eid);
    logger.debug(PlayerId[eid], 'disable()');
  }

  static isAlive(room: ECSGameRoom, playerId: string): boolean {
    const eid = PlayerSystem.getPlayerEidByStringId(room, playerId);
    if (!eid || eid < 0) return false;
    return IsAlive[eid] === 1;
  }

  static removePlayerById(room: ECSGameRoom, playerId: string) {
    const eid = this.getPlayerEidByStringId(room, playerId);
    if (!eid) {
      logger.warn(`${playerId} doesn't exist`);
      return;
    }
    if (eid >= 0) {
      removeEntity(room.world, eid);
      logger.debug('--- Removed player', playerId);
      return;
    }
  }

  update(getInput: inputGetter, getEvents: eventGetter): void {
    if (getEvents) {
      for (const event of getEvents()) {
        if (event.type === GameEventType.PlayerJoined) {
          PlayerSystem.createPlayer(this.room, event.playerId!);
        }
        if (event.type === GameEventType.PlayerSpawn) {
          PlayerSystem.spawnPlayer(this.room, event.playerId!, event.tick);
        }
        if (event.type === GameEventType.PlayerLeft) {
          const playerId = event.playerId;
          if (playerId) {
            try {
              const eid = PlayerSystem.getPlayerEidByStringId(this.room, playerId);
              removeEntity(this.room.world, eid);
              this.room.dirtyEntities.add(eid);
              logger.debug('Removed player', playerId);
            } catch {
              logger.warn(`PlayerLeft for non-existent player: ${playerId}`);
            }
          }
        }
      }
    }

    for (const eid of Array.from(query(this.room.world, [Player]))) {
      // Check for death
      if (!IsAlive[eid] || Rubber[eid] <= 0) {
        if (ShouldHandleDeath[eid]) {
          PlayerSystem.disablePlayer(this.room, eid);
        }
        continue;
      }

      // Process one turn (max one per tick)
      const playerId = PlayerId[eid];
      const input = getInput?.(playerId);

      if (input?.turn) {
        executeTurn(this.room, eid, input.turn, this.room.clock.tickTimeMs);
      }

      // Build detection rays
      const sensorFront = new SharedLine();
      const sensorLeft = new SharedLine();
      const sensorRight = new SharedLine();
      buildDetectionLines(eid, sensorFront, sensorLeft, sensorRight);

      // Combine obstacle lines with self-trail for collision check
      const selfLines = getPlayerTrailLines(eid);
      const obstacleLines = buildObstacleLinesExcluding(this.room, eid);
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
        _setSpeedAndVelocity(eid, TargetSpeedMult[eid] * speedRatio, this.room.clock.tickTimeMs);

        // Drain rubber — faster at higher speeds
        Rubber[eid] -= DELTA_STUFF * 0.03 * (2 + TargetSpeedMult[eid]) ** 2;
      } else {
        // Recover rubber toward BASE_RUBBER
        if (Rubber[eid] < BASE_RUBBER) {
          Rubber[eid] += 0.006 * DELTA_STUFF;
        }
        // Restore normal speed
        _setSpeedAndVelocity(eid, TargetSpeedMult[eid], this.room.clock.tickTimeMs);
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

  serialize(room: ECSGameRoom, eids: readonly number[]): ArrayBuffer {
    let serializer = this._serializers.get(room);
    if (!serializer) {
      serializer = createSnapshotSerializer(room.world, PLAYER_COMPONENTS);
      this._serializers.set(room, serializer);
    }
    return serializer(eids);
  }

  deserialize(room: ECSGameRoom, buffer: ArrayBuffer): Map<number, number> {
    let deserializer = this._deserializers.get(room);
    if (!deserializer) {
      deserializer = createSnapshotDeserializer(room.world, PLAYER_COMPONENTS);
      this._deserializers.set(room, deserializer);
    }
    return deserializer(buffer);
  }
}
