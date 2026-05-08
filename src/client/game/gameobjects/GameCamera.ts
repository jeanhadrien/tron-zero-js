import { Scene } from 'phaser';
import Player from '../../../shared/Player';
import GameArea from '../../../shared/GameArea';
import { EventBus } from '../EventBus';
import AudioManager from './AudioManager';

export default class GameCamera {
  private scene: Scene;
  private gameArea: GameArea;
  private audioManager: AudioManager;

  public PLAYER_VIEW_WIDTH: number = 800;
  public isCameraFollowing: boolean = true;
  private humanPlayer: Player | null = null;
  private lastX: number = 0;
  private lastY: number = 0;

  constructor(scene: Scene, gameArea: GameArea, audioManager: AudioManager) {
    this.scene = scene;
    this.gameArea = gameArea;
    this.audioManager = audioManager;

    EventBus.on('toggle-camera-follow', (followState: boolean) => {
      this.isCameraFollowing = followState;
      this.updateCameraView();
    });

    this.scene.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.updateCameraView();
    });
  }

  setHumanPlayer(player: Player | null) {
    this.humanPlayer = player;
    this.updateCameraView();
  }

  updateCameraView() {
    if (!this.humanPlayer) return;

    const canvasWidth = this.scene.scale.width;
    const canvasHeight = this.scene.scale.height;

    if (this.isCameraFollowing) {
      this.scene.cameras.main.setBounds(
        0,
        0,
        this.gameArea.width,
        this.gameArea.height,
        true
      );
      this.scene.cameras.main.setZoom(canvasWidth / this.PLAYER_VIEW_WIDTH);
    } else {
      this.scene.cameras.main.removeBounds();
      const zoomX = canvasWidth / this.gameArea.width;
      const zoomY = canvasHeight / this.gameArea.height;
      this.scene.cameras.main.setZoom(Math.min(zoomX, zoomY));
      this.scene.cameras.main.centerOn(
        this.gameArea.width / 2,
        this.gameArea.height / 2
      );
    }
  }

  update(interpolatedX: number, interpolatedY: number) {
    const cam = this.scene.cameras.main;
    const camMidX = cam.scrollX + cam.width / 2;
    const camMidY = cam.scrollY + cam.height / 2;
    this.audioManager.updateListener(camMidX, camMidY);

    if (this.isCameraFollowing) {
      this.lastX = Phaser.Math.Linear(this.lastX, interpolatedX, 0.1);
      this.lastY = Phaser.Math.Linear(this.lastY, interpolatedY, 0.1);
      this.scene.cameras.main.centerOn(this.lastX, this.lastY);
    }
  }
}
