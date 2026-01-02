import { GameObjects } from 'phaser';

export default class Player extends Phaser.Physics.Arcade.Image {

    ROTATION_ANGLE: number = Math.PI / 2;
    BASE_SPEED: number = 150;
    MAX_SPEED: number = 200;
    DETECTION_LINE_LENGTH: number = 20;
    TRAIL_MAX_LENGTH = 200;
    BASE_RUBBER = 10;

    driverGraphics: GameObjects.Graphics;

    trailLines: Phaser.Geom.Line[] = [];

    trailWidth = 3;
    trailGraphics: GameObjects.Graphics;
    direction: number;


    detectionLine: Phaser.Geom.Line;
    detectionLineLeft: Phaser.Geom.Line;
    detectionLineRight: Phaser.Geom.Line;

    previousLineEnd: Phaser.Math.Vector2;


    target: Phaser.Math.Vector2;
    isRunning: boolean;
    rubber: number;
    color: number;
    velocity: number[];
    speed: number;
    currentLine: Phaser.Geom.Line;

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
        this.rubber = this.BASE_RUBBER;

        this.detectionLine = new Phaser.Geom.Line();
        this.detectionLineLeft = new Phaser.Geom.Line();
        this.detectionLineRight = new Phaser.Geom.Line();

        // Set initial positions
        this._updateDetectionLines();


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


    _updateDirection(angle: number) {
        if (this.direction == angle) {
            return;
        }
        this.direction = angle;
        this.driverGraphics.rotation = this.direction + Math.PI / 2;
        this._persistTrail();
    }

    _persistTrail() {
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

    _getLinesForCollision() {
        return this.trailLines;
    }

    _getClosestIntersectingPoint(sensorLine: Phaser.Geom.Line, obstacleLines: Phaser.Geom.Line[]) {
        let point;
        let closestPoint = { x: 999, y: 999 }; // Note: In a real game, consider using null or a max distance check

        // Iterate over all lines
        for (const line of obstacleLines) {
            point = { x: -1, y: -1 };

            // Check intersection with the specific sensor passed in
            if (Phaser.Geom.Intersects.LineToLine(sensorLine, line, point)) {

                if (point.x == this.x && point.y == this.y) {
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

    _draw() {
        // Update driver position
        this.driverGraphics.x = this.x;
        this.driverGraphics.y = this.y;

        // Redraw trail every frame. TODO: don't do that
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
            this.currentLine
        );

        this.trailGraphics.lineStyle(1, 0xff0000, 0.5); // Red for sensors
        this.trailGraphics.strokeLineShape(this.detectionLine);
        this.trailGraphics.strokeLineShape(this.detectionLineLeft);
        this.trailGraphics.strokeLineShape(this.detectionLineRight);

    }

    // Helper to update line positions based on current x, y and direction
    _updateDetectionLines() {
        // Front
        this.detectionLine = Phaser.Geom.Line.SetToAngle(
            this.detectionLine,
            this.x,
            this.y,
            this.direction,
            this.DETECTION_LINE_LENGTH
        );

        // Left (-90 degrees)
        this.detectionLineLeft = Phaser.Geom.Line.SetToAngle(
            this.detectionLineLeft,
            this.x,
            this.y,
            this.direction - Math.PI / 2,
            this.DETECTION_LINE_LENGTH
        );

        // Right (+90 degrees)
        this.detectionLineRight = Phaser.Geom.Line.SetToAngle(
            this.detectionLineRight,
            this.x,
            this.y,
            this.direction + Math.PI / 2,
            this.DETECTION_LINE_LENGTH
        );
    }


    _setSpeed(speed: number) {
        let vx = Math.cos(this.direction) * this.BASE_SPEED * speed;
        let vy = Math.sin(this.direction) * this.BASE_SPEED * speed;

        // Fix: If the velocity is extremely close to 0, force it to 0
        //if (Math.abs(vx) < 0.000001) { vx = 0; console.log("vx"); }
        //if (Math.abs(vy) < 0.000001) { vy = 0; console.log("vy"); }

        this.velocity = [vx, vy];
        this.speed = speed;
        this.setVelocity(vx, vy);
    }

    turn(type: string) {
        let newDirection = this.direction;
        if (type === 'left') {
            newDirection = this.direction - this.ROTATION_ANGLE;
        } else if (type === 'right') {
            newDirection = this.direction + this.ROTATION_ANGLE;
        }
        newDirection = newDirection % (Math.PI * 2);
        this._updateDirection(newDirection);
    }

    update(time: number, delta: number) {
        // super.update(delta);

        this._updateDetectionLines();
        this.currentLine = new Phaser.Geom.Line(this.previousLineEnd.x, this.previousLineEnd.y, this.x, this.y);

        if (this.isRunning) {

            let pointFront = this._getClosestIntersectingPoint(this.detectionLine, this.trailLines);
            let pointLeft = this._getClosestIntersectingPoint(this.detectionLineLeft, this.trailLines);
            let pointRight = this._getClosestIntersectingPoint(this.detectionLineRight, this.trailLines);


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

            if (frontDistance == 0) {
                console.log("aa");
            }
            // If we are close enough to the obstacle, slow down
            if (frontDistance < 3) {
                this._setSpeed((frontDistance * frontDistance) / 4000);
                //this.rubber -= 0.5 / obstacleDistance;
            } else {
                this.rubber += 0.1;
            }


            if (leftDistance < 3) {
                this._setSpeed(this.speed * 1.0002);
            }
            if (rightDistance < 3) {
                this._setSpeed(this.speed * 1.0002);
            }



        } else {
            this._setSpeed(0);
            console.log("uhh");
        }

        Phaser.Math.Clamp(this.rubber, 0, this.BASE_RUBBER);
        //Phaser.Math.Clamp(this.speed, this.BASE_SPEED, this.MAX_SPEED)
        this._setSpeed(this.speed);

        this._draw();

    }


}
