import { describe, it, expect, beforeEach } from 'vitest';
import PlayerState from '../PlayerState';
import { PlayerEventBus } from '../PlayerStateEventBus';
import { PlayerPoint } from '../PlayerPoint';
import GameArea from '../GameArea';
import GameClock from '../GameClock';

describe('Player Collision', () => {
  let state: PlayerState;

  beforeEach(() => {
    state = new PlayerState(new PlayerEventBus(), 0, 0, 0, 0, 0xff0000);
    state.isRunning = true;
  });

  it('should not pass through walls at high speeds', () => {
    state.direction = 0;
    state.x = 0;
    state.y = 0;

    state.speedMult = 10;
    state.targetSpeedMult = 10;
    state._setSpeedAndVelocity(10, 16.666);

    // To properly set up collision we need to ensure the other player's line is checked.
    // The physics currently check against `allPlayers` which includes `this`,
    // and loops through `trail` (points).
    
    const gameArea = new GameArea();
    const gameClock = new GameClock();
    // @ts-ignore
    gameClock.tickTimeMs = 16.666;
    
    // Inject a wall via a fake opponent instead of trailLines, since the physics engine uses points.
    const fakeOpponent = new PlayerState(new PlayerEventBus(), 0, 51, 10, Math.PI / 2, 0xffffff);
    // Overwrite the first initial turn added by constructor
    fakeOpponent.trail.getPoints()[0].coordinates.x = 51;
    fakeOpponent.trail.getPoints()[0].coordinates.y = -10;
    fakeOpponent.trail.addTurn(new PlayerPoint({ x: 51, y: 10 }, Math.PI / 2, [0, 0], 1, 1));
    fakeOpponent.x = 51;
    fakeOpponent.y = 10;

    for (let i = 0; i < 5; i++) {
      state.update(i + 1, [fakeOpponent], gameArea, gameClock);
    }

    expect(state.x).toBeLessThan(51);
    expect(state.speedMult).toBeLessThan(1);
  });
});
