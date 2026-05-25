import { GameObjects } from 'phaser';
import { query } from 'bitecs';
import { ECSGameRoom } from '../../../shared/ECSGameRoom';
import { eventGetter, inputGetter, System } from '../../../shared/ECSSystem';
import {
  Position,
  Direction,
  Color,
  SpeedMult,
  IsAlive,
  TrailPoints,
  Player,
  PlayerId,
  PingInTicks,
} from '../../../shared/systems/ECSPlayerSystem';

interface PlayerStateSnapshot {
  tick: number;
  x: number;
  y: number;
  direction: number;
  color: number;
  speedMult: number;
  isAlive: boolean;
  trailLength: number;
}

const MAX_SNAPSHOT_AGE = 60;
const TRAIL_WIDTH = 2;

export class PlayerRenderSystem extends System {
  readonly key = 'player-render';

  localPlayerEid: number = -1;

  private room: ECSGameRoom;
  private scene: Phaser.Scene;

  private staticTrailGraphics: GameObjects.Graphics;
  private activeTrailGraphics: GameObjects.Graphics;
  private driverGraphics: GameObjects.Graphics;
  private nameTexts: Map<number, GameObjects.Text> = new Map();

  private history: Map<number, PlayerStateSnapshot[]> = new Map();

  constructor(scene: Phaser.Scene) {
    super();
    this.scene = scene;
  }

  getComponents(): object[] {
    return [];
  }

  init(room: ECSGameRoom): void {
    this.room = room;

    this.staticTrailGraphics = this.scene.add.graphics().setDepth(1);
    this.activeTrailGraphics = this.scene.add.graphics().setDepth(2);
    this.driverGraphics = this.scene.add.graphics().setDepth(10);
  }

  update(_getInput: inputGetter, _getEvents: eventGetter): void {
    const tick = this.room.tick;

    for (const eid of Array.from(query(this.room.world, [Player]))) {
      if (IsAlive[eid] !== 1) continue;

      const snapshot: PlayerStateSnapshot = {
        tick,
        x: Position.x[eid],
        y: Position.y[eid],
        direction: Direction[eid],
        color: Color[eid],
        speedMult: SpeedMult[eid],
        isAlive: true,
        trailLength: TrailPoints.xs[eid]?.length ?? 0,
      };

      let list = this.history.get(eid);
      if (!list) {
        list = [];
        this.history.set(eid, list);
      }
      list.push(snapshot);
      while (list.length > 0 && list[0].tick < tick - MAX_SNAPSHOT_AGE) {
        list.shift();
      }
    }
  }

  render(): void {
    const tick = this.room.tick;

    this.staticTrailGraphics.clear();
    this.activeTrailGraphics.clear();
    this.driverGraphics.clear();

    const living = new Set(query(this.room.world, [Player]));

    for (const eid of living) {
      if (IsAlive[eid] !== 1) continue;

      const delay = eid === this.localPlayerEid ? 0 : Math.round(PingInTicks[eid] ?? 0);
      const targetTick = tick - delay;

      const snapshot = this._lookup(eid, targetTick);
      if (!snapshot) continue;

      const renderX = snapshot.x;
      const renderY = snapshot.y;

      this._drawLightcycle(renderX, renderY, snapshot.direction, snapshot.color);

      const xs = TrailPoints.xs[eid];
      const ys = TrailPoints.ys[eid];
      const n = Math.min(snapshot.trailLength, xs.length);

      if (n > 0) {
        this._drawActiveTrail(xs[n - 1], ys[n - 1], renderX, renderY, snapshot.color);
        this._drawStaticTrail(xs, ys, n, snapshot.color);
      }

      this._updateNameText(eid, renderX, renderY);
    }

    this._cleanupTexts(living);
  }

  destroy(): void {
    for (const text of this.nameTexts.values()) text.destroy();
    this.nameTexts.clear();
    this.staticTrailGraphics?.destroy();
    this.activeTrailGraphics?.destroy();
    this.driverGraphics?.destroy();
  }

  private _drawLightcycle(x: number, y: number, direction: number, color: number): void {
    const θ = direction + Math.PI / 2;
    const cos = Math.cos(θ);
    const sin = Math.sin(θ);

    const x0 = x + 7 * sin;
    const y0 = y - 7 * cos;
    const x1 = x - 7 * cos - 7 * sin;
    const y1 = y - 7 * sin + 7 * cos;
    const x2 = x + 7 * cos - 7 * sin;
    const y2 = y + 7 * sin + 7 * cos;

    this.driverGraphics.fillStyle(color);
    this.driverGraphics.fillTriangle(x0, y0, x1, y1, x2, y2);
  }

  private _drawActiveTrail(
    lastX: number,
    lastY: number,
    currentX: number,
    currentY: number,
    color: number
  ): void {
    this.activeTrailGraphics.lineStyle(TRAIL_WIDTH, color, 0.5);
    this.activeTrailGraphics.beginPath();
    this.activeTrailGraphics.moveTo(lastX, lastY);
    this.activeTrailGraphics.lineTo(currentX, currentY);
    this.activeTrailGraphics.strokePath();
  }

  private _drawStaticTrail(xs: number[], ys: number[], n: number, color: number): void {
    this.staticTrailGraphics.lineStyle(TRAIL_WIDTH, color, 0.5);
    this.staticTrailGraphics.beginPath();
    this.staticTrailGraphics.moveTo(xs[0], ys[0]);
    for (let i = 1; i < n; i++) {
      this.staticTrailGraphics.lineTo(xs[i], ys[i]);
    }
    this.staticTrailGraphics.strokePath();
  }

  private _updateNameText(eid: number, x: number, y: number): void {
    let text = this.nameTexts.get(eid);
    if (!text) {
      text = this.scene.add
        .text(0, 0, '', {
          fontSize: '10px',
          color: '#ffffff',
          fontFamily: 'Courier New',
        })
        .setOrigin(0.5)
        .setDepth(20);
      this.nameTexts.set(eid, text);
    }
    text.setVisible(true);
    text.setText((PlayerId[eid] ?? '').substring(0, 16));
    text.setPosition(x, y - 15);
  }

  private _cleanupTexts(living: Set<number>): void {
    for (const [eid, text] of this.nameTexts) {
      if (!living.has(eid) || IsAlive[eid] !== 1) {
        text.setVisible(false);
      }
    }
  }

  private _lookup(eid: number, targetTick: number): PlayerStateSnapshot | null {
    const list = this.history.get(eid);
    if (!list || list.length === 0) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].tick <= targetTick) return list[i];
    }
    return list[0];
  }
}
