import { describe, it, expect, beforeEach } from 'vitest';
import 'phaser'; 
import PlayerState from '../gameobjects/PlayerState';

describe('Player Logic', () => {
    let state: PlayerState;

    beforeEach(() => {
        state = new PlayerState(100, 100, 0, 0x00ff00);
        state.isRunning = true;
    });

    it('zig zag should not crash', () => {
        state.speed = 1;
        state._setSpeed(state.speed);

        const dt = 16;
        let time = 0;

        const updateFrame = () => {
            state.update(time, dt, [], 1000, 1000);
            time += dt;
        };

        state.turn('right');
        state.turn('right');
        updateFrame();

        state.turn('left');
        state.turn('left');
        updateFrame();
        
        expect(state.speed).toBeGreaterThan(0.9);
    });

    it('updates velocity immediately on turn to prevent diagonal movement', () => {
        // Set initial direction to 0 (right)
        state.direction = 0;
        state.speed = 1;
        state._setSpeed(state.speed);

        // Velocity should be [BASE_SPEED, 0]
        expect(state.velocity[0]).toBeCloseTo(state.BASE_SPEED, 4);
        expect(state.velocity[1]).toBeCloseTo(0, 4);

        // Turn right (down)
        state.turn('right');
        state.update(100, 16, [], 1000, 1000);

        // Velocity should immediately be updated to [0, BASE_SPEED]
        expect(state.velocity[0]).toBeCloseTo(0, 4);
        expect(state.velocity[1]).toBeCloseTo(state.BASE_SPEED, 4);
    });
});
