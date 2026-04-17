import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'phaser';
import Player from '../gameobjects/Player';

const mockSys = { queueDepthSort: vi.fn(), displayList: { add: vi.fn() }, updateList: { add: vi.fn() }, events: { emit: vi.fn(), once: vi.fn(), on: vi.fn(), off: vi.fn() }, textures: { get: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({}) }) } };
const mockScene = { sys: mockSys, cameras: { main: { width: 800, height: 600 } }, add: { existing: vi.fn(), graphics: vi.fn().mockReturnValue({ fillStyle: vi.fn(), fillTriangle: vi.fn(), clear: vi.fn(), lineStyle: vi.fn(), strokeLineShape: vi.fn(), setDepth: vi.fn(), rotation: 0, x: 0, y: 0 }) } } as unknown as Phaser.Scene;

describe('Player Collision', () => {
    let player: Player;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(Player.prototype, 'setVisible').mockImplementation(function() { return this as any; });

        player = new Player(mockScene, 0, 0, 0xff0000);
        player.isRunning = true;
    });

    it('should not pass through walls at high speeds', () => {
        // Create a wall in front of the player
        // Player is at (0, 0), moving right (direction = 0)
        player.direction = 0;
        player.x = 0;
        player.y = 0;
        
        // Let's set a very high speed
        player.speed = 10;
        player.targetSpeed = 10;
        player._setSpeed(10);
        
        // Add a trail line (wall) at x = 21
        const wall = new Phaser.Geom.Line(21, -10, 21, 10);
        player.trailLines = [wall];
        
        // Simulate a frame (delta = 16.6ms)
        const delta = 16.666;
        
        // Update
        player.update(0, delta);
        
        // We expect the player to detect the wall and NOT increase speed,
        // but rather decrease it because it is stuck or will be stuck.
        // Wait, right now it won't detect it because DETECTION_LINE_LENGTH = 20.
        // Let's see what happens. If it fails to detect, it maintains high speed.
        
        // Second frame update
        player.update(0 + delta, delta);
        
        // If collision works, speed should drop significantly compared to targetSpeed (10)
        expect(player.speed).toBeLessThan(2);
        
        // Simulate a few more frames to show it approaches 0 and never passes the wall
        for (let i = 0; i < 10; i++) {
            player.update(0 + delta * (i + 2), delta);
        }
        
        expect(player.x).toBeLessThan(21);
        expect(player.speed).toBeLessThan(0.3);
    });
});
