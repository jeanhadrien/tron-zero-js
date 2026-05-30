import { GameObjects } from 'phaser';
import AudioManager, { EngineSound } from './AudioManager';
import { PlayerId, TrailPoints } from '@tron0/shared/systems/PlayerSystem';

export interface RenderSnapshot {
  tick: number;
  x: number;
  y: number;
  direction: number;
  color: number;
  speedMult: number;
  rubber: number;
  isAlive: boolean;
  trailLength: number;
  trailXs?: number[];
  trailYs?: number[];
}

export default class PlayerRenderer extends Phaser.GameObjects.Image {
  eid: number;
  world: ECSGameWorld;
  driverGraphics: GameObjects.Graphics;
  staticTrailGraphics: GameObjects.Graphics;
  activeTrailGraphics: GameObjects.Graphics;
  nameText: GameObjects.Text;
  trailWidth = 2;

  private audioManager: AudioManager;
  private engineSound: EngineSound | null = null;

  private _lastTrailLength: number = -1;

  constructor(scene: Phaser.Scene, eid: number, world: ECSGameWorld, audioManager?: AudioManager) {
    super(scene, 0, 0, '_playerRenderer');
    this.scene = scene;
    this.eid = eid;
    this.world = world;
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

  renderAt(snapshot: RenderSnapshot) {
    if (!snapshot.isAlive) {
      this.driverGraphics.setVisible(false);
      this.activeTrailGraphics.clear();
      this.staticTrailGraphics.clear();
      this.nameText.setVisible(false);
      this._lastTrailLength = -1;
      return;
    }

    const renderX = snapshot.x;
    const renderY = snapshot.y;

    this.nameText.setVisible(true);
    this.nameText.setText(PlayerId[this.eid].substring(0, 16));
    this.nameText.setPosition(renderX, renderY - 15);
    this.nameText.setColor('#ffffff');
    this.nameText.setTint(0xffffff);

    this.driverGraphics.setVisible(true);
    this.driverGraphics.x = renderX;
    this.driverGraphics.y = renderY;
    this.driverGraphics.rotation = snapshot.direction + Math.PI / 2;
    this.driverGraphics.clear();
    this.driverGraphics.fillStyle(snapshot.color);
    this.driverGraphics.fillTriangle(0, -7, -7, 7, 7, 7);

    const xs = snapshot.trailXs ?? TrailPoints.xs[this.eid];
    const ys = snapshot.trailYs ?? TrailPoints.ys[this.eid];
    if (!xs || !ys || xs.length === 0) {
      this.activeTrailGraphics.clear();
      this.staticTrailGraphics.clear();
      this._lastTrailLength = -1;
      return;
    }

    const n = Math.min(snapshot.trailLength, xs.length);

    this.activeTrailGraphics.clear();
    this.activeTrailGraphics.lineStyle(this.trailWidth, snapshot.color, 0.5);
    this.activeTrailGraphics.beginPath();
    this.activeTrailGraphics.moveTo(xs[n - 1], ys[n - 1]);
    this.activeTrailGraphics.lineTo(renderX, renderY);
    this.activeTrailGraphics.strokePath();

    if (this._lastTrailLength === n) return;
    this._lastTrailLength = n;

    this.staticTrailGraphics.clear();
    this.staticTrailGraphics.lineStyle(this.trailWidth, snapshot.color, 0.5);
    this.staticTrailGraphics.beginPath();
    this.staticTrailGraphics.moveTo(xs[0], ys[0]);
    for (let i = 1; i < n; i++) {
      this.staticTrailGraphics.lineTo(xs[i], ys[i]);
    }
    this.staticTrailGraphics.strokePath();

    this.engineSound?.update(renderX, renderY, snapshot.speedMult);
  }
}
