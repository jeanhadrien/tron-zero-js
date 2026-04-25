import * as Phaser from 'phaser';
import { ROTATION_ANGLE, EPSILON } from './PlayerState';
import PlayerPointDTO from './PlayerPointDTO';

export class PlayerPoint {
  public coordinates: Phaser.Math.Vector2;
  public direction: number;
  public velocity: number[];
  public speed: number;
  public tick: number;

  constructor(
    coordinates: Phaser.Math.Vector2,
    direction: number,
    velocity: number[],
    speed: number,
    tick: number
  ) {
    this.coordinates = coordinates;
    this.velocity = velocity;
    this.speed = speed;
    this.tick = tick;

    this.direction = PlayerPoint.normalizeDirection(direction);
    this.validate(this.direction);
  }

  public static normalizeDirection(direction: number): number {
    let newDirection = direction % (Math.PI * 2);
    if (newDirection < 0) {
      newDirection += Math.PI * 2;
    }
    return newDirection;
  }

  public serialize(): PlayerPointDTO {
    return {
      x: this.coordinates.x,
      y: this.coordinates.y,
      direction: this.direction,
      velocity: this.velocity,
      speed: this.speed,
      tick: this.tick,
    };
  }

  public static fromDto(pointDto: PlayerPointDTO): PlayerPoint {
    return new PlayerPoint(
      new Phaser.Math.Vector2(pointDto.x, pointDto.y),
      pointDto.direction,
      pointDto.velocity,
      pointDto.speed,
      pointDto.tick
    );
  }

  private validate(direction: number): void {
    const remainder = direction % ROTATION_ANGLE;

    const isAligned =
      remainder < EPSILON || ROTATION_ANGLE - remainder < EPSILON;

    if (!isAligned) {
      throw new Error(
        `Direction ${direction} is not aligned with ROTATION_ANGLE (${ROTATION_ANGLE})`
      );
    }
  }
}
