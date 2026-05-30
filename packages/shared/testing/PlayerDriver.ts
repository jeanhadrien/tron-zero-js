import type Scenario from './Scenario';

export type Action =
  | { type: 'spawn'; x: number; y: number; direction: string }
  | { type: 'move'; distance: number }
  | { type: 'turn'; dir: 'left' | 'right' }
  | { type: 'wait'; ticks: number }
  | { type: 'speed'; mult: number };

const VALID_DIRECTIONS = ['right', 'down', 'left', 'up'];

const DIRECTION_MAP: Record<string, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: Math.PI * 1.5,
};

export function directionToRad(dir: string): number {
  const rad = DIRECTION_MAP[dir];
  if (rad === undefined) {
    throw new Error(
      `Unknown direction "${dir}". Valid: ${VALID_DIRECTIONS.join(', ')}`
    );
  }
  return rad;
}

export class PlayerDriver {
  readonly name: string;
  readonly plan: Action[] = [];

  constructor(
    name: string,
    private scenario: Scenario
  ) {
    this.name = name;
  }

  spawn(x: number, y: number, direction: string): this {
    if (!VALID_DIRECTIONS.includes(direction)) {
      throw new Error(
        `Unknown direction "${direction}". Valid: ${VALID_DIRECTIONS.join(', ')}`
      );
    }
    this.plan.push({ type: 'spawn', x, y, direction });
    return this;
  }

  move(distance: number): this {
    if (distance <= 0) {
      throw new Error(`move distance must be positive, got ${distance}`);
    }
    this.plan.push({ type: 'move', distance });
    return this;
  }

  turnRight(): this {
    this.plan.push({ type: 'turn', dir: 'right' });
    return this;
  }

  turnLeft(): this {
    this.plan.push({ type: 'turn', dir: 'left' });
    return this;
  }

  wait(ticks: number): this {
    if (ticks <= 0) {
      throw new Error(`wait ticks must be positive, got ${ticks}`);
    }
    this.plan.push({ type: 'wait', ticks });
    return this;
  }

  speed(mult: number): this {
    if (mult <= 0) {
      throw new Error(`speed mult must be positive, got ${mult}`);
    }
    this.plan.push({ type: 'speed', mult });
    return this;
  }

  player(name: string): PlayerDriver {
    return this.scenario.player(name);
  }

  simulate(maxTicks?: number) {
    return this.scenario.simulate(maxTicks);
  }
}
