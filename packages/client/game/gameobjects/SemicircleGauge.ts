import type { Scene } from 'phaser';

export const GAUGE_ZERO_ANGLE = Math.PI;
export const GAUGE_MAX_ANGLE_OFFSET = -0.25;
export const GAUGE_MAX_ANGLE = 2 * Math.PI + GAUGE_MAX_ANGLE_OFFSET;
export const GAUGE_NEEDLE_LENGTH_FACTOR = 0.92;
export const GAUGE_TIP_TEXT_OFFSET = 10;
export const GAUGE_HUD_DEPTH = 1100;
export const GAUGE_TRACK_LINE_WIDTH = 1;
export const GAUGE_TRACK_ALPHA = 0.25;
export const GAUGE_NEEDLE_LINE_WIDTH = 2;
export const GAUGE_VALUE_FONT_SIZE = '12px';

/** Screen-fixed semicircle gauge with a white needle and value text at the tip. */
export default class SemicircleGauge {
  private readonly maxValue: number;
  private readonly format: (value: number) => string;

  private centerX: number;
  private bottomY: number;
  private readonly radius: number;
  private lastValue = 0;

  private track: Phaser.GameObjects.Graphics;
  private needle: Phaser.GameObjects.Graphics;
  private valueText: Phaser.GameObjects.Text;

  constructor(
    scene: Scene,
    centerX: number,
    bottomY: number,
    radius: number,
    maxValue: number,
    format: (value: number) => string = (v) => v.toFixed(1)
  ) {
    this.centerX = centerX;
    this.bottomY = bottomY;
    this.radius = radius;
    this.maxValue = maxValue;
    this.format = format;

    this.track = scene.add.graphics().setScrollFactor(0).setDepth(GAUGE_HUD_DEPTH);
    this.needle = scene.add.graphics().setScrollFactor(0).setDepth(GAUGE_HUD_DEPTH);
    this.valueText = scene.add
      .text(0, 0, '', {
        fontSize: GAUGE_VALUE_FONT_SIZE,
        color: '#ffffff',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(GAUGE_HUD_DEPTH);

    this.drawTrack();
    this.setValue(0);
  }

  /** Update the displayed value and redraw the needle + tip label. */
  setValue(value: number): void {
    this.lastValue = value;
    const t = Math.min(Math.max(value / this.maxValue, 0), 1);
    const angle = GAUGE_ZERO_ANGLE + (GAUGE_MAX_ANGLE - GAUGE_ZERO_ANGLE) * t;
    const needleLength = this.radius * GAUGE_NEEDLE_LENGTH_FACTOR;
    const tipX = this.centerX + Math.cos(angle) * needleLength;
    const tipY = this.bottomY + Math.sin(angle) * needleLength;

    this.needle.clear();
    this.needle.lineStyle(GAUGE_NEEDLE_LINE_WIDTH, 0xffffff, 1);
    this.needle.beginPath();
    this.needle.moveTo(this.centerX, this.bottomY);
    this.needle.lineTo(tipX, tipY);
    this.needle.strokePath();

    const labelX = tipX + Math.cos(angle) * GAUGE_TIP_TEXT_OFFSET;
    const labelY = tipY + Math.sin(angle) * GAUGE_TIP_TEXT_OFFSET;
    this.valueText.setPosition(labelX, labelY).setText(this.format(value));
  }

  /** Show or hide all gauge objects. */
  setVisible(visible: boolean): void {
    this.track.setVisible(visible);
    this.needle.setVisible(visible);
    this.valueText.setVisible(visible);
  }

  /** Reposition the gauge pivot when the canvas resizes. */
  reposition(centerX: number, bottomY: number): void {
    this.centerX = centerX;
    this.bottomY = bottomY;
    this.drawTrack();
    this.setValue(this.lastValue);
  }

  private drawTrack(): void {
    this.track.clear();
    this.track.lineStyle(GAUGE_TRACK_LINE_WIDTH, 0xffffff, GAUGE_TRACK_ALPHA);
    this.track.beginPath();
    this.track.arc(this.centerX, this.bottomY, this.radius, GAUGE_ZERO_ANGLE, GAUGE_MAX_ANGLE, true);
    this.track.strokePath();
  }
}
