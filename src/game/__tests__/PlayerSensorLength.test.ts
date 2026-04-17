import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'phaser';
import Player from '../gameobjects/Player';

const mockSys = { queueDepthSort: vi.fn(), displayList: { add: vi.fn() }, updateList: { add: vi.fn() }, events: { emit: vi.fn(), once: vi.fn(), on: vi.fn(), off: vi.fn() }, textures: { get: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({}) }) } };
const mockScene = { sys: mockSys, add: { existing: vi.fn(), graphics: vi.fn().mockReturnValue({ fillStyle: vi.fn(), fillTriangle: vi.fn(), clear: vi.fn(), lineStyle: vi.fn(), strokeLineShape: vi.fn(), rotation: 0, x: 0, y: 0 }) }, physics: { add: { existing: vi.fn() } } } as unknown as Phaser.Scene;

describe('Player Long Sensor Issues', () => {
    let player: Player;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(Player.prototype, 'setBodySize').mockImplementation(function() { return this as any; });
        vi.spyOn(Player.prototype, 'setVelocity').mockImplementation(function(x, y) { (this as any).velocity = [x, y]; return this as any; });

        // Place player near (999, 999) to trigger the bug
        player = new Player(mockScene, 1000, 1000, 0xff0000);
        player.isRunning = true;
    });

    it('closest point logic fails when intersection is further than the 999,999 default point', () => {
        // We set the detection line length to something long
        player.DETECTION_LINE_LENGTH = 2000;
        player.direction = 0; // facing right
        player.speed = 1;
        player._setSpeed(1);
        player._updateDetectionLines();
        
        // Place a wall 100 units away
        const wall = new Phaser.Geom.Line(1100, 900, 1100, 1100);
        player.trailLines = [wall];
        
        // Find closest intersection
        const closest = player._getClosestIntersectingPoint(player.detectionLine, player.trailLines);
        
        // It SHOULD be (1100, 1000). But due to the 999,999 bug, it will return 999, 999
        // because distance from (1000,1000) to (1100,1000) is 100
        // distance from (1000,1000) to (999,999) is ~1.414
        
        expect(closest.x).toBe(1100); // This will fail!
    });
});
