import { describe, it, expect, beforeEach } from 'vitest';
import 'phaser';
import PlayerState from '../shared/PlayerState';

describe('Player Long Sensor Issues', () => {
    let state: PlayerState;

    beforeEach(() => {
        state = new PlayerState(1000, 1000, 0, 0xff0000);
        state.isRunning = true;
    });

    it('closest point logic fails when intersection is further than the 999,999 default point', () => {
        state.DETECTION_LINE_LENGTH = 2000;
        state.direction = 0; // facing right
        state.speed = 1;
        state._setSpeed(1);
        state._updateDetectionLines();
        
        const wall = new Phaser.Geom.Line(1100, 900, 1100, 1100);
        state.trailLines = [wall];
        
        const closest = state.getClosestIntersectingPoint(state.detectionLine, state.trailLines);
        
        expect(closest.x).toBe(1100);
    });
});
