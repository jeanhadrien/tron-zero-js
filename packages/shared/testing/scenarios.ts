import Scenario from './Scenario';
import type { PlayerDriver } from './PlayerDriver';

export interface ScenarioOptions {
  width?: number;
  height?: number;
  tickTimeMs?: number;
  record?: boolean;
}

export function highSpeedWallCollision(
  options?: ScenarioOptions
): PlayerDriver {
  return new Scenario(options)
    .player('A')
    .spawn(0, 500, 'right')
    .speed(10)
    .move(200)
    .player('W')
    .spawn(51, 500, 'up')
    .move(20);
}

export function moveInOpenSpace(options?: ScenarioOptions): PlayerDriver {
  return new Scenario(options).player('P').spawn(100, 100, 'right').move(100);
}

export function twoNonCollidingPlayers(
  options?: ScenarioOptions
): PlayerDriver {
  return new Scenario(options)
    .player('A')
    .spawn(100, 100, 'right')
    .move(100)
    .player('B')
    .spawn(800, 100, 'down')
    .move(100);
}

export interface ScenarioEntry {
  name: string;
  fn: (options?: ScenarioOptions) => PlayerDriver;
}

export const SCENARIO_REGISTRY: ScenarioEntry[] = [
  { name: 'High-Speed Wall Collision', fn: highSpeedWallCollision },
  { name: 'Move in Open Space', fn: moveInOpenSpace },
  { name: 'Two Non-Colliding Players', fn: twoNonCollidingPlayers },
];
