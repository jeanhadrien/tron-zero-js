import * as Phaser from 'phaser';
import PlayerStateDTO from './PlayerStateDTO';
import { PlayerTrail } from './PlayerTrail';
import { PlayerPoint } from './PlayerPoint';
import { PlayerEventBus } from './PlayerStateEventBus';
import GameArea from './GameArea';

export const ROTATION_ANGLE = Math.PI / 2;
export const BASE_SPEED = 100;
export const MAX_RUBBER = 10;
export const EPSILON = 1e-12;

export default class PlayerState {
  public static readonly ROTATION_ANGLE: number = Math.PI / 2;
  public static readonly BASE_SPEED: number = 100;
  public static readonly MAX_SPEED: number = 200;
  public static readonly DETECTION_LINE_LENGTH: number = 20;
  public static readonly TRAIL_MAX_LENGTH = 100;
  public static readonly BASE_RUBBER = 10;
  public static readonly TURN_DELAY_TICKS = 3;

  eventBus: PlayerEventBus;
  x: number;
  y: number;
  direction: number;
  id: string;

  trailWidth = 3;

  trailLines: Phaser.Geom.Line[] = [];
  previousLineEnd: Phaser.Math.Vector2;
  currentLine: Phaser.Geom.Line;

  trail: PlayerTrail = new PlayerTrail();

  speedMult: number = 1;
  targetSpeed: number = 1;
  velocity: number[] = [0, 0];
  isRunning: boolean = false;
  rubber: number;
  color: number;
  isInvincible: boolean = false;

  detectionLine: Phaser.Geom.Line;
  detectionLineLeft: Phaser.Geom.Line;
  detectionLineRight: Phaser.Geom.Line;

  turnQueue: { tick: number; type: string }[] = [];

  lastTurnTick: number = 0;
  currentTick: number;
  shouldHandleDeath: boolean;

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
    this.rubber = PlayerState.BASE_RUBBER;
    this.currentTick = tick;
    this.trail = PlayerTrail.fromPoint(
      new PlayerPoint(new Phaser.Math.Vector2(x, y), direction, [0, 0], 0, tick)
    );

    this.detectionLine = new Phaser.Geom.Line();
    this.detectionLineLeft = new Phaser.Geom.Line();
    this.detectionLineRight = new Phaser.Geom.Line();

    this.previousLineEnd = new Phaser.Math.Vector2(this.x, this.y);
    this.currentLine = new Phaser.Geom.Line(this.x, this.y, this.x, this.y);

    this._updateDetectionLines();
  }

  // Reset player state (after death..)
  spawn(x: number, y: number, direction: number) {
    this.x = x;
    this.y = y;
    this.direction = direction;

    this.trailLines = [];

    this.previousLineEnd.set(this.x, this.y);
    this.currentLine.setTo(this.x, this.y, this.x, this.y);
    this.rubber = PlayerState.BASE_RUBBER;
    this.isRunning = true;
    this.turnQueue = [];
    this._setSpeedAndVelocity(1);
    this.targetSpeed = this.speedMult;
    this.trail = PlayerTrail.fromPoint(
      new PlayerPoint(
        new Phaser.Math.Vector2(x, y),
        direction,
        this.velocity,
        this.speedMult,
        0
      )
    );
    this._updateDetectionLines();
    this.eventBus.emit('player_spawn', this);
  }

  disable() {
    this.trailLines = [];
    this.speedMult = 0;
    this.velocity = [0, 0];
    this.rubber = 0;
    this.targetSpeed = 0;
    this.isRunning = false;
    this.turnQueue = [];
    this.trail = new PlayerTrail();

    // to remove
    this.currentLine.setTo(this.x, this.y, this.x, this.y);
    this.previousLineEnd.set(this.x, this.y);
  }

  public serialize(): PlayerStateDTO {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      direction: this.direction,
      speedMult: this.speedMult,
      targetSpeed: this.targetSpeed,
      rubber: this.rubber,
      velocity: this.velocity,
      isRunning: this.isRunning,
      color: this.color,
      trail: this.trail.serialize(),
    };
  }

  public load(playerDto: PlayerStateDTO) {
    this.id = playerDto.id;
    this.x = playerDto.x;
    this.y = playerDto.y;
    this.direction = playerDto.direction;
    this.speedMult = playerDto.speedMult;
    this.targetSpeed = playerDto.targetSpeed;
    this.rubber = playerDto.rubber;
    this.velocity = playerDto.velocity;
    this.isRunning = playerDto.isRunning;
    this.color = playerDto.color;
    this.trail.load(playerDto.trail);
  }

  setDirection(angle: number) {
    if (this.direction === angle) {
      return;
    }
    this.direction = angle;

    if (
      this.x !== this.previousLineEnd.x ||
      this.y !== this.previousLineEnd.y
    ) {
      this._persistTrail();
    }
  }

  _persistTrail() {
    let newLine = new Phaser.Geom.Line(
      this.previousLineEnd.x,
      this.previousLineEnd.y,
      this.x,
      this.y
    );
    this.trailLines.push(newLine);

    if (this.trailLines.length > PlayerState.TRAIL_MAX_LENGTH) {
      this.trailLines.shift();
    }

    this.previousLineEnd.set(this.x, this.y);
  }

  getCollidableLines(otherPlayers: PlayerState[], gameArea: GameArea) {
    const wallLines = [
      new Phaser.Geom.Line(0, 0, gameArea.width, 0),
      new Phaser.Geom.Line(gameArea.width, 0, gameArea.width, gameArea.height),
      new Phaser.Geom.Line(gameArea.width, gameArea.height, 0, gameArea.height),
      new Phaser.Geom.Line(0, gameArea.height, 0, 0),
    ];

    const allLines = [...wallLines];
    const allPlayers = [...otherPlayers, this];

    for (const player of allPlayers) {
      const points = player.trail.getPoints();

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i].coordinates;
        const p2 = points[i + 1].coordinates;
        allLines.push(new Phaser.Geom.Line(p1.x, p1.y, p2.x, p2.y));
      }

      if (points.length > 0) {
        const lastPoint = points[points.length - 1].coordinates;
        allLines.push(
          new Phaser.Geom.Line(lastPoint.x, lastPoint.y, player.x, player.y)
        );
      }
    }

    return allLines;
  }

  getClosestIntersectingPoint(
    sensorLine: Phaser.Geom.Line,
    obstacleLines: Phaser.Geom.Line[]
  ) {
    let point;
    let closestPoint = { x: Infinity, y: Infinity };
    let pointDistance;

    for (const line of obstacleLines) {
      point = { x: -1, y: -1 };

      if (Phaser.Geom.Intersects.LineToLine(sensorLine, line, point)) {
        pointDistance = Phaser.Math.Distance.Between(
          point.x,
          point.y,
          this.x,
          this.y
        );

        // Don't consider points very close due to potential rounding errors
        if (pointDistance < EPSILON) {
          continue;
        }

        if (
          pointDistance <
          Phaser.Math.Distance.Between(
            this.x,
            this.y,
            closestPoint.x,
            closestPoint.y
          )
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
      PlayerState.BASE_SPEED * currentSpeed * 0.5
    );

    this.detectionLine = Phaser.Geom.Line.SetToAngle(
      this.detectionLine,
      this.x,
      this.y,
      this.direction,
      lookAheadLength
    );

    this.detectionLineLeft = Phaser.Geom.Line.SetToAngle(
      this.detectionLineLeft,
      this.x,
      this.y,
      this.direction - Math.PI / 2,
      lookAheadLength
    );

    this.detectionLineRight = Phaser.Geom.Line.SetToAngle(
      this.detectionLineRight,
      this.x,
      this.y,
      this.direction + Math.PI / 2,
      lookAheadLength
    );
  }

  _setSpeedAndVelocity(speed: number) {
    let vx = Math.cos(this.direction) * PlayerState.BASE_SPEED * speed;
    let vy = Math.sin(this.direction) * PlayerState.BASE_SPEED * speed;

    if (Math.abs(vx) <= EPSILON) {
      vx = 0;
    }
    if (Math.abs(vy) <= EPSILON) {
      vy = 0;
    }

    this.velocity = [vx, vy];
    this.speedMult = speed;
  }

  queueTurn(type: string, tick: number = 0) {
    if (this.isRunning) {
      this.turnQueue.push({ tick, type });
    } else {
      console.warn('Player is not running, turn was skipped');
    }
  }

  _executeTurn(type: string) {
    // Difference in angle
    let newDirection = this.direction;
    if (type === 'left') {
      newDirection = this.direction - PlayerState.ROTATION_ANGLE;
    } else if (type === 'right') {
      newDirection = this.direction + PlayerState.ROTATION_ANGLE;
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
        this._setSpeedAndVelocity(this.speedMult);

        lastTurn.direction = newDirection;
        lastTurn.velocity = this.velocity;
        lastTurn.speed = this.speedMult;
        this.eventBus.emit('player_turn', this, lastTurn);
        return;
      }
    }

    const turnPoint = new PlayerPoint(
      new Phaser.Math.Vector2(this.x, this.y),
      newDirection,
      this.velocity,
      this.speedMult,
      this.currentTick
    );
    this.trail.addTurn(turnPoint);

    this.setDirection(newDirection);
    this._setSpeedAndVelocity(this.speedMult);

    this.eventBus.emit('player_turn', this, turnPoint);
  }

  update(currentTick: number, allPlayers: PlayerState[], gameArea: GameArea) {
    if (!this.currentTick) {
      throw new Error('Null tick');
    }

    if (currentTick > this.currentTick + 1) {
      console.warn('skipping', currentTick - this.currentTick + 1, 'ticks');
      //throw new Error('Updating player in the past or twice');
    }

    this.currentTick = currentTick;

    if (!this.isRunning || this.rubber <= 0) {
      if (this.shouldHandleDeath) {
        this.eventBus.emit('player_death', this);
        this.disable();
        console.info(currentTick, 'xxx Player died');
        this.shouldHandleDeath = false;
      }
      return;
    }
    if (
      this.turnQueue.length > 0 &&
      currentTick > this.lastTurnTick + PlayerState.TURN_DELAY_TICKS
    ) {
      // Check if we should execute the turn yet
      let nextTurn = this.turnQueue.shift()!;
      this._executeTurn(nextTurn.type);
      this.lastTurnTick = currentTick;
    }
    const otherPlayers = allPlayers.filter((player) => player.id !== this.id);

    this._updateDetectionLines();

    let collisionLines = this.getCollidableLines(otherPlayers, gameArea);

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

    const frontDistance = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      pointFront.x,
      pointFront.y
    );
    const leftDistance = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      pointLeft.x,
      pointLeft.y
    );
    const rightDistance = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      pointRight.x,
      pointRight.y
    );

    let isStuck = false;

    const safeDelta = 33;
    const maxMovementThisFrame =
      (PlayerState.BASE_SPEED * this.targetSpeed * safeDelta) / 1000;
    const slowDownDistance = Math.max(10, maxMovementThisFrame * 3);

    // console.debug('maxMovementThisFrame', maxMovementThisFrame);
    // console.debug('slowDownDistance', slowDownDistance);

    if (frontDistance < slowDownDistance) {
      isStuck = true;

      let speedRatio =
        (frontDistance * frontDistance) / (slowDownDistance * slowDownDistance);
      let maxSafeSpeed =
        (frontDistance * 0.5 * 1000) / (PlayerState.BASE_SPEED * safeDelta);

      this._setSpeedAndVelocity(
        Math.min(this.targetSpeed * speedRatio, maxSafeSpeed)
      );

      if (!this.isInvincible) {
        this.rubber -=
          (0.5 * safeDelta) / 16.666 / Math.max(0.1, frontDistance);
      }
    } else {
      if (this.rubber < PlayerState.BASE_RUBBER) {
        this.rubber += 0.006 * safeDelta;
      }
      if (this.speedMult < this.targetSpeed) {
        this._setSpeedAndVelocity(
          Math.min(this.targetSpeed, this.speedMult + 0.03 * safeDelta)
        );
      } else if (this.speedMult > this.targetSpeed) {
        this._setSpeedAndVelocity(this.targetSpeed);
      }
    }

    let isSliding = false;
    if (leftDistance < 10) {
      this.targetSpeed *= Math.pow(1.001, safeDelta / 16.666);
      isSliding = true;
    }
    if (rightDistance < 10) {
      this.targetSpeed *= Math.pow(1.001, safeDelta / 16.666);
      isSliding = true;
    }

    if (!isSliding && !isStuck && this.targetSpeed > 1) {
      this.targetSpeed = Math.max(1, this.targetSpeed - 0.00015 * safeDelta);
    }

    // Also use safeDelta for movement calculation
    this.x += (this.velocity[0] * safeDelta) / 1000;
    this.y += (this.velocity[1] * safeDelta) / 1000;

    // Simple wall boundaries (which we were colliding against but this acts as hard limit)
    this.x = Phaser.Math.Clamp(this.x, 0, gameArea.width);
    this.y = Phaser.Math.Clamp(this.y, 0, gameArea.height);

    this.rubber = Phaser.Math.Clamp(this.rubber, 0, PlayerState.BASE_RUBBER);
    this._setSpeedAndVelocity(this.speedMult);

    // console.debug('speed', this.speedMult);
    // console.debug('vel', this.velocity);

    this.currentLine.setTo(
      this.previousLineEnd.x,
      this.previousLineEnd.y,
      this.x,
      this.y
    );
  }
}
