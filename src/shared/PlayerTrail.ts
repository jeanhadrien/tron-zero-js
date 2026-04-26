import * as Phaser from 'phaser';
import { EPSILON } from './PlayerState';
import { PlayerPoint } from './PlayerPoint';
import PlayerTrailDTO from './PlayerTrailDTO';

export class PlayerTrail {
  private points: PlayerPoint[] = [];

  public getPoints(): readonly PlayerPoint[] {
    return this.points;
  }

  public static fromPoint(point: PlayerPoint) {
    let trail = new PlayerTrail();
    trail.addTurn(point);
    return trail;
  }

  public load(trailDto: PlayerTrailDTO) {
    this.points = [];
    for (const pt of trailDto.points) {
      this.addTurn(
        new PlayerPoint(
          new Phaser.Math.Vector2(pt.x, pt.y),
          pt.direction,
          pt.velocity,
          pt.speed,
          pt.tick
        )
      );
    }
  }

  public fillTurn(turnPoint: PlayerPoint): void {
    if (this.points.length === 0) {
      this.points.push(turnPoint);
      console.warn('Expected non-empty trail for', turnPoint);
      return;
    }

    if (turnPoint.tick < this.points[0].tick) {
      console.warn('Ignoring turn from previous life', turnPoint.tick, this.points[0].tick);
      return;
    }

    let insertIndex = this.points.length;
    while (
      insertIndex > 0 &&
      this.points[insertIndex - 1].tick > turnPoint.tick
    ) {
      insertIndex--;
    }

    if (insertIndex > 0) {
      const prev = this.points[insertIndex - 1];
      const dx = turnPoint.coordinates.x - prev.coordinates.x;
      const dy = turnPoint.coordinates.y - prev.coordinates.y;
      if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) {
        prev.direction = turnPoint.direction;
        prev.velocity = turnPoint.velocity;
        prev.speed = turnPoint.speed;
        return;
      }
    }
    if (insertIndex > 0) {
      this.validate(this.points[insertIndex - 1], turnPoint);
    }

    if (insertIndex < this.points.length) {
      this.validate(turnPoint, this.points[insertIndex]);
    }

    this.points.splice(insertIndex, 0, turnPoint);
  }

  public serialize(): PlayerTrailDTO {
    return {
      points: this.points.map((point) => point.serialize()),
    };
  }

  public addTurn(turnPoint: PlayerPoint): void {
    if (this.points.length > 0) {
      const lastTurn = this.points[this.points.length - 1];
      this.validate(lastTurn, turnPoint);
    }
    this.points.push(turnPoint);
  }

  public [Symbol.iterator]() {
    return this.points[Symbol.iterator]();
  }

  private validate(lastTurn: PlayerPoint, turnPoint: PlayerPoint): void {
    const dx = turnPoint.coordinates.x - lastTurn.coordinates.x;
    const dy = turnPoint.coordinates.y - lastTurn.coordinates.y;
    // 1. Ensure the points are not identically stacked to prevent atan2(0, 0)
    if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) {
      throw new Error('turnPoint coordinates cannot be identical to lastTurn.');
    }
    // 2. Calculate the angle of the physical vector between the points
    let angle = Math.atan2(dy, dx);
    angle = PlayerPoint.normalizeDirection(angle);
    // Normalize the angle to [0, 2π) to match the PlayerPoint's direction format
    // if (angle < 0) {
    //     angle += Math.PI * 2;
    // }
    // 3. Calculate the absolute difference, accounting for the 0 / 2π wrap-around
    let angleDiff = angle - lastTurn.direction;

    // 4. Validate that the angle strictly matches within the epsilon margin
    if (Math.abs(angleDiff) > EPSILON) {
      throw new Error(
        `turnPoint is not correctly aligned. Expected movement in direction ` +
          `${lastTurn.direction} rad, but trajectory angle is ${angle} rad.`
      );
    }

    // 5.
    if (lastTurn.tick >= turnPoint.tick) {
      throw new Error('turnPoint is in the past.');
    }
  }
}
