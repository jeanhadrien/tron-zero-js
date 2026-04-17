import { GameObjects } from 'phaser';
import PlayerState from '../shared/PlayerState';

export default class Player extends Phaser.GameObjects.Image {
    pState: PlayerState;

    driverGraphics: GameObjects.Graphics;
    staticTrailGraphics: GameObjects.Graphics;
    activeTrailGraphics: GameObjects.Graphics;

    oscillator: OscillatorNode | null = null;
    filter: BiquadFilterNode | null = null;
    panner: PannerNode | null = null;
    amp: GainNode | null = null;

    constructor(scene: Phaser.Scene, state: PlayerState) {
        super(scene, state.x, state.y, '_player');
        this.scene = scene;
        scene.add.existing(this);
        
        this.pState = state;
        
        this.setVisible(false);

        this.staticTrailGraphics = scene.add.graphics();
        this.activeTrailGraphics = scene.add.graphics();
        this.driverGraphics = scene.add.graphics();
        this.driverGraphics.setDepth(10);
        this.driverGraphics.fillStyle(this.pState.color);
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
        if (this.oscillator) {
            this.oscillator.stop();
            this.oscillator.disconnect();
        }
        if (this.filter) this.filter.disconnect();
        if (this.panner) this.panner.disconnect();
        if (this.amp) this.amp.disconnect();

        if (this.driverGraphics) this.driverGraphics.destroy();
        if (this.staticTrailGraphics) this.staticTrailGraphics.destroy();
        if (this.activeTrailGraphics) this.activeTrailGraphics.destroy();
        super.destroy(fromScene);
    }

    reset(x: number, y: number, direction: number) {
        this.pState.reset(x, y, direction);
        this.x = x;
        this.y = y;
        
        this.driverGraphics.clear();
        this.driverGraphics.fillStyle(this.pState.color);
        this.driverGraphics.fillTriangle(0, -7, -7, 7, 7, 7);
        this.driverGraphics.rotation = this.pState.direction + Math.PI / 2;
        
        this.staticTrailGraphics.clear();
        this.activeTrailGraphics.clear();
    }

    turn(type: string) {
        // Turning is now done server-side, but keep this for local testing if needed
        this.pState.turn(type);
    }

    // Pass-through getters/setters for BotController / Scene / DebugHUD
    get direction() { return this.pState.direction; }
    set direction(val) { this.pState.direction = val; }
    get speed() { return this.pState.speed; }
    set speed(val) { this.pState.speed = val; }
    get targetSpeed() { return this.pState.targetSpeed; }
    set targetSpeed(val) { this.pState.targetSpeed = val; }
    get velocity() { return this.pState.velocity; }
    get color() { return this.pState.color; }
    get rubber() { return this.pState.rubber; }
    set rubber(val) { this.pState.rubber = val; }
    get isRunning() { return this.pState.isRunning; }
    set isRunning(val) { this.pState.isRunning = val; }
    get isInvincible() { return this.pState.isInvincible; }
    set isInvincible(val) { this.pState.isInvincible = val; }
    get trailLines() { return this.pState.trailLines; }
    set trailLines(val) { this.pState.trailLines = val; }
    get currentLine() { return this.pState.currentLine; }
    get detectionLine() { return this.pState.detectionLine; }
    get detectionLineLeft() { return this.pState.detectionLineLeft; }
    get detectionLineRight() { return this.pState.detectionLineRight; }
    get turnQueue() { return this.pState.turnQueue; }

    _updateDirection(angle: number) {
        this.pState.updateDirection(angle);
    }
    
    _setSpeed(speed: number) {
        this.pState._setSpeed(speed);
    }

    _draw() {
        this.x = this.pState.x;
        this.y = this.pState.y;
        this.driverGraphics.x = this.pState.x;
        this.driverGraphics.y = this.pState.y;
        this.driverGraphics.rotation = this.pState.direction + Math.PI / 2;

        this.activeTrailGraphics.clear();
        this.activeTrailGraphics.lineStyle(this.pState.trailWidth, this.pState.color, 0.5);
        this.activeTrailGraphics.strokeLineShape(this.pState.currentLine);

        this.staticTrailGraphics.clear();
        this.staticTrailGraphics.lineStyle(this.pState.trailWidth, this.pState.color, 0.5);
        for (let line of this.pState.trailLines) {
            this.staticTrailGraphics.strokeLineShape(line);
        }
    }

    _playTurnSound() {
        const audioCtx = this.scene.sound ? (this.scene.sound as any).context as AudioContext | undefined : undefined;
        if (!audioCtx) return;

        const time = audioCtx.currentTime;

        const osc = audioCtx.createOscillator();
        osc.type = 'square';

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
            panner.positionX.setValueAtTime(this.pState.x, time);
            panner.positionY.setValueAtTime(this.pState.y, time);
            panner.positionZ.setValueAtTime(0, time);
        } else {
            panner.setPosition(this.pState.x, this.pState.y, 0);
        }

        osc.connect(gain);
        gain.connect(panner);
        panner.connect(audioCtx.destination);

        osc.start(time);
        osc.stop(time + 0.06);
    }

    _updateEngineSound() {
        const audioCtx = this.scene.sound ? (this.scene.sound as any).context as AudioContext | undefined : undefined;
        if (!audioCtx || !this.oscillator || !this.panner) return;

        const time = audioCtx.currentTime;

        const baseFreq = 80;
        const targetFreq = baseFreq + (this.pState.speed * 40);
        this.oscillator.frequency.setTargetAtTime(targetFreq, time, 0.1);

        if (this.panner.positionX) {
            this.panner.positionX.setTargetAtTime(this.pState.x, time, 0.05);
            this.panner.positionY.setTargetAtTime(this.pState.y, time, 0.05);
            this.panner.positionZ.setTargetAtTime(0, time, 0.05);
        } else {
            this.panner.setPosition(this.pState.x, this.pState.y, 0);
        }
    }

    updateServerState(serverState: any) {
        const prevDir = this.pState.direction;
        
        // Copy state from server
        this.pState.x = serverState.x;
        this.pState.y = serverState.y;
        this.pState.direction = serverState.direction;
        this.pState.rubber = serverState.rubber;
        this.pState.isRunning = serverState.isRunning;
        
        // Reconstruct trail lines (since they come as raw coordinate objects)
        this.pState.trailLines = serverState.trailLines.map((l: any) => new Phaser.Geom.Line(l.x1, l.y1, l.x2, l.y2));
        this.pState.previousLineEnd.set(serverState.previousLineEnd.x, serverState.previousLineEnd.y);
        this.pState.currentLine.setTo(this.pState.previousLineEnd.x, this.pState.previousLineEnd.y, this.pState.x, this.pState.y);

        if (prevDir !== this.pState.direction) {
            this._playTurnSound();
        }

        this._draw();
        this._updateEngineSound();
    }

    update(time: number, delta: number) {
        // The game loop is handled by the authoritative server now.
        // We just render the state we receive in updateServerState.
        // We still need to call this just to make sure the engine sound stays smooth,
        // although we might just want it called in updateServerState.
        this._draw();
        this._updateEngineSound();
    }
}
