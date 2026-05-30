import { describe, it, expect } from 'vitest';
import Scenario from '../testing/Scenario';

describe('Player Collision', () => {
  it('does not pass through walls at high speeds', () => {
    const scenario = new Scenario()
      .player('A')
      .spawn(0, 500, 'right')
      .speed(10)
      .move(200)
      .player('W')
      .spawn(51, 500, 'up')
      .move(20);

    const result = scenario.simulate(100);

    expect(result.player('A').alive).toBe(true);
    expect(result.player('A').x).toBeLessThan(51);
    expect(result.player('A').speedMult).toBeLessThan(1);
  });

  it('moves player and survives in open space', () => {
    const scenario = new Scenario()
      .player('P')
      .spawn(100, 100, 'right')
      .move(100);

    const result = scenario.simulate();

    expect(result.player('P').alive).toBe(true);
    expect(result.player('P').x).toBeGreaterThan(150);
  });

  it('survives with two non-colliding players', () => {
    const scenario = new Scenario()
      .player('A')
      .spawn(100, 100, 'right')
      .move(100)
      .player('B')
      .spawn(800, 100, 'down')
      .move(100);

    const result = scenario.simulate();

    expect(result.player('A').alive).toBe(true);
    expect(result.player('B').alive).toBe(true);
  });
});
