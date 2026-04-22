import PlayerState from './PlayerState';
import { GameEventBus } from "./GameEventBus";
import GameClock from './GameClock';
import GameArea from './GameArea';

export default class GameRoom {
    players: Map<string, PlayerState>;
    area: GameArea;
    bus: GameEventBus;
    clock: GameClock;

    constructor(bus: GameEventBus, area: GameArea, clock: GameClock) {
        this.bus = bus;
        this.area = area;
        this.clock = clock;
        this.players = new Map();
    }

    getPlayer(id: string): PlayerState {
        const p = this.players.get(id);
        if (!p) throw new Error("Player not found");
        return p;
    }

    getAllPlayers(): PlayerState[] {
        return Array.from(this.players.values());
    }

    addPlayer(player: PlayerState): PlayerState {
        this.players.set(player.id, player);
        console.debug("Added player", player.id, player);
        return player
    }

    removePlayerById(id: string) {
        let p = this.players.get(id);
        if (p) {
            //p.destroy();
            this.players.delete(id);
            console.debug("Removed player", id, p);
            return;
        }
        throw new Error(`Trying to remove player ${id} that doesn't exist`)

    }


    /**
     * Gathers all trail lines from all players except the one specified.
     * Useful for physics prediction and collision detection.
     */
    getOtherTrails(excludePlayerId: string): Phaser.Geom.Line[] {
        let otherTrails: Phaser.Geom.Line[] = [];

        for (const [id, p] of this.players) {
            if (id !== excludePlayerId) {
                // Add all finalized trail lines
                otherTrails = otherTrails.concat(p.trailLines);

                // If the player is currently running, their current line segment is also a collidable trail
                if (p.isRunning) {
                    otherTrails.push(p.currentLine);
                }
            }
        }

        return otherTrails;
    }


}