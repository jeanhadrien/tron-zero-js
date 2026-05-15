import { GameObjects } from 'phaser';
import AudioManager, { EngineSound } from './AudioManager';

interface PlayerLike {
  id: string;
  isAlive: boolean;
  direction: number;
  color: number;
  x: number;
  y: number;
  speedMult: number;
  rubber: number;
  trail: { getPoints(): readonly { coordinates: { x: number; y: number }; direction: number; tick: number }[] };
}

export default class PlayerRenderer extends Phaser.GameObjects.Image {
  driverGraphics: GameObjects.Graphics;
  staticTrailGraphics: GameObjects.Graphics;
  activeTrailGraphics: GameObjects.Graphics;
  nameText: GameObjects.Text;
  trailWidth = 2;

  private audioManager: AudioManager;
  private engineSound: EngineSound | null = null;

  private _lastTrail: any = null;
  private _lastStaticTrailLength: number = -1;
  private _lastStaticTrailTick: number = -1;

  constructor(scene: Phaser.Scene, audioManager?: AudioManager) {
    super(scene, 0, 0, '_playerRenderer');
    this.scene = scene;
    this.audioManager = audioManager ?? new AudioManager(scene);

    this.scene.add.existing(this);
    this.setVisible(false);

    this.staticTrailGraphics = this.scene.add.graphics();
    this.activeTrailGraphics = this.scene.add.graphics();
    this.driverGraphics = this.scene.add.graphics().setDepth(10);

    this.nameText = this.scene.add
      .text(0, 0, '', {
        fontSize: '10px',
        color: '#ffffff',
        fontFamily: 'Courier New',
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);

    this.engineSound = this.audioManager.createEngineSound();
  }

  destroy(fromScene?: boolean) {
    if (this.engineSound) {
      this.engineSound.destroy();
      this.engineSound = null;
    }

    if (this.driverGraphics) this.driverGraphics.destroy();
    if (this.staticTrailGraphics) this.staticTrailGraphics.destroy();
    if (this.activeTrailGraphics) this.activeTrailGraphics.destroy();
    if (this.nameText) this.nameText.destroy();
    super.destroy(fromScene);
  }

  private _drawAt(player: PlayerLike, renderX: number, renderY: number) {
    if (!player.isAlive) {
      this.driverGraphics.setVisible(false);
      this.activeTrailGraphics.clear();
      this.staticTrailGraphics.clear();
      this.nameText.setVisible(false);

      this._lastStaticTrailLength = -1;
      return;
    }

    // Name Text
    this.nameText.setVisible(true);
    this.nameText.setText(player.id.substring(0, 16));
    this.nameText.setPosition(renderX, renderY - 15);
    this.nameText.setColor('#ffffff');
    this.nameText.setTint(0xffffff);

    // Driver

    this.driverGraphics.setVisible(true);
    this.driverGraphics.x = renderX;
    this.driverGraphics.y = renderY;
    this.driverGraphics.rotation = player.direction + Math.PI / 2;
    this.driverGraphics.clear();
    this.driverGraphics.fillStyle(player.color);
    this.driverGraphics.fillTriangle(0, -7, -7, 7, 7, 7);

    const points = player.trail.getPoints();

    if (points.length == 0) {
      return;
    }

    // Active trail segment
    this.activeTrailGraphics.clear();
    this.activeTrailGraphics.lineStyle(this.trailWidth, player.color, 0.5);
    this.activeTrailGraphics.beginPath();
    this.activeTrailGraphics.moveTo(
      points[points.length - 1].coordinates.x,
      points[points.length - 1].coordinates.y
    );
    this.activeTrailGraphics.lineTo(renderX, renderY);
    this.activeTrailGraphics.strokePath();

    // Static trail segments

    if (
      this._lastTrail === player.trail &&
      this._lastStaticTrailLength === points.length &&
      this._lastStaticTrailTick === points[points.length - 1].tick
    ) {
      return; // Nothing changed, skip redrawing the static trail
    }

    this._lastTrail = player.trail;
    this._lastStaticTrailLength = points.length;
    this._lastStaticTrailTick = points[points.length - 1].tick;

    this.staticTrailGraphics.clear();
    this.staticTrailGraphics.lineStyle(this.trailWidth, player.color, 0.5);
    this.staticTrailGraphics.beginPath();

    this.staticTrailGraphics.moveTo(
      points[0].coordinates.x,
      points[0].coordinates.y
    );

    for (let i = 1; i < points.length; i++) {
      this.staticTrailGraphics.lineTo(
        points[i].coordinates.x,
        points[i].coordinates.y
      );
    }

    this.staticTrailGraphics.strokePath();
  }

  renderInterpolated(player: PlayerLike, renderX: number, renderY: number) {
    this._drawAt(player, renderX, renderY);
    this.engineSound?.update(renderX, renderY, player.speedMult);
  }
}
