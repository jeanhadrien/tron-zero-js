import { describe, it, expect, beforeEach } from 'vitest';
import PlayerState from '../PlayerState';

import { PlayerEventBus } from '../PlayerStateEventBus';
import GameArea from '../GameArea';
import GameClock from '../GameClock';

describe('Player Logic', () => {
  let state: PlayerState;

  beforeEach(() => {
    state = new PlayerState(new PlayerEventBus(), 0, 100, 100, 0, 0x00ff00);
    state.isRunning = true;
  });

  it('zig zag should not crash', () => {
    state.speedMult = 1;
    state._setSpeedAndVelocity(state.speedMult, 16.66);

    let tick = 0;
    const gameClock = new GameClock();

    const updateFrame = () => {
      tick++;
      state.update(tick, new GameArea(), gameClock, PlayerState.buildSharedCollidableLines([], new GameArea()));
    };

    state.queueTurn('right');
    state.queueTurn('right');
    updateFrame();

    state.queueTurn('left');
    state.queueTurn('left');
    updateFrame();

    expect(state.speedMult).toBeGreaterThan(0.9);
  });

  it('updates velocity immediately on turn to prevent diagonal movement', () => {
    // Set initial direction to 0 (right)
    state.direction = 0;
    state.speedMult = 1;
    state._setSpeedAndVelocity(state.speedMult, 16.66);

    // Velocity should be [BASE_SPEED, 0]
    expect(state.velocity[0]).toBeCloseTo(state.speedMult * PlayerState.BASE_SPEED * 16.66, 4);
    expect(state.velocity[1]).toBeCloseTo(0, 4);

    // Turn right (down)
    state.queueTurn('right', 1);
    const gameClock = new GameClock();
    // @ts-ignore
    gameClock.tickTimeMs = 16.66;
    state.update(1, new GameArea(), gameClock, PlayerState.buildSharedCollidableLines([], new GameArea()));

    // Velocity should immediately be updated to [0, BASE_SPEED]
    expect(state.velocity[0]).toBeCloseTo(0, 4);
    expect(state.velocity[1]).toBeCloseTo(state.speedMult * PlayerState.BASE_SPEED * 16.66, 4);
  });
});
