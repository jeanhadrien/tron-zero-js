import * as Phaser from 'phaser';

export default class PlayerState {
    id: string; 
    x: number;
    y: number;
    direction: number;

    ROTATION_ANGLE: number = Math.PI / 2;
    BASE_SPEED: number = 100;
    MAX_SPEED: number = 200;
    DETECTION_LINE_LENGTH: number = 20;
    TRAIL_MAX_LENGTH = 100;
    BASE_RUBBER = 10;
    TURN_DELAY_TICKS = 3;
    COLLISION_EPSILON = 1e-10;
    trailWidth = 3;

    trailLines: Phaser.Geom.Line[] = [];
    previousLineEnd: Phaser.Math.Vector2;
    currentLine: Phaser.Geom.Line;
    
    speed: number = 1;
    targetSpeed: number = 1;
    velocity: number[] = [0, 0];
    isRunning: boolean = false;
    rubber: number;
    color: number;
    isInvincible: boolean = false;
    
    detectionLine: Phaser.Geom.Line;
    detectionLineLeft: Phaser.Geom.Line;
    detectionLineRight: Phaser.Geom.Line;

    turnQueue: { tick: number, type: string }[] = [];

    // Networking
    lastProcessedInput: number = 0;
    lastTurnTick: number = 0;

    constructor(x: number, y: number, direction: number, color: number) {
        this.id = Math.random().toString(36).substring(7);
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.color = color;

        this.velocity = [0, 0];
        this.speed = 1;
        this.isRunning = false;
        this.rubber = this.BASE_RUBBER;

        this.detectionLine = new Phaser.Geom.Line();
        this.detectionLineLeft = new Phaser.Geom.Line();
        this.detectionLineRight = new Phaser.Geom.Line();

        this.previousLineEnd = new Phaser.Math.Vector2(this.x, this.y);
        this.currentLine = new Phaser.Geom.Line(this.x, this.y, this.x, this.y);

        this._updateDetectionLines();
    }

    reset(x: number, y: number, direction: number) {
        this.x = x;
        this.y = y;
        this.direction = direction;
        
        this.trailLines = [];
        this.previousLineEnd.set(this.x, this.y);
        this.currentLine.setTo(this.x, this.y, this.x, this.y);
        
        this.rubber = this.BASE_RUBBER;
        this.speed = 1;
        this.targetSpeed = 1;
        this.turnQueue = [];
        this._updateDetectionLines();
        this._setSpeed(1);
    }

    updateDirection(angle: number) {
        if (this.direction === angle) {
            return;
        }
        this.direction = angle;

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

        if (this.trailLines.length > this.TRAIL_MAX_LENGTH) {
            this.trailLines.shift();
        }

        this.previousLineEnd.set(this.x, this.y);
    }

    getLinesForCollision(allOtherTrails: Phaser.Geom.Line[], worldWidth: number, worldHeight: number) {
        const wallLines = [
            new Phaser.Geom.Line(0, 0, worldWidth, 0),
            new Phaser.Geom.Line(worldWidth, 0, worldWidth, worldHeight),
            new Phaser.Geom.Line(worldWidth, worldHeight, 0, worldHeight),
            new Phaser.Geom.Line(0, worldHeight, 0, 0)
        ];
        
        return [...this.trailLines, ...allOtherTrails, ...wallLines];
    }

    getClosestIntersectingPoint(sensorLine: Phaser.Geom.Line, obstacleLines: Phaser.Geom.Line[]) {
        let point;
        let closestPoint = { x: Infinity, y: Infinity };

        for (const line of obstacleLines) {
            point = { x: -1, y: -1 };

            if (Phaser.Geom.Intersects.LineToLine(sensorLine, line, point)) {
                if (Phaser.Math.Distance.Between(point.x, point.y, this.x, this.y) < this.COLLISION_EPSILON) {
                    continue;
                }

                let isRecentCorner = false;
                for (let i = Math.max(0, this.trailLines.length - 3); i < this.trailLines.length; i++) {
                    let recentLine = this.trailLines[i];
                    if (Phaser.Math.Distance.Between(point.x, point.y, recentLine.x1, recentLine.y1) < this.COLLISION_EPSILON ||
                        Phaser.Math.Distance.Between(point.x, point.y, recentLine.x2, recentLine.y2) < this.COLLISION_EPSILON) {
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

    _updateDetectionLines() {
        const currentSpeed = this.speed || 0;
        const lookAheadLength = Math.max(2000, this.BASE_SPEED * currentSpeed * 0.5);

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

    _setSpeed(speed: number) {
        let vx = Math.cos(this.direction) * this.BASE_SPEED * speed;
        let vy = Math.sin(this.direction) * this.BASE_SPEED * speed;

        if (Math.abs(vx) < 0.000001) { vx = 0; }
        if (Math.abs(vy) < 0.000001) { vy = 0; }

        this.velocity = [vx, vy];
        this.speed = speed;
    }

    turn(type: string, tick: number = 0) {
        this.turnQueue.push({ tick, type });
    }

    _executeTurn(type: string) {
        // Difference in angle
        let newDirection = this.direction;
        if (type === 'left') {
            newDirection = this.direction - this.ROTATION_ANGLE;
        } else if (type === 'right') {
            newDirection = this.direction + this.ROTATION_ANGLE;
        }

        // Normalize newDirection to be within 0 and 2*PI, always positive
        newDirection = newDirection % (Math.PI * 2);
        if (newDirection < 0) {
            newDirection += Math.PI * 2;
        }

        this.updateDirection(newDirection);
        this._setSpeed(this.speed);
    }

    update(_time: number, delta: number, allOtherTrails: Phaser.Geom.Line[], worldWidth: number, worldHeight: number, currentTick: number = 0) {
        if (this.turnQueue.length > 0 && currentTick > this.lastTurnTick + this.TURN_DELAY_TICKS) {
            // Check if we should execute the turn yet
            if (this.turnQueue[0].tick <= currentTick) {
                let nextTurn = this.turnQueue.shift()!;
                this._executeTurn(nextTurn.type);
                this.lastTurnTick = currentTick;
                if (nextTurn.tick > 0) this.lastProcessedInput = nextTurn.tick;
            }
        }

        this._updateDetectionLines();

        if (this.isRunning) {
            let collisionLines = this.getLinesForCollision(allOtherTrails, worldWidth, worldHeight);
            let pointFront = this.getClosestIntersectingPoint(this.detectionLine, collisionLines);
            let pointLeft = this.getClosestIntersectingPoint(this.detectionLineLeft, collisionLines);
            let pointRight = this.getClosestIntersectingPoint(this.detectionLineRight, collisionLines);

            const frontDistance = Phaser.Math.Distance.Between(this.x, this.y, pointFront.x, pointFront.y);
            const leftDistance = Phaser.Math.Distance.Between(this.x, this.y, pointLeft.x, pointLeft.y);
            const rightDistance = Phaser.Math.Distance.Between(this.x, this.y, pointRight.x, pointRight.y);

            let isStuck = false;

            // In server execution with massive latency or startup spikes, delta can be huge. 
            // Clamp it here or it will overshoot the speed
            const safeDelta = Math.max(1, Math.min(delta, 33)); // Cap logic at roughly 30 FPS equivalent to prevent runaway values
            const maxMovementThisFrame = (this.BASE_SPEED * this.targetSpeed * safeDelta) / 1000;
            const slowDownDistance = Math.max(10, maxMovementThisFrame * 3);

            if (frontDistance < slowDownDistance) {
                isStuck = true;

                let speedRatio = (frontDistance * frontDistance) / (slowDownDistance * slowDownDistance);
                let maxSafeSpeed = ((frontDistance * 0.5) * 1000) / (this.BASE_SPEED * safeDelta);

                this._setSpeed(Math.min(this.targetSpeed * speedRatio, maxSafeSpeed));

                if (!this.isInvincible) {
                    this.rubber -= (0.5 * safeDelta / 16.666) / Math.max(0.1, frontDistance);
                }
            } else {
                if (this.rubber < this.BASE_RUBBER) {
                    this.rubber += 0.006 * safeDelta;
                }
                if (this.speed < this.targetSpeed) {
                    this._setSpeed(Math.min(this.targetSpeed, this.speed + 0.03 * safeDelta));
                } else if (this.speed > this.targetSpeed) {
                    this._setSpeed(this.targetSpeed);
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
            this.x += this.velocity[0] * safeDelta / 1000;
            this.y += this.velocity[1] * safeDelta / 1000;

            // Simple wall boundaries (which we were colliding against but this acts as hard limit)
            this.x = Phaser.Math.Clamp(this.x, 0, worldWidth);
            this.y = Phaser.Math.Clamp(this.y, 0, worldHeight);

        } else {
            this._setSpeed(0);
        }

        this.rubber = Phaser.Math.Clamp(this.rubber, 0, this.BASE_RUBBER);
        this._setSpeed(this.speed);

        this.currentLine.setTo(this.previousLineEnd.x, this.previousLineEnd.y, this.x, this.y);
    }
}
