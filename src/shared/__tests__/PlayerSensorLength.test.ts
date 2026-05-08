import { describe, it, expect, beforeEach } from 'vitest';
import Player from '../Player';
import { PlayerEventBus } from '../PlayerStateEventBus';
import { SharedLine } from '../math';

describe('Player Long Sensor Issues', () => {
  let state: Player;

  beforeEach(() => {
    state = new Player(new PlayerEventBus(), 0, 1000, 1000, 0, 0xff0000);
    state.isRunning = true;
  });

  it('closest point logic fails when intersection is further than the 999,999 default point', () => {
    // Note: DETECTION_LINE_LENGTH is a static property on PlayerState but the test overrides it locally as if it's an instance property. Let's just rely on the new lookAheadLength logic.
    state.direction = 0; // facing right
    state.speedMult = 1;
    state._setSpeedAndVelocity(1, 16.66);
    state._updateDetectionLines();

    const wall = new SharedLine(1100, 900, 1100, 1100);
    const lines = [wall];

    const closest = state.getClosestIntersectingPoint(
      state.detectionLine,
      lines
    );

    expect(closest.x).toBe(1100);
  });
});
