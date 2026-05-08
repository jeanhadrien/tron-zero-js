import { PlayerTrail } from './PlayerTrail';
import { PlayerPoint } from './PlayerPoint';
import { PlayerEventBus } from './PlayerStateEventBus';
import GameArea from './GameArea';
import GameClock from './GameClock';
import {
  SharedLine,
  lineToLineIntersection,
  distanceBetween,
  clamp,
  aabbOverlapsRay,
} from './math';
import PlayerTrailDTO from './PlayerTrailDTO';

export const ROTATION_ANGLE = Math.PI / 2;
export const BASE_SPEED = 100;
export const MAX_RUBBER = 10;
export const EPSILON = 1e-12;

export interface PlayerDTO {
  id: string;
  x: number;
  y: number;
  direction: number;
  speedMult: number;
  targetSpeedMult: number;
  rubber: number;
  isRunning: boolean;
  color: number;
  velocity: number[];
  trail: PlayerTrailDTO;
  tick: number;
}

export default class Player {
  public static readonly ROTATION_ANGLE: number = Math.PI / 2;
  public static readonly BASE_SPEED: number = 150;
  public static readonly MAX_SPEED: number = 500;
  public static readonly DETECTION_LINE_LENGTH: number = 30;
  public static readonly TRAIL_MAX_LENGTH = 100;
  public static readonly BASE_RUBBER = 30;
  public static readonly TURN_DELAY_TICKS = 10;

  eventBus: PlayerEventBus;

  // state
  id: string;
  currentTick: number;
  isRunning: boolean = false;
  rubber: number;

  // position
  x: number;
  y: number;
  direction: number;
  velocity: number[] = [0, 0];
  speedMult: number = 1;
  targetSpeedMult: number = 1;

  // trail
  trail: PlayerTrail = new PlayerTrail(this);
  turnQueue: { tick: number; type: string }[] = [];

  color: number;

  detectionLine: SharedLine;
  detectionLineLeft: SharedLine;
  detectionLineRight: SharedLine;

  collisionDistanceFront: number = Infinity;
  collisionDistanceLeft: number = Infinity;
  collisionDistanceRight: number = Infinity;

  shouldHandleDeath: boolean;
  isSliding: boolean;
  isColliding: boolean;

  constructor(
    bus: PlayerEventBus,
    tick: number,
    x: number,
    y: number,
    direction: number,
    color: number
  ) {
    this.eventBus = bus;
    this.id = Math.random().toString(36).substring(7);
    this.x = x;
    this.y = y;
    this.direction = direction;
    this.color = color;
    this.velocity = [0, 0];
    this.speedMult = 1;
    this.isRunning = false;
    this.shouldHandleDeath = true;
    this.rubber = Player.BASE_RUBBER;
    this.currentTick = tick;
    this.trail.clear();
    this.trail.addTurn(new PlayerPoint({ x, y }, direction, [0, 0], 0, tick));

    this.detectionLine = new SharedLine();
    this.detectionLineLeft = new SharedLine();
    this.detectionLineRight = new SharedLine();

    this._updateDetectionLines();
  }

  // Reset player state (after death..)
  spawn(x: number, y: number, direction: number, tickTimeMs: number) {
    this.x = x;
    this.y = y;
    this.direction = direction;

    this.rubber = Player.BASE_RUBBER;
    this.isRunning = true;
    this.turnQueue = [];
    this._setSpeedAndVelocity(1, tickTimeMs);
    this.targetSpeedMult = this.speedMult;
    this.shouldHandleDeath = true;
    this.trail.clear();
    this.trail.addTurn(
      new PlayerPoint(
        { x, y },
        direction,
        this.velocity,
        this.speedMult,
        this.currentTick
      )
    );
    this._updateDetectionLines();
    this.eventBus.emit('player_spawn', this);
    console.debug(this.currentTick, this.id, 'spawn()');
  }

  disable() {
    this.speedMult = 0;
    this.velocity = [0, 0];
    this.rubber = 0;
    this.targetSpeedMult = 0;
    this.isRunning = false;
    this.turnQueue = [];
    this.trail.clear();
    this.shouldHandleDeath = false;
  }

  public serialize(): PlayerDTO {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      direction: this.direction,
      speedMult: this.speedMult,
      targetSpeedMult: this.targetSpeedMult,
      rubber: this.rubber,
      velocity: this.velocity,
      isRunning: this.isRunning,
      tick: this.currentTick,
      color: this.color,
      trail: this.trail.serialize(),
    };
  }

  public load(playerDto: PlayerDTO) {
    this.id = playerDto.id;
    this.x = playerDto.x;
    this.y = playerDto.y;
    this.direction = playerDto.direction;
    this.currentTick = playerDto.tick;
    this.speedMult = playerDto.speedMult;
    this.targetSpeedMult = playerDto.targetSpeedMult;
    this.rubber = playerDto.rubber;
    this.velocity = playerDto.velocity;
    this.isRunning = playerDto.isRunning;
    this.color = playerDto.color;
    this.trail.deserialize(playerDto.trail);
  }

  setDirection(angle: number) {
    if (this.direction === angle) {
      return;
    }
    this.direction = angle;
  }

  static buildSharedCollidableLines(
    players: Player[],
    gameArea: GameArea
  ): SharedLine[] {
    const lines: SharedLine[] = [
      new SharedLine(0, 0, gameArea.width, 0),
      new SharedLine(gameArea.width, 0, gameArea.width, gameArea.height),
      new SharedLine(gameArea.width, gameArea.height, 0, gameArea.height),
      new SharedLine(0, gameArea.height, 0, 0),
    ];

    for (const player of players) {
      const points = player.trail.getPoints();

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i].coordinates;
        const p2 = points[i + 1].coordinates;
        lines.push(new SharedLine(p1.x, p1.y, p2.x, p2.y));
      }

      if (points.length > 0) {
        const lastPoint = points[points.length - 1].coordinates;
        lines.push(
          new SharedLine(lastPoint.x, lastPoint.y, player.x, player.y)
        );
      }
    }

    return lines;
  }

  getSelfLines(): SharedLine[] {
    const lines: SharedLine[] = [];
    const points = this.trail.getPoints();

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i].coordinates;
      const p2 = points[i + 1].coordinates;
      lines.push(new SharedLine(p1.x, p1.y, p2.x, p2.y));
    }

    if (points.length > 0) {
      const lastPoint = points[points.length - 1].coordinates;
      lines.push(new SharedLine(lastPoint.x, lastPoint.y, this.x, this.y));
    }

    return lines;
  }

  getClosestIntersectingPoint(
    sensorLine: SharedLine,
    obstacleLines: SharedLine[]
  ) {
    let point: { x: number; y: number };
    let closestPoint = { x: Infinity, y: Infinity };
    let pointDistance;

    for (const line of obstacleLines) {
      if (!aabbOverlapsRay(sensorLine, line)) continue;

      point = { x: -1, y: -1 };

      if (lineToLineIntersection(sensorLine, line, point)) {
        pointDistance = distanceBetween(point.x, point.y, this.x, this.y);

        // Don't consider points very close due to potential rounding errors
        if (pointDistance < EPSILON) {
          continue;
        }

        if (
          pointDistance <
          distanceBetween(this.x, this.y, closestPoint.x, closestPoint.y)
        ) {
          closestPoint = point;
        }
      }
    }
    return closestPoint;
  }

  _updateDetectionLines() {
    const currentSpeed = this.speedMult || 0;
    const lookAheadLength = Math.max(
      2000,
      Player.BASE_SPEED * currentSpeed * 0.5
    );

    this.detectionLine.setToAngle(
      this.x,
      this.y,
      this.direction,
      lookAheadLength
    );

    this.detectionLineLeft.setToAngle(
      this.x,
      this.y,
      this.direction - Math.PI / 2,
      lookAheadLength
    );

    this.detectionLineRight.setToAngle(
      this.x,
      this.y,
      this.direction + Math.PI / 2,
      lookAheadLength
    );
  }

  _setSpeedAndVelocity(speedMult: number, tickTimeMs: number) {
    let vx =
      Math.cos(this.direction) * Player.BASE_SPEED * speedMult * tickTimeMs;
    let vy =
      Math.sin(this.direction) * Player.BASE_SPEED * speedMult * tickTimeMs;

    if (Math.abs(vx) <= EPSILON) {
      vx = 0;
    }
    if (Math.abs(vy) <= EPSILON) {
      vy = 0;
    }

    this.velocity = [vx, vy];
    this.speedMult = speedMult;
  }

  queueTurn(type: string, tick: number = 0) {
    if (this.isRunning) {
      this.turnQueue.push({ tick, type });
    } else {
      console.debug(this.currentTick, this.id, 'skipped turn, not running');
    }
  }

  _executeTurn(type: string, tickTimeMs: number) {
    // Difference in angle
    let newDirection = this.direction;
    if (type === 'left') {
      newDirection = this.direction - Player.ROTATION_ANGLE;
    } else if (type === 'right') {
      newDirection = this.direction + Player.ROTATION_ANGLE;
    } else {
      throw new Error('???');
    }

    // Normalize newDirection to be within 0 and 2*PI, always positive
    newDirection = newDirection % (Math.PI * 2);
    if (newDirection < 0) {
      newDirection += Math.PI * 2;
    }

    // if player is still on last point, just update the direction
    const points = this.trail.getPoints();
    if (points.length > 0) {
      const lastTurn = points[points.length - 1];
      if (
        Math.abs(this.x - lastTurn.coordinates.x) <= EPSILON &&
        Math.abs(this.y - lastTurn.coordinates.y) <= EPSILON
      ) {
        // We haven't moved since the last turn/spawn point!
        this.setDirection(newDirection);
        this._setSpeedAndVelocity(this.speedMult, tickTimeMs);

        lastTurn.direction = newDirection;
        lastTurn.velocity = this.velocity;
        lastTurn.speedMult = this.speedMult;
        this.eventBus.emit('player_turn', this, lastTurn);
        return;
      }
    }

    const turnPoint = new PlayerPoint(
      { x: this.x, y: this.y },
      newDirection,
      this.velocity,
      this.speedMult,
      this.currentTick
    );
    this.trail.addTurn(turnPoint);

    this.setDirection(newDirection);
    this._setSpeedAndVelocity(this.speedMult, tickTimeMs);

    this.eventBus.emit('player_turn', this, turnPoint);
  }

  update(
    targetTick: number,
    gameArea: GameArea,
    gameClock: GameClock,
    sharedObstacles: SharedLine[]
  ) {
    if (this.currentTick === null || this.currentTick === undefined) {
      throw new Error('Null tick');
    }
    if (targetTick > this.currentTick + 1) {
      console.warn(
        '???',
        this.id,
        'skipping',
        targetTick - this.currentTick + 1,
        'ticks'
      );
      console.warn('Updating player in the past or twice, returning early');
      return;
    }

    this.currentTick = targetTick;

    // Check for death
    if (!this.isRunning || this.rubber <= 0) {
      if (this.shouldHandleDeath) {
        this.eventBus.emit('player_death', this);
        this.disable();
      }
      return;
    }

    // Turn (one turn per tick max)
    if (this.turnQueue.length > 0) {
      let nextTurn = this.turnQueue.shift()!;
      this._executeTurn(nextTurn.type, gameClock.tickTimeMs);
    }

    this._updateDetectionLines();

    let collisionLines = [...sharedObstacles, ...this.getSelfLines()];

    let pointFront = this.getClosestIntersectingPoint(
      this.detectionLine,
      collisionLines
    );
    let pointLeft = this.getClosestIntersectingPoint(
      this.detectionLineLeft,
      collisionLines
    );
    let pointRight = this.getClosestIntersectingPoint(
      this.detectionLineRight,
      collisionLines
    );

    this.collisionDistanceFront = distanceBetween(
      this.x,
      this.y,
      pointFront.x,
      pointFront.y
    );

    this.collisionDistanceLeft = distanceBetween(
      this.x,
      this.y,
      pointLeft.x,
      pointLeft.y
    );

    this.collisionDistanceRight = distanceBetween(
      this.x,
      this.y,
      pointRight.x,
      pointRight.y
    );

    const deltaStuff = 12;
    const slowDownDistance = 10;

    // Are we running into an existing trail ?
    // If yes, slow down to an exponentially slower speed.
    // The goal is to never reach the actual intersection point.
    // This is a core game mechanic.
    this.isColliding = false;
    if (this.collisionDistanceFront < slowDownDistance) {
      this.isColliding = true;

      let speedRatio =
        (this.collisionDistanceFront * this.collisionDistanceFront) /
        (slowDownDistance * slowDownDistance);

      this._setSpeedAndVelocity(
        Math.min(this.targetSpeedMult * speedRatio),
        gameClock.tickTimeMs
      );

      this.rubber -= deltaStuff * 0.03 * ((2 + this.targetSpeedMult) ^ 2);
    } else {
      // If we are not colliding into a wall (because we turned away)
      // Recover rubber
      if (this.rubber < Player.BASE_RUBBER) {
        this.rubber += 0.006 * deltaStuff;
      }
      // Recover our regular speed.
      this._setSpeedAndVelocity(this.targetSpeedMult, gameClock.tickTimeMs);
    }

    this.isSliding = false;
    if (this.collisionDistanceLeft < 10 || this.collisionDistanceRight < 10) {
      this.targetSpeedMult *= Math.pow(1.003, deltaStuff / 16.666);
      this.isSliding = true;
    } else if (!this.isColliding && this.targetSpeedMult > 1) {
      this.targetSpeedMult = Math.max(
        1,
        this.targetSpeedMult - 0.0003 * deltaStuff
      );
    }

    // This actually moves the player
    this.x += this.velocity[0] / 1000;
    this.y += this.velocity[1] / 1000;

    this.rubber = clamp(this.rubber, 0, Player.BASE_RUBBER);
  }
}
