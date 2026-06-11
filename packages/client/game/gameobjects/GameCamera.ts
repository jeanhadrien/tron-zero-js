import { Scene } from 'phaser';
import type GameArea from '@tron0/shared/systems/GameArenaSystem';
import AudioManager from '../managers/AudioManager';

/** Follow-mode camera: bounds-clamped, zoom 1, lerped center-on. */
export default class GameCamera {
  private scene: Scene;
  private gameArea: GameArea;
  private audioManager: AudioManager;

  private lastX: number = 0;
  private lastY: number = 0;

  constructor(scene: Scene, gameArea: GameArea, audioManager: AudioManager) {
    this.scene = scene;
    this.gameArea = gameArea;
    this.audioManager = audioManager;

    this.updateCameraView();

    this.scene.scale.on('resize', () => {
      this.updateCameraView();
    });
  }

  updateCameraView() {
    this.scene.cameras.main.setBounds(0, 0, this.gameArea.width, this.gameArea.height, true);
    this.scene.cameras.main.setZoom(1);
  }

  /** Lerp the camera toward the given world position and update the audio listener. */
  update(interpolatedX: number, interpolatedY: number) {
    const cam = this.scene.cameras.main;
    const camMidX = cam.scrollX + cam.width / 2;
    const camMidY = cam.scrollY + cam.height / 2;
    this.audioManager.updateListener(camMidX, camMidY);

    this.lastX = Phaser.Math.Linear(this.lastX, interpolatedX, 0.1);
    this.lastY = Phaser.Math.Linear(this.lastY, interpolatedY, 0.1);
    this.scene.cameras.main.centerOn(this.lastX, this.lastY);
  }
}