import { EventBus } from "../EventBus";
import Player from "./Player";


export default class PlayerManager {
    scene: Phaser.Scene;
    players: Array<Player> = [];

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    addPlayer(x: number, y: number, color: number) {
        let p = new Player(this.scene, x, y, color);
        p._updateDirection(-Math.PI / 2);
        p._setSpeed(1);
        p.isRunning = true;
        p.setCollideWorldBounds(true);
        this.players.push(p);
        return p;
    }

    update(time: number, delta: number) {
        for (const player of this.players) {
            player.update(time, delta);
        }
    }
}