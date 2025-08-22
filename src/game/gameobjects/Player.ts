import { GameObjects, Physics, Scene } from 'phaser';
import { pointToLineDistance } from '../utils';

export default class Player extends Phaser.Physics.Arcade.Image {
  PLAYER_COLOR: number = 0x00ff00;
  ROTATION_ANGLE: number = Math.PI / 2;
  BASE_SPEED: number = 150;
  HITBOX_RADIUS: number = 2;
  DETECTION_LINE_LENGTH: number = 30;
  TRAIL_MAX_LENGTH = 20;

  driverGraphics: GameObjects.Graphics;

  trailPoints: { x: number; y: number }[] = [];
  trailLines: Phaser.Geom.Line[] = [];

  trailWidth = 3;
  trailGraphics: GameObjects.Graphics;
  direction: number;
  speed: number;
  detectionLine: Phaser.Geom.Line;
  previousLineEnd: Phaser.Math.Vector2;
  rotationAllowed: boolean = true;

  constructor(scene: Phaser.Scene, x: number, y: number, direction: number) {
    super(scene, x, y, 'player');

    //Physics
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setBodySize(10, 10);
    this.direction = direction;

    this.setVelocity(
      Math.cos(this.direction) * this.BASE_SPEED,
      Math.sin(this.direction) * this.BASE_SPEED
    );

    /*this.scene.physics.moveTo(
      this,
      this.x + Math.cos(this.direction) * 1000,
      this.y + Math.sin(this.direction) * 1000,
      this.BASE_SPEED
    );*/

    //this.rotationAllowed = false;

    this.trailLines = [];

    this.driverGraphics = scene.add.graphics();
    this.driverGraphics.fillStyle(this.PLAYER_COLOR);
    this.driverGraphics.fillTriangle(0, -7, -7, 7, 7, 7);
    this.driverGraphics.rotation = this.direction + Math.PI / 2;

    this.trailGraphics = scene.add.graphics();
    //this.trailGraphics.lineStyle(this.trailWidth, this.PLAYER_COLOR, 0.03);
    //this.trailGraphics.beginPath();
    //this.trailGraphics.moveTo(this.x, this.y);
    this.previousLineEnd = new Phaser.Math.Vector2(this.x, this.y);

    this.detectionLine = new Phaser.Geom.Line(
      this.x,
      this.y,
      this.x + Math.cos(this.direction) * this.DETECTION_LINE_LENGTH,
      this.y + Math.sin(this.direction) * this.DETECTION_LINE_LENGTH
    );
  }

  getNearestTrailLines() {}

  update(delta: number) {
    super.update(delta);
    //console.log(this.x, this.y);

    this.detectionLine = Phaser.Geom.Line.SetToAngle(
      this.detectionLine,
      this.x,
      this.y,
      this.direction,
      this.DETECTION_LINE_LENGTH
    );

    this.driverGraphics.x = this.x;
    this.driverGraphics.y = this.y;

    // Check trail collision
    let point = this.getClosestPoint(this.trailLines);
    const distance = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      point.x,
      point.y
    );
    if (distance > 0 && distance < 3) {
      this.setVelocity(0);
    }
    // Redraw trail
    this.redrawTrail();
    this.trailGraphics.strokeLineShape(this.detectionLine);
    this.trailGraphics.strokeLineShape(
      new Phaser.Geom.Line(
        this.previousLineEnd.x,
        this.previousLineEnd.y,
        this.x,
        this.y
      )
    );

    //
  }

  persistTrail() {
    this.trailLines.push(
      new Phaser.Geom.Line(
        this.previousLineEnd.x,
        this.previousLineEnd.y,
        this.x,
        this.y
      )
    );
    if (this.trailLines.length > this.TRAIL_MAX_LENGTH) {
      this.trailLines.shift();
    }
    this.previousLineEnd.set(this.x, this.y);
  }

  rotate(type: string) {
    if (!this.rotationAllowed) {
      return;
    }
    if (type === 'left') {
      this.direction = this.direction - this.ROTATION_ANGLE;
    } else if (type === 'right') {
      this.direction = this.direction + this.ROTATION_ANGLE;
    }
    this.setVelocity(
      Math.cos(this.direction) * this.BASE_SPEED,
      Math.sin(this.direction) * this.BASE_SPEED
    );
    this.direction = this.direction % (Math.PI * 2);
    this.driverGraphics.rotation = this.direction + Math.PI / 2;
    this.persistTrail();
  }

  getLinesForCollision() {
    return this.trailLines;
  }

  getClosestPoint(lines: Phaser.Geom.Line[]) {
    let point;
    let closestPoint = { x: this.x, y: this.y };
    for (const line of lines) {
      point = { x: -1, y: -1 }; // reset everytime
      if (
        Phaser.Geom.Intersects.LineToLine(
          this.detectionLine,
          line,
          point // this also loads intersection point to point let;
        )
      ) {
        // case where we intersect with last line?
        if (point.x == this.x && point.y == this.y) {
          continue;
        }
        if (
          !closestPoint ||
          (closestPoint.x == this.x && closestPoint.y == this.y)
        ) {
          closestPoint = { ...point }; // Copy the point
          continue;
        }
        if (
          Phaser.Math.Distance.Between(this.x, this.y, point.x, point.y) <
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

  redrawTrail() {
    this.trailGraphics.clear();

    if (this.trailLines.length > 0) {
      const alpha = 0.5;
      this.trailGraphics.lineStyle(this.trailWidth, this.PLAYER_COLOR, alpha);

      for (let i = 0; i < this.trailLines.length; i++) {
        this.trailGraphics.strokeLineShape(this.trailLines[i]);
      }
    }
  }
}
