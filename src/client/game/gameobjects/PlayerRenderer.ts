import { GameObjects } from 'phaser';
import PlayerState from '../../../shared/PlayerState';

export default class PlayerRenderer extends Phaser.GameObjects.Image {
  driverGraphics: GameObjects.Graphics;
  staticTrailGraphics: GameObjects.Graphics;
  activeTrailGraphics: GameObjects.Graphics;

  oscillator: OscillatorNode | null = null;
  filter: BiquadFilterNode | null = null;
  panner: PannerNode | null = null;
  amp: GainNode | null = null;

  private _lastTrail: any = null;
  private _lastStaticTrailLength: number = -1;
  private _lastStaticTrailTick: number = -1;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, '_playerRenderer');
    this.scene = scene;

    this.scene.add.existing(this);
    this.setVisible(false);

    this.staticTrailGraphics = this.scene.add.graphics();
    this.activeTrailGraphics = this.scene.add.graphics();
    this.driverGraphics = this.scene.add.graphics().setDepth(10);

    this._initEngineSound();
  }

  private _initEngineSound() {
    const audioCtx = this.scene.sound
      ? ((this.scene.sound as any).context as AudioContext | undefined)
      : undefined;
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

  private _draw(player: PlayerState) {
    // old
    if (!player.isRunning) {
      this.driverGraphics.setVisible(false);
      this.activeTrailGraphics.clear();
      this.staticTrailGraphics.clear();
      this._lastStaticTrailLength = -1;
      return;
    }

    this.driverGraphics.setVisible(true);

    this.driverGraphics.x = player.x;
    this.driverGraphics.y = player.y;
    this.driverGraphics.rotation = player.direction + Math.PI / 2;
    this.driverGraphics.clear();
    this.driverGraphics.fillStyle(player.color);
    this.driverGraphics.fillTriangle(0, -7, -7, 7, 7, 7);

    const points = player.trail.getPoints();

    // DYNAMIC CURRENT LINE
    this.activeTrailGraphics.clear();
    this.activeTrailGraphics.lineStyle(player.trailWidth, player.color, 0.5);

    const lastPoint = points[points.length - 1];
    if (lastPoint) {
      this.activeTrailGraphics.beginPath();
      this.activeTrailGraphics.moveTo(
        lastPoint.coordinates.x,
        lastPoint.coordinates.y
      );
      this.activeTrailGraphics.lineTo(player.x, player.y);
      this.activeTrailGraphics.strokePath();
    }

    // STATIC TRAIL
    const length = points.length;
    const lastTick = length > 0 ? points[length - 1].tick : -1;

    if (
      this._lastTrail === player.trail &&
      this._lastStaticTrailLength === length &&
      this._lastStaticTrailTick === lastTick
    ) {
      return; // Nothing changed, skip redrawing the static trail
    }

    this._lastTrail = player.trail;
    this._lastStaticTrailLength = length;
    this._lastStaticTrailTick = lastTick;

    this.staticTrailGraphics.clear();
    this.staticTrailGraphics.lineStyle(player.trailWidth, player.color, 0.5);

    if (length >= 1) {
      this.staticTrailGraphics.beginPath();

      // 2. Move to the very first point
      this.staticTrailGraphics.moveTo(
        points[0].coordinates.x,
        points[0].coordinates.y
      );

      // 3. Draw lines to all subsequent points
      for (let i = 1; i < length; i++) {
        this.staticTrailGraphics.lineTo(
          points[i].coordinates.x,
          points[i].coordinates.y
        );
      }

      // 4. Batch the draw call to the GPU
      this.staticTrailGraphics.strokePath();
    }
  }

  _playTurnSound(player: PlayerState) {
    const audioCtx = this.scene.sound
      ? ((this.scene.sound as any).context as AudioContext | undefined)
      : undefined;
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
      panner.positionX.setValueAtTime(player.x, time);
      panner.positionY.setValueAtTime(player.y, time);
      panner.positionZ.setValueAtTime(0, time);
    } else {
      panner.setPosition(player.x, player.y, 0);
    }

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(audioCtx.destination);

    osc.start(time);
    osc.stop(time + 0.06);
  }

  private _updateEngineSound(player: PlayerState) {
    const audioCtx = this.scene.sound
      ? ((this.scene.sound as any).context as AudioContext | undefined)
      : undefined;
    if (!audioCtx || !this.oscillator || !this.panner) return;

    const baseFreq = 80;
    const targetFreq = baseFreq + player.speedMult * 40;
    this.oscillator.frequency.value = targetFreq;

    if (this.panner.positionX) {
      this.panner.positionX.value = player.x;
      this.panner.positionY.value = player.y;
      this.panner.positionZ.value = 0;
    } else {
      this.panner.setPosition(player.x, player.y, 0);
    }
  }

  render(player: PlayerState) {
    this._draw(player);
    this._updateEngineSound(player);
  }
}
