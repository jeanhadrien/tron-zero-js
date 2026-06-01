import { Scene } from 'phaser';

export interface EngineSound {
  update(x: number, y: number, speedMult: number): void;
  destroy(): void;
}

const LISTENER_Z = 300;
const PANNER_REF_DISTANCE = 300;
const PANNER_MAX_DISTANCE = 10000;
const PANNER_ROLLOFF = 2;

export default class AudioManager {
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  private get ctx(): AudioContext | undefined {
    return this.scene.sound
      ? ((this.scene.sound as any).context as AudioContext | undefined)
      : undefined;
  }

  initListener(canvasWidth: number, canvasHeight: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const listener = ctx.listener;
    if (listener.positionX) {
      listener.positionX.value = canvasWidth / 2;
      listener.positionY.value = canvasHeight / 2;
      listener.positionZ.value = LISTENER_Z;
      listener.forwardX.value = 0;
      listener.forwardY.value = 0;
      listener.forwardZ.value = -1;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else {
      listener.setPosition(canvasWidth / 2, canvasHeight / 2, LISTENER_Z);
      listener.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  updateListener(x: number, y: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const listener = ctx.listener;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(x, ctx.currentTime, 0.05);
      listener.positionY.setTargetAtTime(y, ctx.currentTime, 0.05);
    } else {
      listener.setPosition(x, y, LISTENER_Z);
    }
  }

  resume(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
  }

  createEngineSound(): EngineSound {
    const ctx = this.ctx;
    if (!ctx) {
      return { update: () => {}, destroy: () => {} };
    }

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 60;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 250;

    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'exponential';
    panner.refDistance = PANNER_REF_DISTANCE;
    panner.maxDistance = PANNER_MAX_DISTANCE;
    panner.rolloffFactor = PANNER_ROLLOFF;

    const amp = ctx.createGain();
    amp.gain.value = 0.1;

    osc.connect(filter);
    filter.connect(panner);
    panner.connect(amp);
    amp.connect(ctx.destination);

    osc.start();

    return {
      update: (px, py, speedMult) => {
        const baseFreq = 80;
        osc.frequency.value = baseFreq + speedMult * 40;

        if (panner.positionX) {
          panner.positionX.value = px;
          panner.positionY.value = py;
          panner.positionZ.value = 0;
        } else {
          panner.setPosition(px, py, 0);
        }
      },
      destroy: () => {
        try { osc.stop(); } catch (_) { /* already stopped */ }
        osc.disconnect();
        filter.disconnect();
        panner.disconnect();
        amp.disconnect();
      },
    };
  }

  playTurnSound(x: number, y: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const time = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, time);
    osc.frequency.exponentialRampToValueAtTime(150, time + 0.05);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.05, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'exponential';
    panner.refDistance = PANNER_REF_DISTANCE;
    panner.maxDistance = PANNER_MAX_DISTANCE;
    panner.rolloffFactor = PANNER_ROLLOFF;

    if (panner.positionX) {
      panner.positionX.setValueAtTime(x, time);
      panner.positionY.setValueAtTime(y, time);
      panner.positionZ.setValueAtTime(0, time);
    } else {
      panner.setPosition(x, y, 0);
    }

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + 0.06);
  }
}
