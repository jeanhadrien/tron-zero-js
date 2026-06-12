/**
 * PlayerSystem — ECS-based player management for bitECS.
 *
 * Mirrors the game mechanics of the original Player class (Player.ts) but stores all
 * state in SoA component arrays, making snapshot/rollback trivial via bitECS's built-in
 * createSnapshotSerializer / createSnapshotDeserializer.
 */

import { addEntity, addComponents, hasComponent, query, removeEntity, World } from 'bitecs';
import { createSnapshotSerializer, createSnapshotDeserializer, f32, u8, u32, str, array } from 'bitecs/serialization';
import { SharedLine, distanceBetween, clamp, EPSILON } from '../math';
import { TRAIL_MAX_LENGTH, consumeTrailFromTailPure, computeTrailArcLengthFromArrays } from '../trail';
import { closestHitAmongLines } from '../spatial/rayIntersection';
import { SPATIAL_SHADOW_DIFF } from '../spatial/constants';
import { diffTrailConsume } from '../spatial/trailDiff';

import { Arena, AreaWidth, AreaHeight, Lines } from './GameArenaSystem';
import { Logger } from '../Logger';
import { SystemSerializable, eventGetter, inputGetter } from '../interfaces/System';
import { Networked } from '../interfaces/Network';
import { GameEventType } from '../interfaces/GameEvent';
import type { SimulationContext } from '../interfaces/SimulationContext';

const logger = new Logger('PlayerSystem');

// ─── Constants (mirroring Player statics) ────────────────────────────────────
const ROTATION_ANGLE = Math.PI / 2;
const BASE_SPEED = 360;
export const BASE_RUBBER = 120;
const SLOW_DOWN_DISTANCE = 12;
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

/** Trail X coordinates — bitecs object component so the array is serialised correctly. */
export const TrailPointsXs = { data: array(f32) };

/** Trail Y coordinates — bitecs object component so the array is serialised correctly. */
export const TrailPointsYs = { data: array(f32) };

/** Trail directions — bitecs object component so the array is serialised correctly. */
export const TrailPointsDirs = { data: array(f32) };

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
  TrailPointsXs,
  TrailPointsYs,
  TrailPointsDirs,
  Player,
  Networked,
];

// ─── Internal helpers ────────────────────────────────────────────────────────

function _normalizeDirection(d: number): number {
  let nd = d % (Math.PI * 2);
  if (nd < 0) nd += Math.PI * 2;
  return nd;
}

function _resolveActiveSegmentOwners(ctx: SimulationContext): number[] {
  const result: number[] = [];
  for (const eid of Array.from(query(ctx.world, [Player]))) {
    if (IsAlive[eid] !== 1) continue;
    if (TrailPointsXs.data[eid].length === 0) continue;
    result.push(eid);
  }
  return result;
}

/** Map a cardinal direction (multiples of π/2) to velocity on exactly one axis. */
function _velocityAlongDirection(direction: number, stepDist: number): { vx: number; vy: number } {
  const quarter = ((Math.round(_normalizeDirection(direction) / ROTATION_ANGLE) % 4) + 4) % 4;
  const v = stepDist * 1000;

  switch (quarter) {
    case 0:
      return { vx: v, vy: 0 };
    case 1:
      return { vx: 0, vy: v };
    case 2:
      return { vx: -v, vy: 0 };
    case 3:
      return { vx: 0, vy: -v };
    default:
      return { vx: 0, vy: 0 };
  }
}

function _setSpeedAndVelocity(eid: number, speedMult: number, tickTimeMs: number): void {
  const stepDist = (BASE_SPEED * speedMult * tickTimeMs) / 1000;
  const { vx, vy } = _velocityAlongDirection(Direction[eid], stepDist);
  Velocity.vx[eid] = vx;
  Velocity.vy[eid] = vy;
  SpeedMult[eid] = speedMult;
}

/** Set velocity so that vx/1000 (or vy/1000) equals stepDist along heading. */
function _setVelocityFromStep(eid: number, stepDist: number, tickTimeMs: number): void {
  const { vx, vy } = _velocityAlongDirection(Direction[eid], stepDist);
  Velocity.vx[eid] = vx;
  Velocity.vy[eid] = vy;
  SpeedMult[eid] = tickTimeMs > EPSILON ? (stepDist * 1000) / (BASE_SPEED * tickTimeMs) : 0;
}

// ─── Public geometry helpers ─────────────────────────────────────────────────

export function computeTrailArcLength(eid: number): number {
  return computeTrailArcLengthFromArrays(
    TrailPointsXs.data[eid],
    TrailPointsYs.data[eid],
    Position.x[eid],
    Position.y[eid]
  );
}

export function consumeTrailFromTail(ctx: SimulationContext, eid: number, distance: number): void {
  const before = {
    xs: TrailPointsXs.data[eid],
    ys: TrailPointsYs.data[eid],
    n: TrailPointsXs.data[eid].length,
  };

  const { xs, ys, dirs } = consumeTrailFromTailPure(
    TrailPointsXs.data[eid],
    TrailPointsYs.data[eid],
    TrailPointsDirs.data[eid],
    Position.x[eid],
    Position.y[eid],
    Direction[eid],
    distance
  );
  TrailPointsXs.data[eid] = xs;
  TrailPointsYs.data[eid] = ys;
  TrailPointsDirs.data[eid] = dirs;

  const diff = diffTrailConsume(before, { xs, ys, n: xs.length }, Position.x[eid], Position.y[eid]);
  ctx.spatialGrid?.onTrailTailConsumed(eid, diff);
}

function enforceTrailMaxLength(ctx: SimulationContext, eid: number): void {
  const excess = computeTrailArcLength(eid) - TRAIL_MAX_LENGTH * ctx.clock.referenceTickTimeMs;
  if (excess > EPSILON) {
    const nBefore = TrailPointsXs.data[eid].length;
    consumeTrailFromTail(ctx, eid, excess);
    const nAfter = TrailPointsXs.data[eid].length;
    if (nBefore - nAfter >= 2) {
      logger.debug(`trail trim eid=${eid} consumed=${excess.toFixed(2)} points=${nBefore}→${nAfter}`);
    }
    //ctx.dirtyEntities.add(eid);
  }
}

/** Build SharedLine[] from a player's trail — shadow-diff / legacy fallback only. */
function getPlayerTrailLines(eid: number): SharedLine[] {
  const lines: SharedLine[] = [];
  const xs = TrailPointsXs.data[eid];
  const ys = TrailPointsYs.data[eid];
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
  return closestHitAmongLines(sensorLine, obstacleLines, originX, originY);
}

// ─── Core simulation tick ────────────────────────────────────────────────────

// ─── Turn execution ──────────────────────────────────────────────────────────

/** Execute a turn: update direction, add trail point at current position. */
export function executeTurn(ctx: SimulationContext, eid: number, type: 'left' | 'right', tickTimeMs: number): void {
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

  const trailN = TrailPointsXs.data[eid].length;
  const lastX = trailN > 0 ? TrailPointsXs.data[eid][trailN - 1] : interpX;
  const lastY = trailN > 0 ? TrailPointsYs.data[eid][trailN - 1] : interpY;

  // If player hasn't moved since the last trail point, just update it
  if (trailN > 0 && Math.abs(interpX - lastX) <= EPSILON && Math.abs(interpY - lastY) <= EPSILON) {
    Direction[eid] = newDirection;
    _setSpeedAndVelocity(eid, SpeedMult[eid], tickTimeMs);
    TrailPointsDirs.data[eid] = [...TrailPointsDirs.data[eid]];
    TrailPointsDirs.data[eid][trailN - 1] = newDirection;
    ctx.dirtyEntities.add(eid);
    return;
  }

  // Add a new trail point at current position
  TrailPointsXs.data[eid] = [...TrailPointsXs.data[eid], interpX];
  TrailPointsYs.data[eid] = [...TrailPointsYs.data[eid], interpY];
  TrailPointsDirs.data[eid] = [...TrailPointsDirs.data[eid], newDirection];

  const newPointIndex = TrailPointsXs.data[eid].length - 1;
  ctx.spatialGrid?.onTrailTurnNewPoint(eid, newPointIndex);

  Direction[eid] = newDirection;
  _setSpeedAndVelocity(eid, SpeedMult[eid], tickTimeMs);
  ctx.dirtyEntities.add(eid);
}

// ─── Detection lines ─────────────────────────────────────────────────────────

export function buildDetectionLines(eid: number, front: SharedLine, left: SharedLine, right: SharedLine): void {
  const currentSpeed = SpeedMult[eid] || 0;
  const lookAheadLength = Math.max(2000, BASE_SPEED * currentSpeed * 0.5);

  front.setToAngle(Position.x[eid], Position.y[eid], Direction[eid], lookAheadLength);
  left.setToAngle(Position.x[eid], Position.y[eid], Direction[eid] - Math.PI / 2, lookAheadLength);
  right.setToAngle(Position.x[eid], Position.y[eid], Direction[eid] + Math.PI / 2, lookAheadLength);
}

/** Build obstacle lines — shadow-diff / legacy fallback only. */
function buildObstacleLinesExcluding(ctx: SimulationContext, selfEid: number): SharedLine[] {
  const lines: SharedLine[] = [];

  const [arenaEid] = query(ctx.world, [Arena]);
  if (arenaEid !== undefined) {
    for (let i = 0; i < Lines.x1[arenaEid].length; i++) {
      lines.push(
        new SharedLine(Lines.x1[arenaEid][i], Lines.y1[arenaEid][i], Lines.x2[arenaEid][i], Lines.y2[arenaEid][i])
      );
    }
  }

  for (const eid of Array.from(query(ctx.world, [Player]))) {
    if (eid === selfEid) continue;
    const xs = TrailPointsXs.data[eid];
    const ys = TrailPointsYs.data[eid];
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
    s = (s + 0x6d2b79f5) | 0;
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

  private _serializers = new Map<World, ReturnType<typeof createSnapshotSerializer>>();
  private _deserializers = new Map<World, ReturnType<typeof createSnapshotDeserializer>>();
  ctx: SimulationContext;

  getComponents(): object[] {
    return PLAYER_COMPONENTS;
  }

  init(ctx: SimulationContext) {
    this.ctx = ctx;
    this._serializers.clear();
    this._deserializers.clear();
  }

  /** Return true if the entity is a player. */
  static isPlayer(ctx: SimulationContext, eid: number): boolean {
    return hasComponent(ctx.world, eid, Player);
  }

  /** Return the eids of all player entities. */
  static getAllPlayerEids(ctx: SimulationContext): number[] {
    return Array.from(query(ctx.world, [Player]));
  }

  /** Return eids of alive players. */
  static getAlivePlayerEids(ctx: SimulationContext): number[] {
    const result: number[] = [];
    for (const eid of Array.from(query(ctx.world, [Player]))) {
      if (IsAlive[eid] === 1) result.push(eid);
    }
    return result;
  }

  /** Get the entity id for a given player string id. Returns -1 if not found. */
  static getPlayerEidByStringId(ctx: SimulationContext, stringId: string): number | null {
    for (const eid of Array.from(query(ctx.world, [Player, PlayerId]))) {
      if (PlayerId[eid] === stringId) return eid;
    }
    return null;
  }

  /** Add a new player entity and return its entity id. */
  static createPlayer(ctx: SimulationContext, playerId: string): number {
    logger.info('Creating Player', playerId);
    const color = generatePlayerColor();
    const eid = addEntity(ctx.world);
    addComponents(ctx.world, eid, PLAYER_COMPONENTS);
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
    TrailPointsXs.data[eid] = [];
    TrailPointsYs.data[eid] = [];
    TrailPointsDirs.data[eid] = [];

    // Zero velocity
    Velocity.vx[eid] = 0;
    Velocity.vy[eid] = 0;

    ctx.dirtyEntities.add(eid);
    ctx.spatialGrid?.onPlayerSpawn(eid);

    return eid;
  }

  /** Spawn a player at a deterministic position derived from playerId and the event's tick. */
  static spawnPlayer(ctx: SimulationContext, playerId: string, seedTick: number) {
    logger.info('&&& Spawning entity', playerId);
    const eid = this.getPlayerEidByStringId(ctx, playerId);

    if (!eid) {
      logger.error('Skipping spawning playerId', playerId, 'not found');
      return;
    }

    if (IsAlive[eid]) {
      logger.warn(`Entity ${eid} is already alive, cannot spawn.`);
      return;
    }

    const [arenaEid] = query(ctx.world, [Arena]);
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

    _setSpeedAndVelocity(eid, 1, ctx.clock.referenceTickTimeMs);

    // Single initial trail point at spawn location
    TrailPointsXs.data[eid] = [x];
    TrailPointsYs.data[eid] = [y];
    TrailPointsDirs.data[eid] = [direction];
    ctx.dirtyEntities.add(eid);
    logger.debug(PlayerId[eid], 'spawnPlayer()');
  }

  /** Immediately kill a player (zero speed, zero rubber, clear trail). */
  static disablePlayer(ctx: SimulationContext, eid: number): void {
    SpeedMult[eid] = 0;
    TargetSpeedMult[eid] = 0;
    Velocity.vx[eid] = 0;
    Velocity.vy[eid] = 0;
    Rubber[eid] = 0;
    IsAlive[eid] = 0;
    ShouldHandleDeath[eid] = 0;
    IsSliding[eid] = 0;
    IsColliding[eid] = 0;
    TrailPointsXs.data[eid] = [];
    TrailPointsYs.data[eid] = [];
    TrailPointsDirs.data[eid] = [];
    ctx.spatialGrid?.onPlayerDisabled(eid);
    ctx.dirtyEntities.add(eid);
    logger.debug(PlayerId[eid], 'disable()');
  }

  static isAlive(ctx: SimulationContext, playerId: string): boolean {
    const eid = PlayerSystem.getPlayerEidByStringId(ctx, playerId);
    if (!eid || eid < 0) return false;
    return IsAlive[eid] === 1;
  }

  static removePlayerById(ctx: SimulationContext, playerId: string) {
    const eid = this.getPlayerEidByStringId(ctx, playerId);
    if (!eid) {
      logger.warn(`${playerId} doesn't exist`);
      return;
    }
    if (eid >= 0) {
      ctx.spatialGrid?.onPlayerRemoved(eid);
      removeEntity(ctx.world, eid);
      logger.debug('--- Removed player', playerId);
      return;
    }
  }

  update(getInput: inputGetter, getEvents: eventGetter): void {
    if (getEvents) {
      for (const event of getEvents()) {
        if (event.type === GameEventType.PlayerJoined) {
          PlayerSystem.createPlayer(this.ctx, event.playerId!);
        } else if (event.type === GameEventType.PlayerSpawn) {
          PlayerSystem.spawnPlayer(this.ctx, event.playerId!, event.tick);
        } else if (event.type === GameEventType.PlayerLeft) {
          const playerId = event.playerId;
          if (playerId) {
            const eid = PlayerSystem.getPlayerEidByStringId(this.ctx, playerId);
            if (!eid) {
              logger.warn(`PlayerLeft for non-existent player: ${playerId}`);
              continue;
            }
            this.ctx.spatialGrid?.onPlayerRemoved(eid);
            removeEntity(this.ctx.world, eid);
            this.ctx.dirtyEntities.add(eid);
            logger.debug('Removed player', playerId);
          }
        }
      }
    }

    for (const eid of Array.from(query(this.ctx.world, [Player]))) {
      // Check for death
      if (!IsAlive[eid] || Rubber[eid] <= 0) {
        if (ShouldHandleDeath[eid]) {
          PlayerSystem.disablePlayer(this.ctx, eid);
        }
        continue;
      }

      // Process one turn (max one per tick)
      const playerId = PlayerId[eid];
      const input = getInput?.(playerId);

      if (input?.turn) {
        executeTurn(this.ctx, eid, input.turn, this.ctx.clock.referenceTickTimeMs);
      }

      // Build detection rays
      const sensorFront = new SharedLine();
      const sensorLeft = new SharedLine();
      const sensorRight = new SharedLine();
      buildDetectionLines(eid, sensorFront, sensorLeft, sensorRight);

      const spatial = this.ctx.spatialQuery;
      const rayOpts = { includeActiveFor: _resolveActiveSegmentOwners(this.ctx) };
      const ox = Position.x[eid];
      const oy = Position.y[eid];

      let distFront: number;
      let distLeft: number;
      let distRight: number;

      if (spatial) {
        const hitFront = spatial.queryNearestAlongRay(sensorFront, ox, oy, rayOpts);
        const hitLeft = spatial.queryNearestAlongRay(sensorLeft, ox, oy, rayOpts);
        const hitRight = spatial.queryNearestAlongRay(sensorRight, ox, oy, rayOpts);
        distFront = hitFront.distance;
        distLeft = hitLeft.distance;
        distRight = hitRight.distance;

        if (SPATIAL_SHADOW_DIFF) {
          const selfLines = getPlayerTrailLines(eid);
          const obstacleLines = buildObstacleLinesExcluding(this.ctx, eid);
          const collisionLines = [...obstacleLines, ...selfLines];
          const legacyFront = getClosestIntersectingPoint(sensorFront, collisionLines, ox, oy);
          const legacyDist = distanceBetween(ox, oy, legacyFront.x, legacyFront.y);
          if (Math.abs(distFront - legacyDist) > EPSILON) {
            logger.debug('spatial shadow diff', { eid, ray: 'front', spatial: distFront, legacy: legacyDist });
          }
        }
      } else {
        const selfLines = getPlayerTrailLines(eid);
        const obstacleLines = buildObstacleLinesExcluding(this.ctx, eid);
        const collisionLines = [...obstacleLines, ...selfLines];
        const pointFront = getClosestIntersectingPoint(sensorFront, collisionLines, ox, oy);
        const pointLeft = getClosestIntersectingPoint(sensorLeft, collisionLines, ox, oy);
        const pointRight = getClosestIntersectingPoint(sensorRight, collisionLines, ox, oy);
        distFront = distanceBetween(ox, oy, pointFront.x, pointFront.y);
        distLeft = distanceBetween(ox, oy, pointLeft.x, pointLeft.y);
        distRight = distanceBetween(ox, oy, pointRight.x, pointRight.y);
      }

      // ─── Collision response ──────────────────────────────────────────────────
      IsColliding[eid] = 0;
      const inRubberZone = distFront < SLOW_DOWN_DISTANCE;
      const rubberSpeedRatio = inRubberZone ? (distFront * distFront) / (SLOW_DOWN_DISTANCE * SLOW_DOWN_DISTANCE) : 1;

      if (inRubberZone) {
        IsColliding[eid] = 1;
        const zenoMove = distFront > EPSILON ? distFront * rubberSpeedRatio : 0;
        _setVelocityFromStep(eid, zenoMove, this.ctx.clock.referenceTickTimeMs);

        // Drain rubber — faster at higher speeds
        Rubber[eid] -= DELTA_STUFF * 0.03 * (1 + TargetSpeedMult[eid]) ** 3;
      } else {
        // Recover rubber toward BASE_RUBBER
        if (Rubber[eid] < BASE_RUBBER) {
          Rubber[eid] += 0.006 * this.ctx.clock.referenceTickTimeMs * DELTA_STUFF;
        }
        // Restore normal speed
        _setSpeedAndVelocity(eid, TargetSpeedMult[eid], this.ctx.clock.referenceTickTimeMs);
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

      // ─── Fixed-distance trail ────────────────────────────────────────────────
      enforceTrailMaxLength(this.ctx, eid);

      // Clamp rubber
      Rubber[eid] = clamp(Rubber[eid], 0, BASE_RUBBER);
    }
  }

  serialize(ctx: SimulationContext, eids: readonly number[]): ArrayBuffer {
    let serializer = this._serializers.get(ctx.world);
    if (!serializer) {
      serializer = createSnapshotSerializer(ctx.world, PLAYER_COMPONENTS);
      this._serializers.set(ctx.world, serializer);
    }
    return serializer(eids);
  }

  deserialize(ctx: SimulationContext, buffer: ArrayBuffer): Map<number, number> {
    let deserializer = this._deserializers.get(ctx.world);
    if (!deserializer) {
      deserializer = createSnapshotDeserializer(ctx.world, PLAYER_COMPONENTS);
      this._deserializers.set(ctx.world, deserializer);
    }
    return deserializer(buffer);
  }
}
