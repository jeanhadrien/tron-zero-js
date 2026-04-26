import { Scene } from 'phaser';
import PlayerState from '../../../shared/PlayerState';
import GameArea from '../../../shared/GameArea';
import { EventBus } from '../EventBus';

export default class GameCamera {
  private scene: Scene;
  private gameArea: GameArea;
  
  public PLAYER_VIEW_WIDTH: number = 800;
  public isCameraFollowing: boolean = true;
  private humanPlayer: PlayerState | null = null;
  
  constructor(scene: Scene, gameArea: GameArea) {
    this.scene = scene;
    this.gameArea = gameArea;
    
    EventBus.on('toggle-camera-follow', (followState: boolean) => {
      this.isCameraFollowing = followState;
      this.updateCameraView();
    });

    this.scene.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.updateCameraView();
    });
  }

  setHumanPlayer(player: PlayerState | null) {
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
      this.scene.cameras.main.startFollow(this.humanPlayer, true, 0.1, 0.1);
    } else {
      this.scene.cameras.main.removeBounds();
      this.scene.cameras.main.stopFollow();
      const zoomX = canvasWidth / this.gameArea.width;
      const zoomY = canvasHeight / this.gameArea.height;
      this.scene.cameras.main.setZoom(Math.min(zoomX, zoomY));
      this.scene.cameras.main.centerOn(
        this.gameArea.width / 2,
        this.gameArea.height / 2
      );
    }
  }

  update() {
    // Update audio listener to follow the camera center
    const audioCtx = (this.scene.sound as any).context as AudioContext;
    if (audioCtx) {
      const listener = audioCtx.listener;
      const cam = this.scene.cameras.main;
      const camMidX = cam.scrollX + cam.width / 2;
      const camMidY = cam.scrollY + cam.height / 2;

      if (listener.positionX) {
        listener.positionX.setTargetAtTime(camMidX, audioCtx.currentTime, 0.05);
        listener.positionY.setTargetAtTime(camMidY, audioCtx.currentTime, 0.05);
      } else {
        listener.setPosition(camMidX, camMidY, 300);
      }
    }
  }
}
