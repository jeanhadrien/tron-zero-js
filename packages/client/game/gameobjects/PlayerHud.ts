import type { Scene } from 'phaser';
import { BASE_RUBBER } from '@tron0/shared/systems/PlayerSystem';
import SemicircleGauge from './SemicircleGauge';

export const HUD_MAX_SPEED_MULT = 2.0;
export const HUD_GAUGE_RADIUS = 72;
export const HUD_BOTTOM_OFFSET = 0;
/** Horizontal slot centers (rubber, brake, speed). */
export const HUD_SLOT_FRACTIONS = [1 / 6, 3 / 6, 5 / 6] as const;
export const HUD_RUBBER_DECIMALS = 0;
export const HUD_SPEED_DECIMALS = 2;

export type PlayerHudValues = {
  rubber: number;
  speedMult: number;
  isColliding: boolean;
};

/** Bottom-of-canvas player gauges for rubber and speed; center slot reserved for brake. */
export default class PlayerHud {
  private rubberGauge: SemicircleGauge;
  private speedGauge: SemicircleGauge;
  private lastSpeedMult = 1;

  constructor(scene: Scene) {
    const { width, height } = scene.scale;
    const bottomY = height - HUD_BOTTOM_OFFSET;

    this.rubberGauge = new SemicircleGauge(
      scene,
      width * HUD_SLOT_FRACTIONS[0],
      bottomY,
      HUD_GAUGE_RADIUS,
      BASE_RUBBER,
      (v) => v.toFixed(HUD_RUBBER_DECIMALS)
    );
    this.speedGauge = new SemicircleGauge(
      scene,
      width * HUD_SLOT_FRACTIONS[2],
      bottomY,
      HUD_GAUGE_RADIUS,
      HUD_MAX_SPEED_MULT,
      (v) => v.toFixed(HUD_SPEED_DECIMALS)
    );

    this.setVisible(false);
  }

  /** Update gauge values from the local player's render datum. */
  update(values: PlayerHudValues): void {
    this.setVisible(true);
    this.rubberGauge.setValue(values.rubber);
    if (!values.isColliding) {
      this.lastSpeedMult = values.speedMult;
    }
    this.speedGauge.setValue(this.lastSpeedMult);
  }

  /** Show or hide all gauges. */
  setVisible(visible: boolean): void {
    this.rubberGauge.setVisible(visible);
    this.speedGauge.setVisible(visible);
  }

  /** Re-anchor gauges after a canvas resize. */
  relayout(width: number, height: number): void {
    const bottomY = height - HUD_BOTTOM_OFFSET;
    this.rubberGauge.reposition(width * HUD_SLOT_FRACTIONS[0], bottomY);
    this.speedGauge.reposition(width * HUD_SLOT_FRACTIONS[2], bottomY);
  }
}