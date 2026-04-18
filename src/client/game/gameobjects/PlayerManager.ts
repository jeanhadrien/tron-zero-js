import Player from "./Player";
import PlayerState from '../../../shared/PlayerState';

export default class PlayerManager {
    scene: Phaser.Scene;
    players: Map<string, Player> = new Map();

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    addPlayer(state: PlayerState) {
        let p = new Player(this.scene, state);
        this.players.set(state.id, p);
        return p;
    }

    removePlayer(id: string) {
        let p = this.players.get(id);
        if (p) {
            p.destroy();
            this.players.delete(id);
        }
    }

    update(time: number, delta: number) {
        for (const player of this.players.values()) {
            player.update(time, delta);
        }
    }
}