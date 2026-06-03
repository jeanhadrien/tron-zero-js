import { GameObjects } from 'phaser';
import type { PlayerRenderDatum, TickRenderOutput } from '@tron0/shared/WorkerProtocol';

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
  tickTimeMs: number;
}

const MAX_SNAPSHOT_AGE = 60;
const TRAIL_WIDTH = 2;

/**
 * Pure rendering system — consumes {@link TickRenderOutput} batches from the
 * simulation Worker and draws lightcycles, trails, and name tags.
 *
 * No longer an ECS System; does not read {@link Position}, {@link TrailPoints},
 * or any other ECS component directly.
 */
export class PlayerRenderSystem {
  private scene: Phaser.Scene;

  private staticTrailGraphics: GameObjects.Graphics;
  private activeTrailGraphics: GameObjects.Graphics;
  private driverGraphics: GameObjects.Graphics;
  private nameTexts: Map<number, GameObjects.Text> = new Map();

  /** Snapshot history per player eid (for remote-player interpolation). */
  private _history: Map<number, PlayerStateSnapshot[]> = new Map();

  /** Latest datum per player (for local-player extrapolation and rubber checks). */
  private _latest: Map<number, PlayerRenderDatum> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private _initialized: boolean = false;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(): void {
    if (this._initialized) return;
    this._initialized = true;

    this.staticTrailGraphics = this.scene.add.graphics().setDepth(1);
    this.activeTrailGraphics = this.scene.add.graphics().setDepth(2);
    this.driverGraphics = this.scene.add.graphics().setDepth(10);
  }

  destroy(): void {
    for (const text of this.nameTexts.values()) text.destroy();
    this.nameTexts.clear();
    this.staticTrailGraphics?.destroy();
    this.activeTrailGraphics?.destroy();
    this.driverGraphics?.destroy();
    this._initialized = false;
  }

  // ── Data intake from Worker ──────────────────────────────────────────────

  /**
   * Feed one or more tick outputs from the Worker into the local history
   * buffer. Replay-safe — snapshots for the same tick overwrite.
   */
  consumeWorkerOutput(ticks: TickRenderOutput[]): void {
    for (const output of ticks) {
      for (const datum of output.players) {
        // Respawn detection: trail reset to a single point
        if (datum.trailXs.length === 1) {
          this._history.delete(datum.eid);
        }

        const snapshot: PlayerStateSnapshot = {
          tick: datum.tick,
          x: datum.x,
          y: datum.y,
          direction: datum.direction,
          color: datum.color,
          speedMult: datum.speedMult,
          isAlive: datum.isAlive,
          trailXs: datum.trailXs,
          trailYs: datum.trailYs,
          tickTimeMs: datum.tickTimeMs,
        };

        let list = this._history.get(datum.eid);
        if (!list) {
          list = [];
          this._history.set(datum.eid, list);
        }

        // Replay-safe: overwrite last entry if same tick
        if (list.length > 0 && list[list.length - 1].tick === datum.tick) {
          list[list.length - 1] = snapshot;
        } else {
          list.push(snapshot);
        }

        // Trim old entries
        while (list.length > 0 && list[0].tick < datum.tick - MAX_SNAPSHOT_AGE) {
          list.shift();
        }

        this._latest.set(datum.eid, datum);
      }
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /**
   * Render all alive players.
   * @param alpha          0..1 interpolation factor (0 = at tick, 1 = projected to next)
   * @param localPlayerEid EID of the local human player
   * @param currentTick    Latest simulation tick
   * @param tickTimeMs     Current tick duration (for remote-player scale correction)
   */
  render(alpha: number, localPlayerEid: number, currentTick: number, tickTimeMs: number): void {
    this.staticTrailGraphics.clear();
    this.activeTrailGraphics.clear();
    this.driverGraphics.clear();

    for (const [eid, datum] of this._latest) {
      if (!datum.isAlive) continue;

      const isLocal = eid === localPlayerEid;

      let renderX: number;
      let renderY: number;
      let direction: number;
      let color: number;
      let xs: number[];
      let ys: number[];

      if (isLocal) {
        // Local player — extrapolate from current position toward next tick
        renderX = datum.x + (datum.vx / 1000) * alpha;
        renderY = datum.y + (datum.vy / 1000) * alpha;
        direction = datum.direction;
        color = datum.color;
        xs = datum.trailXs;
        ys = datum.trailYs;
      } else {
        // Remote player — lerp between two snapshots with scale correction for clock drift
        const delay = Math.round(datum.pingInTicks ?? 0);
        const targetTick = currentTick - delay;
        const curr = this._lookup(eid, targetTick);
        if (!curr) continue;
        const prev = this._lookup(eid, targetTick - 1);

        const a = Math.min(1, Math.max(0, alpha));
        const scale = tickTimeMs / curr.tickTimeMs;

        renderX = prev ? prev.x + (curr.x - prev.x) * a * scale : curr.x;
        renderY = prev ? prev.y + (curr.y - prev.y) * a * scale : curr.y;
        direction = curr.direction;
        color = curr.color;
        xs = curr.trailXs;
        ys = curr.trailYs;
      }

      this._drawLightcycle(renderX, renderY, direction, color);

      if (xs.length > 0) {
        this._drawActiveTrail(xs[xs.length - 1], ys[xs.length - 1], renderX, renderY, color);
        this._drawStaticTrail(xs, ys, color);
      }

      this._updateNameText(eid, renderX, renderY);
    }

    this._cleanupTexts();
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  /** Get the latest datum for a player (for camera follow, rubber checks, etc.). */
  getLatest(eid: number): PlayerRenderDatum | undefined {
    return this._latest.get(eid);
  }

  // ── Private drawing ──────────────────────────────────────────────────────

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
    const datum = this._latest.get(eid);
    text.setVisible(true);
    text.setText((datum?.playerId ?? '').substring(0, 16));
    text.setPosition(x, y - 15);
  }

  private _cleanupTexts(): void {
    for (const [eid, text] of this.nameTexts) {
      const datum = this._latest.get(eid);
      if (!datum || !datum.isAlive) {
        text.setVisible(false);
      }
    }
  }

  private _lookup(eid: number, targetTick: number): PlayerStateSnapshot | null {
    const list = this._history.get(eid);
    if (!list || list.length === 0) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].tick <= targetTick) return list[i];
    }
    return list[0];
  }
}
