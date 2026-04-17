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
    staticTrailGraphics: GameObjects.Graphics;
    activeTrailGraphics: GameObjects.Graphics;
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
    targetSpeed: number = 1;
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

        this.staticTrailGraphics = scene.add.graphics();
        this.activeTrailGraphics = scene.add.graphics();
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
        
        if (this.x !== this.previousLineEnd.x || this.y !== this.previousLineEnd.y) {
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
        
        this.staticTrailGraphics.lineStyle(this.trailWidth, this.color, 0.5);
        this.staticTrailGraphics.strokeLineShape(newLine);

        if (this.trailLines.length > this.TRAIL_MAX_LENGTH) {
            this.trailLines.shift();
        }
        this.previousLineEnd.set(this.x, this.y);
    }

    _getLinesForCollision() {
        const bounds = this.scene?.physics?.world?.bounds;
        if (!bounds) return this.trailLines;
        const wallLines = [
            new Phaser.Geom.Line(bounds.x, bounds.y, bounds.right, bounds.y),
            new Phaser.Geom.Line(bounds.right, bounds.y, bounds.right, bounds.bottom),
            new Phaser.Geom.Line(bounds.right, bounds.bottom, bounds.x, bounds.bottom),
            new Phaser.Geom.Line(bounds.x, bounds.bottom, bounds.x, bounds.y)
        ];
        return [...this.trailLines, ...wallLines];
    }

    _getClosestIntersectingPoint(sensorLine: Phaser.Geom.Line, obstacleLines: Phaser.Geom.Line[]) {
        let point;
        let closestPoint = { x: Infinity, y: Infinity }; // Note: In a real game, consider using null or a max distance check

        // Iterate over all lines
        for (const line of obstacleLines) {
            point = { x: -1, y: -1 };

            // Check intersection with the specific sensor passed in
            if (Phaser.Geom.Intersects.LineToLine(sensorLine, line, point)) {

                if (point.x == this.x && point.y == this.y) {
                    continue;
                }

                // Fix: Ignore collisions exactly at the corners of recent trails
                // to prevent getting stuck when doing tight zig-zags or U-turns.
                let isRecentCorner = false;
                for (let i = Math.max(0, this.trailLines.length - 3); i < this.trailLines.length; i++) {
                    let recentLine = this.trailLines[i];
                    if ((point.x === recentLine.x1 && point.y === recentLine.y1) ||
                        (point.x === recentLine.x2 && point.y === recentLine.y2)) {
                        isRecentCorner = true;
                        break;
                    }
                }

                if (isRecentCorner) {
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

        this.activeTrailGraphics.clear();

        // Draw the last line
        this.activeTrailGraphics.lineStyle(this.trailWidth, this.color, 0.5);
        this.activeTrailGraphics.strokeLineShape(
            this.currentLine
        );

        this.activeTrailGraphics.lineStyle(1, 0xff0000, 0.5); // Red for sensors
        this.activeTrailGraphics.strokeLineShape(this.detectionLine);
        this.activeTrailGraphics.strokeLineShape(this.detectionLineLeft);
        this.activeTrailGraphics.strokeLineShape(this.detectionLineRight);

    }

    // Helper to update line positions based on current x, y and direction
    _updateDetectionLines() {
        const currentSpeed = this.speed || 0;
        // Increase the lookAheadLength to ensure we never miss walls at high speeds or high delta times
        const lookAheadLength = Math.max(2000, this.BASE_SPEED * currentSpeed * 0.5);

        // Front
        this.detectionLine = Phaser.Geom.Line.SetToAngle(
            this.detectionLine,
            this.x,
            this.y,
            this.direction,
            lookAheadLength
        );

        // Left (-90 degrees)
        this.detectionLineLeft = Phaser.Geom.Line.SetToAngle(
            this.detectionLineLeft,
            this.x,
            this.y,
            this.direction - Math.PI / 2,
            lookAheadLength
        );

        // Right (+90 degrees)
        this.detectionLineRight = Phaser.Geom.Line.SetToAngle(
            this.detectionLineRight,
            this.x,
            this.y,
            this.direction + Math.PI / 2,
            lookAheadLength
        );
    }


    _setSpeed(speed: number) {
        let vx = Math.cos(this.direction) * this.BASE_SPEED * speed;
        let vy = Math.sin(this.direction) * this.BASE_SPEED * speed;

        // Fix: If the velocity is extremely close to 0, force it to 0
        if (Math.abs(vx) < 0.000001) { vx = 0; }
        if (Math.abs(vy) < 0.000001) { vy = 0; }

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
        this._setSpeed(this.speed);
    }

    update(time: number, delta: number) {
        // super.update(delta);

        this._updateDetectionLines();
        this.currentLine = new Phaser.Geom.Line(this.previousLineEnd.x, this.previousLineEnd.y, this.x, this.y);

        if (this.isRunning) {

            let collisionLines = this._getLinesForCollision();
            let pointFront = this._getClosestIntersectingPoint(this.detectionLine, collisionLines);
            let pointLeft = this._getClosestIntersectingPoint(this.detectionLineLeft, collisionLines);
            let pointRight = this._getClosestIntersectingPoint(this.detectionLineRight, collisionLines);


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
            let isStuck = false;
            
            const movementThisFrame = (this.BASE_SPEED * this.speed * delta) / 1000;
            // Add a buffer multiplier to the stop threshold to prevent skipping in edge cases
            const stopThreshold = Math.max(3, movementThisFrame * 1.5);

            // If we are close enough to the obstacle, slow down
            if (frontDistance < stopThreshold) {
                this._setSpeed((frontDistance * frontDistance) / 4000);
                isStuck = true;
                //this.rubber -= 0.5 / obstacleDistance;
            } else {
                this.rubber += 0.006 * delta;
                if (this.speed < this.targetSpeed) {
                    this._setSpeed(Math.min(this.targetSpeed, this.speed + 0.03 * delta));
                } else if (this.speed > this.targetSpeed) {
                    this._setSpeed(this.targetSpeed);
                }
            }


            let isSliding = false;
            if (leftDistance < 10) {
                this.targetSpeed *= Math.pow(1.001, delta / 16.666);
                isSliding = true;
            }
            if (rightDistance < 10) {
                this.targetSpeed *= Math.pow(1.001, delta / 16.666);
                isSliding = true;
            }

            if (!isSliding && !isStuck && this.targetSpeed > 1) {
                this.targetSpeed = Math.max(1, this.targetSpeed - 0.00015 * delta);
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
