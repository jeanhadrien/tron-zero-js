import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'phaser'; 
import Player from '../gameobjects/Player';

const mockSys = { queueDepthSort: vi.fn(), displayList: { add: vi.fn() }, updateList: { add: vi.fn() }, events: { emit: vi.fn(), once: vi.fn(), on: vi.fn(), off: vi.fn() }, textures: { get: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({}) }) } };
const mockScene = { sys: mockSys, add: { existing: vi.fn(), graphics: vi.fn().mockReturnValue({ fillStyle: vi.fn(), fillTriangle: vi.fn(), clear: vi.fn(), lineStyle: vi.fn(), strokeLineShape: vi.fn(), rotation: 0, x: 0, y: 0 }) }, physics: { add: { existing: vi.fn() } } } as unknown as Phaser.Scene;

describe('Player Logic', () => {
    let player: Player;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(Player.prototype, 'setBodySize').mockImplementation(function() { return this as any; });
        vi.spyOn(Player.prototype, 'setVelocity').mockImplementation(function(x, y) { (this as any).velocity = [x, y]; return this as any; });

        player = new Player(mockScene, 100, 100, 0x00ff00);
        player.isRunning = true;
    });

    it('zig zag should not crash', () => {
        player.speed = 1;
        player._setSpeed(player.speed);

        const dt = 16;
        let time = 0;

        const updateFrame = () => {
            player.x += player.velocity[0] * (dt / 1000);
            player.y += player.velocity[1] * (dt / 1000);
            player.update(time, dt);
            time += dt;
        };

        player.turn('right');
        player.turn('right');
        updateFrame();

        player.turn('left');
        player.turn('left');
        updateFrame();
        
        expect(player.speed).toBeGreaterThan(0.9);
    });

    it('updates velocity immediately on turn to prevent diagonal movement', () => {
        // Set initial direction to 0 (right)
        player.direction = 0;
        player.speed = 1;
        player._setSpeed(player.speed);

        // Velocity should be [BASE_SPEED, 0]
        expect(player.velocity[0]).toBeCloseTo(player.BASE_SPEED, 4);
        expect(player.velocity[1]).toBeCloseTo(0, 4);

        // Turn right (down)
        player.turn('right');

        // Velocity should immediately be updated to [0, BASE_SPEED]
        // This ensures the physics engine won't move the player diagonally in the current frame
        expect(player.velocity[0]).toBeCloseTo(0, 4);
        expect(player.velocity[1]).toBeCloseTo(player.BASE_SPEED, 4);
    });
});
