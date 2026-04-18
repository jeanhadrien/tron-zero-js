import PlayerState from '../shared/PlayerState';
import BotController from '../shared/BotController';
import * as Phaser from 'phaser';

export default class GameRoom {
    players: Map<string, PlayerState> = new Map();
    bots: Map<string, BotController> = new Map();
    worldWidth = 2000;
    worldHeight = 2000;

    constructor() {
        // Initialize some bots
        for (let i = 0; i < 5; i++) {
            const botId = `bot_${i}`;
            const startX = 100 + Math.random() * (this.worldWidth - 200);
            const startY = 100 + Math.random() * (this.worldHeight - 200);
            const state = new PlayerState(
                startX,
                startY,
                Math.floor(Math.random() * 4) * (Math.PI / 2),
                Math.random() * 0xffffff
            );
            state.id = botId;
            state.isRunning = true;
            this.players.set(botId, state);
            const botController = new BotController(state);
            this.bots.set(botId, botController);
        }
    }

    addPlayer(id: string) {
        // Start away from walls by padding by 100
        const startX = 100 + Math.random() * (this.worldWidth - 200);
        const startY = 100 + Math.random() * (this.worldHeight - 200);

        const state = new PlayerState(
            startX,
            startY,
            Math.floor(Math.random() * 4) * (Math.PI / 2),
            Math.random() * 0xffffff
        );
        state.id = id;
        state.isRunning = true;
        this.players.set(id, state);
    }

    respawnPlayer(id: string) {
        const player = this.players.get(id);
        if (player) {
            const startX = 100 + Math.random() * (this.worldWidth - 200);
            const startY = 100 + Math.random() * (this.worldHeight - 200);
            player.reset(startX, startY, Math.floor(Math.random() * 4) * (Math.PI / 2));
            player.isRunning = true;
        }
    }

    removePlayer(id: string) {
        this.players.delete(id);
    }

    getPlayerState(id: string) {
        return this.players.get(id);
    }

    getState() {
        const state: any = {};
        for (const [id, player] of this.players.entries()) {
            state[id] = {
                id: player.id,
                x: player.x,
                y: player.y,
                direction: player.direction,
                rubber: player.rubber,
                isRunning: player.isRunning,
                color: player.color,
                speed: player.speed,
                targetSpeed: player.targetSpeed,
                velocity: player.velocity,
                lastProcessedInput: player.lastProcessedInput,
                // We only need to send the endpoints of the trail lines over the network to save bandwidth
                // But for now let's just send what client expects
                trailLines: player.trailLines.map(l => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 })),
                previousLineEnd: { x: player.previousLineEnd.x, y: player.previousLineEnd.y }
            };
        }
        return state;
    }

    handleTurn(id: string, direction: 'left' | 'right', sequenceNumber?: number) {
        const player = this.players.get(id);
        if (player) {
            player.turn(direction, sequenceNumber);
            if (sequenceNumber !== undefined) {
                player.lastProcessedInput = sequenceNumber;
            }
        }
    }

    update(time: number, delta: number, currentTick: number) {
        const allPlayers = Array.from(this.players.values());
        
        // Update bots
        for (const bot of this.bots.values()) {
            bot.update(time, delta, allPlayers, this.worldWidth, this.worldHeight, currentTick);
        }

        // Update players
        for (const p of allPlayers) {
            if (p.isRunning) {
                // Get trails of *other* players
                let otherTrails: Phaser.Geom.Line[] = [];
                for (const other of allPlayers) {
                    if (other !== p) {
                        otherTrails = otherTrails.concat(other.trailLines);
                        if (other.isRunning) {
                            otherTrails.push(other.currentLine);
                        }
                    }
                }
                
                p.update(time, delta, otherTrails, this.worldWidth, this.worldHeight, currentTick);
                
                if (p.rubber <= 0) { console.log(`Player ${p.id} died! Rubber: ${p.rubber}, x: ${p.x}, y: ${p.y}`); 
                    p.isRunning = false;
                    // Clear the trails completely when a player dies
                    p.trailLines = [];
                    p.currentLine.setTo(p.x, p.y, p.x, p.y);
                    p.previousLineEnd.set(p.x, p.y);

                    if (this.bots.has(p.id)) {
                        this.respawnPlayer(p.id);
                        this.bots.set(p.id, new BotController(p));
                    }
                }
            }
        }
    }
}
