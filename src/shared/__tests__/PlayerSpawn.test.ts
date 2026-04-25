import { describe, it, expect, beforeEach } from 'vitest';
import 'phaser';
import PlayerState from '../PlayerState';
import { PlayerPoint } from '../PlayerPoint';
import { PlayerEventBus } from '../PlayerStateEventBus';
import PlayerTrailDTO from '../PlayerTrailDTO';

describe('Player Spawn and Load', () => {
  it('should have a populated trail after load', () => {
    const bus = new PlayerEventBus();
    const serverPlayer = new PlayerState(bus, 100, 50, 50, 0, 0xffffff);
    serverPlayer.id = 'test-id';
    serverPlayer.isRunning = true;
    
    // Server spawns player
    serverPlayer.spawn(100, 100, Math.PI / 2, 16);
    
    // Server serializes state
    const pStateDTO = serverPlayer.serialize();
    
    // Client receives it and loads
    const clientPlayer = new PlayerState(bus, 100, 0, 0, 0, 0xffffff);
    clientPlayer.load(pStateDTO);
    
    // Check if client player's trail is populated
    console.log('Client player points length:', clientPlayer.trail.getPoints().length);
    
    // Now simulate player_turn
    const turnPoint = new PlayerPoint(new Phaser.Math.Vector2(100, 150), Math.PI, [0, 100], 1, 101);
    
    // This should not warn if trail is non-empty
    clientPlayer.trail.fillTurn(turnPoint);
    
    expect(clientPlayer.trail.getPoints().length).toBeGreaterThan(0);
  });
});
