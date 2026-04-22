import * as Phaser from 'phaser';
import { GameEventBus } from './GameEventBus';
import PlayerStateDTO from './PlayerStateDTO';

export const ROTATION_ANGLE = Math.PI / 2;
export const BASE_SPEED = 100;
export const MAX_RUBBER = 10;
export const EPSILON = 1e-12;

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
    private validate(direction: number): void {
        const remainder = direction % ROTATION_ANGLE;

        const isAligned = remainder < EPSILON || (ROTATION_ANGLE - remainder) < EPSILON;

        if (!isAligned) {
            throw new Error(`Direction ${direction} is not aligned with ROTATION_ANGLE (${ROTATION_ANGLE})`);
        }
    }


}

export class PlayerTrail {
    private points: PlayerPoint[] = [];

    public getPoints(): readonly PlayerPoint[] {
        return this.points;
    }

    public static from(point: PlayerPoint) {
        let trail = new PlayerTrail();
        trail.addTurn(point);
        return trail;
    }

    public fillTurn(turnPoint: PlayerPoint): void {
        if (this.points.length === 0) {
            this.points.push(turnPoint);
            console.warn("skipped1")
            return;
        }

        let insertIndex = this.points.length;
        while (insertIndex > 0 && this.points[insertIndex - 1].tick > turnPoint.tick) {
            insertIndex--;
        }

        if (insertIndex > 0) {
            this.validate(this.points[insertIndex - 1], turnPoint);
        }

        if (insertIndex < this.points.length) {
            this.validate(turnPoint, this.points[insertIndex]);
        }

        this.points.splice(insertIndex, 0, turnPoint);

    }

    public addTurn(turnPoint: PlayerPoint): void {
        if (this.points.length > 0) {
            const lastTurn = this.points[this.points.length - 1]
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
            throw new Error("turnPoint coordinates cannot be identical to lastTurn.");
        }
        // 2. Calculate the angle of the physical vector between the points
        let angle = Math.atan2(dy, dx);
        angle = PlayerPoint.normalizeDirection(angle)
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
            throw new Error("turnPoint is in the past.")
        }
    }
}

export default class PlayerState {
    public static readonly ROTATION_ANGLE: number = Math.PI / 2;
    public static readonly BASE_SPEED: number = 100;
    public static readonly MAX_SPEED: number = 200;
    public static readonly DETECTION_LINE_LENGTH: number = 20;
    public static readonly TRAIL_MAX_LENGTH = 100;
    public static readonly BASE_RUBBER = 10;
    public static readonly TURN_DELAY_TICKS = 3;

    bus: GameEventBus;
    x: number;
    y: number;
    _direction: number;
    id: string;

    trailWidth = 3;

    trailLines: Phaser.Geom.Line[] = [];
    previousLineEnd: Phaser.Math.Vector2;
    currentLine: Phaser.Geom.Line;

    trail: PlayerTrail = new PlayerTrail();

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

    lastTurnTick: number = 0;
    currentTick: number;

    public get direction() {
        return this._direction;
    }

    constructor(bus: GameEventBus, tick: number, x: number, y: number, direction: number, color: number) {
        this.bus = bus;
        this.id = Math.random().toString(36).substring(7);
        this.x = x;
        this.y = y;
        this._direction = direction;
        this.color = color;
        this.velocity = [0, 0];
        this.speed = 1;
        this.isRunning = false;
        this.rubber = PlayerState.BASE_RUBBER;

        this.trail = PlayerTrail.from(
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
    reset(x: number, y: number, direction: number) {

        this.x = x;
        this.y = y;
        this._direction = direction;

        this.trailLines = [];
        this.trail = PlayerTrail.from(
            new PlayerPoint(new Phaser.Math.Vector2(x, y), direction, this.velocity, this.speed, 0)
        );

        this.previousLineEnd.set(this.x, this.y);
        this.currentLine.setTo(this.x, this.y, this.x, this.y);

        this.rubber = PlayerState.BASE_RUBBER;
        this.speed = 1;
        this.targetSpeed = 1;
        this.turnQueue = [];
        this._updateDetectionLines();
        this._setSpeed(1);
    }

    public serialize(): PlayerStateDTO {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            direction: this._direction,
            speed: this.speed,
            targetSpeed: this.targetSpeed,
            rubber: this.rubber,
            isRunning: this.isRunning,
            color: this.color,
            trailPoints: this.trail.getPoints().map(p => ({
                x: p.coordinates.x,
                y: p.coordinates.y,
                direction: p.direction,
                velocity: p.velocity,
                tick: p.tick
            }))
        };
    }

    setDirection(angle: number) {
        if (this._direction === angle) {
            return;
        }
        this._direction = angle;

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

        if (this.trailLines.length > PlayerState.TRAIL_MAX_LENGTH) {
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
        let pointDistance;

        for (const line of obstacleLines) {
            point = { x: -1, y: -1 };

            if (Phaser.Geom.Intersects.LineToLine(sensorLine, line, point)) {
                pointDistance = Phaser.Math.Distance.Between(point.x, point.y, this.x, this.y);

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
        const currentSpeed = this.speed || 0;
        const lookAheadLength = Math.max(2000, PlayerState.BASE_SPEED * currentSpeed * 0.5);

        this.detectionLine = Phaser.Geom.Line.SetToAngle(
            this.detectionLine,
            this.x,
            this.y,
            this._direction,
            lookAheadLength
        );

        this.detectionLineLeft = Phaser.Geom.Line.SetToAngle(
            this.detectionLineLeft,
            this.x,
            this.y,
            this._direction - Math.PI / 2,
            lookAheadLength
        );

        this.detectionLineRight = Phaser.Geom.Line.SetToAngle(
            this.detectionLineRight,
            this.x,
            this.y,
            this._direction + Math.PI / 2,
            lookAheadLength
        );
    }

    _setSpeed(speed: number) {
        let vx = Math.cos(this._direction) * PlayerState.BASE_SPEED * speed;
        let vy = Math.sin(this._direction) * PlayerState.BASE_SPEED * speed;

        if (Math.abs(vx) <= EPSILON) { vx = 0; }
        if (Math.abs(vy) <= EPSILON) { vy = 0; }

        this.velocity = [vx, vy];
        this.speed = speed;
    }

    queueTurn(type: string, tick: number = 0) {
        if (this.isRunning) {
            this.turnQueue.push({ tick, type });
        }
        else {
            console.warn("Player is not running, turn was skipped");
        }
    }

    _executeTurn(type: string) {
        // Difference in angle
        let newDirection = this._direction;
        if (type === 'left') {
            newDirection = this._direction - PlayerState.ROTATION_ANGLE;
        } else if (type === 'right') {
            newDirection = this._direction + PlayerState.ROTATION_ANGLE;
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
            if (Math.abs(this.x - lastTurn.coordinates.x) <= EPSILON && Math.abs(this.y - lastTurn.coordinates.y) <= EPSILON) {
                // We haven't moved since the last turn/spawn point! 
                this.setDirection(newDirection);
                this._setSpeed(this.speed);
                lastTurn.direction = newDirection;
                lastTurn.velocity = this.velocity;
                lastTurn.speed = this.speed;
                return;
            }
        }

        const turnPoint = new PlayerPoint(new Phaser.Math.Vector2(this.x, this.y), newDirection, this.velocity, this.speed, this.currentTick)
        this.trail.addTurn(turnPoint);

        this.setDirection(newDirection);
        this._setSpeed(this.speed);

        this.bus.emit("player_turn2", this, turnPoint)
    }

    update(_time: number, delta: number, allOtherTrails: Phaser.Geom.Line[], worldWidth: number, worldHeight: number, currentTick: number = 0) {

        this.currentTick = currentTick;
        if (this.turnQueue.length > 0 && currentTick > this.lastTurnTick + PlayerState.TURN_DELAY_TICKS) {
            // Check if we should execute the turn yet
            let nextTurn = this.turnQueue.shift()!;
            this._executeTurn(nextTurn.type);
            this.lastTurnTick = currentTick;
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
            const maxMovementThisFrame = (PlayerState.BASE_SPEED * this.targetSpeed * safeDelta) / 1000;
            const slowDownDistance = Math.max(10, maxMovementThisFrame * 3);

            if (frontDistance < slowDownDistance) {
                isStuck = true;

                let speedRatio = (frontDistance * frontDistance) / (slowDownDistance * slowDownDistance);
                let maxSafeSpeed = ((frontDistance * 0.5) * 1000) / (PlayerState.BASE_SPEED * safeDelta);

                this._setSpeed(Math.min(this.targetSpeed * speedRatio, maxSafeSpeed));

                if (!this.isInvincible) {
                    this.rubber -= (0.5 * safeDelta / 16.666) / Math.max(0.1, frontDistance);
                }
            } else {
                if (this.rubber < PlayerState.BASE_RUBBER) {
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

        this.rubber = Phaser.Math.Clamp(this.rubber, 0, PlayerState.BASE_RUBBER);
        this._setSpeed(this.speed);

        this.currentLine.setTo(this.previousLineEnd.x, this.previousLineEnd.y, this.x, this.y);
    }
}
