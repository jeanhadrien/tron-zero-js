import { Scene } from 'phaser';

const LISTENER_Z = 300;

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
}
