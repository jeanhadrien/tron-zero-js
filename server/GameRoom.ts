import PlayerState from '../src/game/shared/PlayerState';
import BotController from '../src/game/shared/BotController';
import * as Phaser from 'phaser';

export default class GameRoom {
    players: Map<string, PlayerState> = new Map();
    bots: Map<string, BotController> = new Map();
    worldWidth = 4000;
    worldHeight = 4000;

    constructor() {
        // Initialize some bots
        for (let i = 0; i < 5; i++) {
            const botId = `bot_${i}`;
            const state = new PlayerState(
                Math.random() * this.worldWidth,
                Math.random() * this.worldHeight,
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
        const state = new PlayerState(
            Math.random() * this.worldWidth,
            Math.random() * this.worldHeight,
            Math.floor(Math.random() * 4) * (Math.PI / 2),
            Math.random() * 0xffffff
        );
        state.id = id;
        state.isRunning = true;
        this.players.set(id, state);
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
                // We only need to send the endpoints of the trail lines over the network to save bandwidth
                // But for now let's just send what client expects
                trailLines: player.trailLines.map(l => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 })),
                previousLineEnd: { x: player.previousLineEnd.x, y: player.previousLineEnd.y }
            };
        }
        return state;
    }

    handleTurn(id: string, direction: 'left' | 'right') {
        const player = this.players.get(id);
        if (player) {
            player.turn(direction);
        }
    }

    update(time: number, delta: number) {
        const allPlayers = Array.from(this.players.values());
        
        // Update bots
        for (const bot of this.bots.values()) {
            bot.update(time, delta, allPlayers, this.worldWidth, this.worldHeight);
        }

        // Gather all trails
        let allTrails: Phaser.Geom.Line[] = [];
        for (const p of allPlayers) {
            allTrails = allTrails.concat(p.trailLines);
        }

        // Update players
        for (const p of allPlayers) {
            if (p.isRunning) {
                // Get trails of *other* players
                const otherTrails = allTrails.filter(t => !p.trailLines.includes(t));
                p.update(time, delta, otherTrails, this.worldWidth, this.worldHeight);
                
                if (p.rubber <= 0) {
                    p.isRunning = false;
                    // Trigger death sequence if needed (we can broadcast player_died event later)
                }
            }
        }
    }
}
