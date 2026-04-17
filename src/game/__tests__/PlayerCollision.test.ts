import { describe, it, expect, beforeEach } from 'vitest';
import 'phaser';
import PlayerState from '../gameobjects/PlayerState';

describe('Player Collision', () => {
    let state: PlayerState;

    beforeEach(() => {
        state = new PlayerState(0, 0, 0, 0xff0000);
        state.isRunning = true;
    });

    it('should not pass through walls at high speeds', () => {
        state.direction = 0;
        state.x = 0;
        state.y = 0;
        
        state.speed = 10;
        state.targetSpeed = 10;
        state._setSpeed(10);
        
        const wall = new Phaser.Geom.Line(21, -10, 21, 10);
        state.trailLines = [wall];
        
        const delta = 16.666;
        
        state.update(0, delta, [], 1000, 1000);
        state.update(0 + delta, delta, [], 1000, 1000);
        
        expect(state.speed).toBeLessThan(2);
        
        for (let i = 0; i < 10; i++) {
            state.update(0 + delta * (i + 2), delta, [], 1000, 1000);
        }
        
        expect(state.x).toBeLessThan(21);
        expect(state.speed).toBeLessThan(0.3);
    });
});
