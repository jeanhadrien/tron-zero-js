import { ECSGameWorld } from '../../shared/ECSGameWorld';
import {
  Position,
  Velocity,
  Direction,
  SpeedMult,
  Rubber,
  IsAlive,
  Color,
  PlayerId,
  TrailPoints,
} from '../../shared/ECSPlayerSystem';

export class ECSPlayerAdapter {
  eid: number;
  world: ECSGameWorld;

  private _trailPoints: any[] = [];
  private _trailLength: number = -1;
  trail: any;

  constructor(eid: number, world: ECSGameWorld) {
    this.eid = eid;
    this.world = world;
    this.trail = { getPoints: () => this._getTrailPoints() };
  }

  get id(): string {
    return PlayerId[this.eid];
  }

  get isAlive(): boolean {
    return IsAlive[this.eid] === 1;
  }

  get direction(): number {
    return Direction[this.eid];
  }

  get color(): number {
    return Color[this.eid];
  }

  get x(): number {
    return Position.x[this.eid];
  }

  get y(): number {
    return Position.y[this.eid];
  }

  get speedMult(): number {
    return SpeedMult[this.eid];
  }

  get rubber(): number {
    return Rubber[this.eid];
  }

  get velocity(): number[] {
    return [Velocity.vx[this.eid], Velocity.vy[this.eid]];
  }

  private _getTrailPoints(): any[] {
    const xs = TrailPoints.xs[this.eid];
    const ys = TrailPoints.ys[this.eid];
    const dirs = TrailPoints.dirs[this.eid];
    const n = xs?.length || 0;

    if (n === this._trailLength) return this._trailPoints;

    this._trailLength = n;
    this._trailPoints = [];
    for (let i = 0; i < n; i++) {
      this._trailPoints.push({
        coordinates: { x: xs[i], y: ys[i] },
        direction: dirs?.[i] ?? 0,
        tick: i,
      });
    }
    return this._trailPoints;
  }
}
