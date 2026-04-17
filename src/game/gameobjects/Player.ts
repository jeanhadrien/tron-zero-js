import { GameObjects } from 'phaser';

export default class Player extends Phaser.GameObjects.Image {

    ROTATION_ANGLE: number = Math.PI / 2;
    BASE_SPEED: number = 100;
    MAX_SPEED: number = 200;
    DETECTION_LINE_LENGTH: number = 20;
    TRAIL_MAX_LENGTH = 100;
    BASE_RUBBER = 10;
    TURN_DELAY_MS = 50;
    COLLISION_EPSILON = 1e-10; // Tolerance for floating point inaccuracies
    trailWidth = 3;

    driverGraphics: GameObjects.Graphics;

    trailLines: Phaser.Geom.Line[] = [];

    staticTrailGraphics: GameObjects.Graphics;
    activeTrailGraphics: GameObjects.Graphics;
    direction: number;

    turnQueue: string[] = [];
    lastTurnTime: number = 0;


    detectionLine: Phaser.Geom.Line;
    detectionLineLeft: Phaser.Geom.Line;
    detectionLineRight: Phaser.Geom.Line;

    previousLineEnd: Phaser.Math.Vector2;


    target: Phaser.Math.Vector2;
    isRunning: boolean;
    isInvincible: boolean = false;
    rubber: number;
    color: number;
    velocity: number[];
    speed: number;
    targetSpeed: number = 1;
    currentLine: Phaser.Geom.Line;

    oscillator: OscillatorNode | null = null;
    filter: BiquadFilterNode | null = null;
    panner: PannerNode | null = null;
    amp: GainNode | null = null;

    constructor(scene: Phaser.Scene, x: number, y: number, color: number) {
        super(scene, x, y, '_player');
        this.scene = scene;
        scene.add.existing(this);
        this.color = color;
        this.direction = 0;
        this.setVisible(false);
        this.velocity = [0, 0];
        this.isRunning = false;
        this.rubber = this.BASE_RUBBER;

        this.detectionLine = new Phaser.Geom.Line();
        this.detectionLineLeft = new Phaser.Geom.Line();
        this.detectionLineRight = new Phaser.Geom.Line();

        // Set initial positions
        this._updateDetectionLines();


        this.trailLines = [];
        this.previousLineEnd = new Phaser.Math.Vector2(this.x, this.y);

        this.staticTrailGraphics = scene.add.graphics();
        this.activeTrailGraphics = scene.add.graphics();
        this.driverGraphics = scene.add.graphics();
        this.driverGraphics.setDepth(10);
        this.driverGraphics.fillStyle(this.color);
        this.driverGraphics.fillTriangle(0, -7, -7, 7, 7, 7);

        this._initEngineSound();
    }

    _initEngineSound() {
        const audioCtx = this.scene.sound ? (this.scene.sound as any).context as AudioContext | undefined : undefined;
        if (!audioCtx) return;

        this.oscillator = audioCtx.createOscillator();
        this.oscillator.type = 'triangle';
        this.oscillator.frequency.value = 60; // Deep bass

        this.filter = audioCtx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 250; // Keep strictly in low-end

        this.panner = audioCtx.createPanner();
        this.panner.panningModel = 'HRTF';
        this.panner.distanceModel = 'exponential';
        this.panner.refDistance = 300; // Match the listener's Z height
        this.panner.maxDistance = 10000;
        this.panner.rolloffFactor = 2;

        this.amp = audioCtx.createGain();
        this.amp.gain.value = 0.1;

        this.oscillator.connect(this.filter);
        this.filter.connect(this.panner);
        this.panner.connect(this.amp);
        this.amp.connect(audioCtx.destination);

        this.oscillator.start();
    }


    destroy(fromScene?: boolean) {
        super.destroy(fromScene);
    }

    reset(x: number, y: number, direction: number) {
        this.x = x;
        this.y = y;
        this.direction = direction;
        
        // Re-draw driver graphics if it was cleared
        this.driverGraphics.clear();
        this.driverGraphics.fillStyle(this.color);
        this.driverGraphics.fillTriangle(0, -7, -7, 7, 7, 7);
        
        this.driverGraphics.rotation = this.direction + Math.PI / 2;
        this.trailLines = [];
        this.staticTrailGraphics.clear();
        this.activeTrailGraphics.clear();
        this.previousLineEnd.set(this.x, this.y);
        this.rubber = this.BASE_RUBBER;
        this.speed = 1;
        this.targetSpeed = 1;
        this.turnQueue = [];
        this._updateDetectionLines();
        this._setSpeed(1);
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

        if (this.trailLines.length > this.TRAIL_MAX_LENGTH) {
            this.trailLines.shift();
            this.staticTrailGraphics.clear();
            this.staticTrailGraphics.lineStyle(this.trailWidth, this.color, 0.5);
            for (let line of this.trailLines) {
                this.staticTrailGraphics.strokeLineShape(line);
            }
        } else {
            this.staticTrailGraphics.lineStyle(this.trailWidth, this.color, 0.5);
            this.staticTrailGraphics.strokeLineShape(newLine);
        }

        this.previousLineEnd.set(this.x, this.y);
    }

    _getLinesForCollision() {
        const gameScene = this.scene as any;
        const worldWidth = gameScene.WORLD_WIDTH || 900;
        const worldHeight = gameScene.WORLD_HEIGHT || 600;

        // Use world bounds
        const wallLines = [
            new Phaser.Geom.Line(0, 0, worldWidth, 0),
            new Phaser.Geom.Line(worldWidth, 0, worldWidth, worldHeight),
            new Phaser.Geom.Line(worldWidth, worldHeight, 0, worldHeight),
            new Phaser.Geom.Line(0, worldHeight, 0, 0)
        ];
        
        const allTrails: Phaser.Geom.Line[] = [];
        if (gameScene.playerManager && gameScene.playerManager.players) {
            for (const p of gameScene.playerManager.players) {
                if(!p.isRunning && p !== this) continue; // Only process running players (or self)
                allTrails.push(...p.trailLines);
                // Include active line segments from other players
                if (p !== this && p.currentLine) {
                    allTrails.push(p.currentLine);
                }
            }
        } else {
            allTrails.push(...this.trailLines);
        }
        
        return [...allTrails, ...wallLines];
    }

    _getClosestIntersectingPoint(sensorLine: Phaser.Geom.Line, obstacleLines: Phaser.Geom.Line[]) {
        let point;
        let closestPoint = { x: Infinity, y: Infinity }; // Note: In a real game, consider using null or a max distance check

        // Iterate over all lines
        for (const line of obstacleLines) {
            point = { x: -1, y: -1 };

            // Check intersection with the specific sensor passed in
            if (Phaser.Geom.Intersects.LineToLine(sensorLine, line, point)) {

                if (Phaser.Math.Distance.Between(point.x, point.y, this.x, this.y) < this.COLLISION_EPSILON) {
                    continue;
                }

                // Fix: Ignore collisions exactly at the corners of recent trails
                // to prevent getting stuck when doing tight zig-zags or U-turns.
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

        // this.activeTrailGraphics.lineStyle(1, 0xff0000, 0.5); // Red for sensors
        // this.activeTrailGraphics.strokeLineShape(this.detectionLine);
        // this.activeTrailGraphics.strokeLineShape(this.detectionLineLeft);
        // this.activeTrailGraphics.strokeLineShape(this.detectionLineRight);

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
    }

    turn(type: string) {
        this.turnQueue.push(type);
    }

    _executeTurn(type: string) {
        let newDirection = this.direction;
        if (type === 'left') {
            newDirection = this.direction - this.ROTATION_ANGLE;
        } else if (type === 'right') {
            newDirection = this.direction + this.ROTATION_ANGLE;
        }
        newDirection = newDirection % (Math.PI * 2);
        this._updateDirection(newDirection);
        this._setSpeed(this.speed);
        this._playTurnSound();
    }

    _playTurnSound() {
        const audioCtx = this.scene.sound ? (this.scene.sound as any).context as AudioContext | undefined : undefined;
        if (!audioCtx) return;

        const time = audioCtx.currentTime;

        const osc = audioCtx.createOscillator();
        osc.type = 'square';

        // Start high and drop quickly for a sharp "zap"
        osc.frequency.setValueAtTime(1200, time);
        osc.frequency.exponentialRampToValueAtTime(150, time + 0.05);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.05, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        const panner = audioCtx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'exponential';
        panner.refDistance = 300;
        panner.maxDistance = 10000;
        panner.rolloffFactor = 2;

        if (panner.positionX) {
            panner.positionX.setValueAtTime(this.x, time);
            panner.positionY.setValueAtTime(this.y, time);
            panner.positionZ.setValueAtTime(0, time);
        } else {
            panner.setPosition(this.x, this.y, 0);
        }

        osc.connect(gain);
        gain.connect(panner);
        panner.connect(audioCtx.destination);

        osc.start(time);
        osc.stop(time + 0.06);
    }

    update(time: number, delta: number) {
        // super.update(delta);

        if (this.turnQueue.length > 0 && time > this.lastTurnTime + this.TURN_DELAY_MS) {
            let nextTurn = this.turnQueue.shift()!;
            this._executeTurn(nextTurn);
            this.lastTurnTime = time;
        }

        this._updateDetectionLines();

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
            }
            let isStuck = false;

            const maxMovementThisFrame = (this.BASE_SPEED * this.targetSpeed * delta) / 1000;
            const slowDownDistance = Math.max(10, maxMovementThisFrame * 3);

            // If we are close enough to the obstacle, slow down
            if (frontDistance < slowDownDistance) {
                isStuck = true;

                let speedRatio = (frontDistance * frontDistance) / (slowDownDistance * slowDownDistance);

                // Zeno's Paradox slowdown: We limit maxSafeSpeed so the player covers at most half
                // the remaining distance in this frame. This creates a smooth curve where the player
                // approaches the wall infinitely without ever mathematically touching it.
                let maxSafeSpeed = ((frontDistance * 0.5) * 1000) / (this.BASE_SPEED * delta);

                this._setSpeed(Math.min(this.targetSpeed * speedRatio, maxSafeSpeed));

                if (!this.isInvincible) {
                    this.rubber -= (0.5 * delta / 16.666) / Math.max(0.1, frontDistance);
                }
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

            // Manually move the player using exact delta, ignoring Arcade Physics
            this.x += this.velocity[0] * delta / 1000;
            this.y += this.velocity[1] * delta / 1000;

        } else {
            this._setSpeed(0);
        }

        this.rubber = Phaser.Math.Clamp(this.rubber, 0, this.BASE_RUBBER);
        //Phaser.Math.Clamp(this.speed, this.BASE_SPEED, this.MAX_SPEED)
        this._setSpeed(this.speed);

        this.currentLine = new Phaser.Geom.Line(this.previousLineEnd.x, this.previousLineEnd.y, this.x, this.y);
        this._draw();

        this._updateEngineSound();
    }

    _updateEngineSound() {
        const audioCtx = this.scene.sound ? (this.scene.sound as any).context as AudioContext | undefined : undefined;
        if (!audioCtx || !this.oscillator || !this.panner) return;

        const time = audioCtx.currentTime;

        // Map speed to frequency: deep bass for engine
        const baseFreq = 80;
        const targetFreq = baseFreq + (this.speed * 40);
        this.oscillator.frequency.setTargetAtTime(targetFreq, time, 0.1);

        // Update panner position
        if (this.panner.positionX) {
            this.panner.positionX.setTargetAtTime(this.x, time, 0.05);
            this.panner.positionY.setTargetAtTime(this.y, time, 0.05);
            this.panner.positionZ.setTargetAtTime(0, time, 0.05);
        } else {
            this.panner.setPosition(this.x, this.y, 0);
        }
    }


}
