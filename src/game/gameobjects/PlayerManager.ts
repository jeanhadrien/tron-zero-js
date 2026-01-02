import { EventBus } from "../EventBus";
import Player from "./Player";


export default class PlayerManager {
    scene: Phaser.Scene;
    players: Array<Player> = [];

    constructor(scene: Phaser.Scene){
        this.scene = scene;
    }

    addPlayer(x: number, y: number, color: number){
        let p = new Player(this.scene, x, y, color);
        p._updateDirection(-Math.PI / 2);
        p.isRunning = true;
        p.setCollideWorldBounds(true);
        this.players.push(p);
        return p;
    }

    update(delta: number){
        for (const player of this.players) {
            player.update(delta);
        }
    }
}