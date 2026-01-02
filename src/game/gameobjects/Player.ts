import { GameObjects } from 'phaser';

export default class Player extends Phaser.Physics.Arcade.Image {

  ROTATION_ANGLE: number = Math.PI / 2;
  BASE_SPEED: number = 150;
  DETECTION_LINE_LENGTH: number = 30;
  TRAIL_MAX_LENGTH = 200;
  RUBBER = 10;

  driverGraphics: GameObjects.Graphics;

  trailLines: Phaser.Geom.Line[] = [];

  trailWidth = 3;
  trailGraphics: GameObjects.Graphics;
  direction: number;
  speed: number;  
  detectionLine: Phaser.Geom.Line;
  previousLineEnd: Phaser.Math.Vector2;
  target: Phaser.Math.Vector2;
  isRunning: boolean;
  rubber: number;
  color: number;

  constructor(scene: Phaser.Scene, x: number, y: number, color: number) {
    super(scene, x, y, '_player');
    this.scene = scene;
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.color = color;

    this.direction = 0;
    this.setBodySize(0, 0);
    this.setVelocity(0, 0);
    this.isRunning = false;
    this.rubber = this.RUBBER;
    this.detectionLine = new Phaser.Geom.Line(
      this.x,
      this.y,
      this.x + Math.cos(this.direction) * this.DETECTION_LINE_LENGTH,
      this.y + Math.sin(this.direction) * this.DETECTION_LINE_LENGTH
    );

    this.trailLines = [];
    this.previousLineEnd = new Phaser.Math.Vector2(this.x, this.y);

    this.driverGraphics = scene.add.graphics();
    this.driverGraphics.fillStyle(this.color);
    this.driverGraphics.fillTriangle(0, -7, -7, 7, 7, 7);

    this.trailGraphics = scene.add.graphics();
    //this.trailGraphics.lineStyle(this.trailWidth, this.PLAYER_COLOR, 0.03);
    //this.trailGraphics.beginPath();
    //this.trailGraphics.moveTo(this.x, this.y);
  }

  update(delta: number) {
    // super.update(delta);

    this.detectionLine = Phaser.Geom.Line.SetToAngle(
      this.detectionLine,
      this.x,
      this.y,
      this.direction,
      this.DETECTION_LINE_LENGTH
    );

    if (this.isRunning) {
      // Default velocity
      this.setVelocity(
        Math.cos(this.direction) * this.BASE_SPEED,
        Math.sin(this.direction) * this.BASE_SPEED
      );
      // Check trail collision
      let point = this.getClosestIntersectingPointOnDetectionLine(
        this.trailLines
      );
      const obstacleDistance = Phaser.Math.Distance.Between(
        this.x,
        this.y,
        point.x,
        point.y
      );

      // If we are close enough to the trail, slow down
      if (obstacleDistance > 0 && obstacleDistance < 20) {
        this.setVelocity(
          Math.cos(this.direction) * this.BASE_SPEED * (obstacleDistance / 200),
          Math.sin(this.direction) * this.BASE_SPEED * (obstacleDistance / 200)
        );
        this.rubber -= 0.5 / obstacleDistance;
      } else {
        this.rubber += 0.1;
      }
    } else {
      this.setVelocity(0, 0);
    }

    this.rubber = Phaser.Math.Clamp(this.rubber, 0, this.RUBBER);

    //console.log(this.rubber);
    // Make sure to do graphics at the end once everything else is updated
    this.driverGraphics.x = this.x;
    this.driverGraphics.y = this.y;

    this.redrawTrail();

    this.trailGraphics.strokeLineShape(this.detectionLine);
  }

  setDirection(angle: number) {
    if (this.direction == angle) {
      return;
    }
    this.direction = angle;
    this.driverGraphics.rotation = this.direction + Math.PI / 2;
    this.persistTrail();
  }

  turn(type: string) {
    let newDirection = this.direction;
    if (type === 'left') {
      newDirection = this.direction - this.ROTATION_ANGLE;
    } else if (type === 'right') {
      newDirection = this.direction + this.ROTATION_ANGLE;
    }
    newDirection = newDirection % (Math.PI * 2);
    this.setDirection(newDirection);
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

  getLinesForCollision() {
    return this.trailLines;
  }

  getClosestIntersectingPointOnDetectionLine(lines: Phaser.Geom.Line[]) {
    let point;
    let closestPoint = { x: 999, y: 999 };

    // Iterate over all lines
    for (const line of lines) {
      // Reset possible intersection point
      point = { x: -1, y: -1 };
      // Check if current line intersects with detection line
      // This also loads intersection point
      if (Phaser.Geom.Intersects.LineToLine(this.detectionLine, line, point)) {
        // Case where we intersect with the line we are currently at the end of
        if (point.x == this.x && point.y == this.y) {
          continue;
        }
        // Check if the intersection point is closer than the current closest point
        // If so, update the closest point
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
      this.trailGraphics.lineStyle(this.trailWidth, this.color, 0.5);
      // Iterate over all lines and draw them
      for (let i = 0; i < this.trailLines.length; i++) {
        this.trailGraphics.strokeLineShape(this.trailLines[i]);
      }
    }

    // Draw the last line
    this.trailGraphics.strokeLineShape(
      new Phaser.Geom.Line(
        this.previousLineEnd.x,
        this.previousLineEnd.y,
        this.x,
        this.y
      )
    );
  }
}
