import { GameObjects } from 'phaser';
import { query } from 'bitecs';
import { ECSGameRoom } from '../../../shared/ECSGameRoom';
import { eventGetter, inputGetter, System } from '../../../shared/interfaces/System';
import PlayerSystem, {
  Position,
  Direction,
  Color,
  SpeedMult,
  IsAlive,
  TrailPoints,
  Player,
  PlayerId,
  PingInTicks,
} from '../../../shared/systems/PlayerSystem';
import { GameEventType } from '../../../shared/interfaces/GameEvent';

interface PlayerStateSnapshot {
  tick: number;
  x: number;
  y: number;
  direction: number;
  color: number;
  speedMult: number;
  isAlive: boolean;
  trailXs: number[];
  trailYs: number[];
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

  update(_getInput: inputGetter, getEvents: eventGetter): void {
    const tick = this.room.tick;

    // Handle lifecycle events to clean up stale history
    if (getEvents) {
      for (const event of getEvents()) {
        if (event.type === GameEventType.PlayerSpawn || event.type === GameEventType.PlayerLeft) {
          let eid: number | undefined;
          if (event.entityId !== undefined) {
            eid = event.entityId;
          } else if (event.playerId) {
            try {
              eid = PlayerSystem.getPlayerEidByStringId(this.room, event.playerId);
            } catch {
              continue;
            }
          }
          if (eid !== undefined) {
            this.history.delete(eid);
            const text = this.nameTexts.get(eid);
            if (text) {
              text.destroy();
              this.nameTexts.delete(eid);
            }
          }
        }
      }
    }

    for (const eid of Array.from(query(this.room.world, [Player]))) {
      if (IsAlive[eid] !== 1) continue;

      const trailXs = [...(TrailPoints.xs[eid] ?? [])];
      const trailYs = [...(TrailPoints.ys[eid] ?? [])];

      // Respawn detection: trail reset to a single point = fresh spawn, clear stale history
      if (trailXs.length === 1) {
        this.history.delete(eid);
      }

      const snapshot: PlayerStateSnapshot = {
        tick,
        x: Position.x[eid],
        y: Position.y[eid],
        direction: Direction[eid],
        color: Color[eid],
        speedMult: SpeedMult[eid],
        isAlive: true,
        trailXs,
        trailYs,
      };

      let list = this.history.get(eid);
      if (!list) {
        list = [];
        this.history.set(eid, list);
      }

      // Replay-safe: overwrite the last entry if it has the same tick (re-simulation)
      if (list.length > 0 && list[list.length - 1].tick === tick) {
        list[list.length - 1] = snapshot;
      } else {
        list.push(snapshot);
      }

      // Trim old entries
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

      const isLocal = eid === this.localPlayerEid;

      let renderX: number;
      let renderY: number;
      let direction: number;
      let color: number;
      let xs: number[];
      let ys: number[];

      if (isLocal) {
        // Local player renders directly from the current simulation — zero delay
        renderX = Position.x[eid];
        renderY = Position.y[eid];
        direction = Direction[eid];
        color = Color[eid];
        xs = TrailPoints.xs[eid] ?? [];
        ys = TrailPoints.ys[eid] ?? [];
      } else {
        // Remote player uses delay-compensated snapshot with self-contained trail data
        const delay = Math.round(PingInTicks[eid] ?? 0);
        const targetTick = tick - delay;
        const snapshot = this._lookup(eid, targetTick);
        if (!snapshot) continue;

        renderX = snapshot.x;
        renderY = snapshot.y;
        direction = snapshot.direction;
        color = snapshot.color;
        xs = snapshot.trailXs;
        ys = snapshot.trailYs;
      }

      this._drawLightcycle(renderX, renderY, direction, color);

      if (xs.length > 0) {
        this._drawActiveTrail(xs[xs.length - 1], ys[xs.length - 1], renderX, renderY, color);
        this._drawStaticTrail(xs, ys, color);
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

  private _drawActiveTrail(lastX: number, lastY: number, currentX: number, currentY: number, color: number): void {
    this.activeTrailGraphics.lineStyle(TRAIL_WIDTH, color, 0.5);
    this.activeTrailGraphics.beginPath();
    this.activeTrailGraphics.moveTo(lastX, lastY);
    this.activeTrailGraphics.lineTo(currentX, currentY);
    this.activeTrailGraphics.strokePath();
  }

  private _drawStaticTrail(xs: number[], ys: number[], color: number): void {
    this.staticTrailGraphics.lineStyle(TRAIL_WIDTH, color, 0.5);
    this.staticTrailGraphics.beginPath();
    this.staticTrailGraphics.moveTo(xs[0], ys[0]);
    for (let i = 1; i < xs.length; i++) {
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
