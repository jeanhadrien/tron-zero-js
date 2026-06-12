import { GameObjects } from 'phaser';
import type { PlayerRenderDatum, TickRenderOutput } from '../workers/WorkerProtocol';
import { TickRingBuffer } from '@tron0/shared/TickRingBuffer';

const RING_SIZE = 500; // power of 2, covers ~1s of history at 60tps
const TRAIL_WIDTH = 5;
const LIGHTCYCLE_SIZE = 10;

/**
 * Pure rendering system — consumes {@link TickRenderOutput} batches from the
 * simulation Worker and draws lightcycles, trails, and name tags.
 */
export type RenderMode = 'split' | 'unified';

export class PlayerRenderSystem {
  private scene: Phaser.Scene;

  private staticTrailGraphics: GameObjects.Graphics;
  private activeTrailGraphics: GameObjects.Graphics;
  private driverGraphics: GameObjects.Graphics;
  private nameTexts: Map<number, GameObjects.Text> = new Map();

  /** Tick-ring buffer — stores per-player render datum indexed by tick for remote-player interpolation. */
  private _renderRing: TickRingBuffer<PlayerRenderDatum> = new TickRingBuffer(RING_SIZE);

  /** Latest datum per player (for local-player extrapolation and rubber checks). */
  private _latest: Map<number, PlayerRenderDatum> = new Map();

  /** How remote players are displayed. */
  renderMode: RenderMode = 'split';

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

  // ── Data intake from Worker ──────────────────────────────────────────────

  /**
   * Feed one or more tick outputs from the Worker into the local history
   * buffer. Replay-safe — snapshots for the same tick overwrite.
   */
  consumeWorkerOutput(ticks: TickRenderOutput[]): void {
    for (const output of ticks) {
      for (const datum of output.players) {
        this._renderRing.record(output.tick, String(datum.eid), datum);
        this._latest.set(datum.eid, datum);
      }
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /**
   * Render all alive players.
   * @param alpha          0..1 interpolation factor (0 = at tick, 1 = projected to next)
   * @param localPlayerEid EID of the local human player
   * @param currentTick    Latest simulation tick (predicted)
   * @param leadTicks      How many ticks the client leads the server (for remote-player authoritative tick).
   */
  render(alpha: number, localPlayerEid: number, currentTick: number, leadTicks: number): void {
    this.staticTrailGraphics.clear();
    this.activeTrailGraphics.clear();
    this.driverGraphics.clear();

    // Hide all name texts — only alive players we render below get re-shown
    for (const text of this.nameTexts.values()) {
      text.setVisible(false);
    }

    // Estimated server tick we have authoritative state for
    const serverTick = currentTick - leadTicks;

    for (const [eid, datum] of this._latest) {
      if (!datum.isAlive) continue;

      const isLocal = eid === localPlayerEid;

      let renderX: number;
      let renderY: number;
      let direction: number;
      let color: number;
      let xs: number[];
      let ys: number[];

      if (isLocal || this.renderMode === 'unified') {
        // Local player (or unified mode) — predicted state at currentTick, extrapolate toward next tick
        renderX = datum.x + (datum.vx / 1000) * alpha;
        renderY = datum.y + (datum.vy / 1000) * alpha;
        direction = datum.direction;
        color = datum.color;
        xs = datum.trailXs;
        ys = datum.trailYs;
      } else {
        // Remote player in split mode — authoritative state at serverTick, interpolate toward next tick
        const curr = this._findPlayer(eid, serverTick);
        if (!curr) continue;

        const next = this._findPlayer(eid, serverTick + 1);
        if (next && next.tick === serverTick + 1) {
          const a = Math.min(1, Math.max(0, alpha));
          renderX = curr.x + (next.x - curr.x) * a;
          renderY = curr.y + (next.y - curr.y) * a;
        } else {
          renderX = curr.x;
          renderY = curr.y;
        }

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

      this._updateNameText(eid, datum, renderX, renderY);
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  /** Get the latest datum for a player (for camera follow, rubber checks, etc.). */
  getLatest(eid: number): PlayerRenderDatum | undefined {
    return this._latest.get(eid);
  }

  /** Get latest datums for all alive players, optionally excluding one eid. */
  getAliveDatums(excludeEid?: number): PlayerRenderDatum[] {
    const result: PlayerRenderDatum[] = [];
    for (const [eid, datum] of this._latest) {
      if (!datum.isAlive) continue;
      if (excludeEid !== undefined && eid === excludeEid) continue;
      result.push(datum);
    }
    return result;
  }

  // ── Private drawing ──────────────────────────────────────────────────────

  private _drawLightcycle(x: number, y: number, direction: number, color: number): void {
    const θ = direction + Math.PI / 2;
    const cos = Math.cos(θ);
    const sin = Math.sin(θ);

    const x0 = x + LIGHTCYCLE_SIZE * sin;
    const y0 = y - LIGHTCYCLE_SIZE * cos;
    const x1 = x - LIGHTCYCLE_SIZE * cos - LIGHTCYCLE_SIZE * sin;
    const y1 = y - LIGHTCYCLE_SIZE * sin + LIGHTCYCLE_SIZE * cos;
    const x2 = x + LIGHTCYCLE_SIZE * cos - LIGHTCYCLE_SIZE * sin;
    const y2 = y + LIGHTCYCLE_SIZE * sin + LIGHTCYCLE_SIZE * cos;

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

  private _updateNameText(eid: number, datum: PlayerRenderDatum, x: number, y: number): void {
    let text = this.nameTexts.get(eid);
    if (!text) {
      text = this.scene.add
        .text(0, 0, '', {
          fontSize: '16px',
          color: '#ffffff',
          fontFamily: 'Courier New',
        })
        .setOrigin(0.5)
        .setDepth(20);
      this.nameTexts.set(eid, text);
    }
    text.setVisible(true);
    text.setText(datum.playerId.substring(0, 16));
    text.setPosition(x, y - 15);
  }

  /** Walk backward through the tick-ring to find a player's datum at or before targetTick. */
  private _findPlayer(eid: number, targetTick: number): PlayerRenderDatum | null {
    for (let t = targetTick; t > targetTick - RING_SIZE; t--) {
      const datum = this._renderRing.get(t, String(eid));
      if (datum && datum.isAlive) return datum;
    }
    return null;
  }
}
