import { GameObjects, Physics } from "phaser";

export class Player extends Phaser.GameObjects.Graphics {


    PLAYER_COLOR: number = 0x00ff00;
    direction: number;
    MOVE_ANGLE: number = Math.PI / 2;

    speed: number = 150;

    constructor(scene: Phaser.Scene, x: number, y: number, direction: number) {
        super(scene);
        this.direction = direction;
        this.x = x;
        this.y = y;
        this.fillStyle(this.PLAYER_COLOR);
        this.fillTriangle(0, -7, -7, 7, 7, 7);
        this.rotation = this.direction + Math.PI / 2;
    }

    update(time: any, delta: number): void {
        super.update(time, delta);
        this.x += Math.cos(this.direction) * this.speed * (delta / 1000);
        this.y += Math.sin(this.direction) * this.speed * (delta / 1000);
    }

    rotate(direction: string) {
        if (direction === "left") {
            this.direction = this.direction - this.MOVE_ANGLE;
        }
        else if (direction === "right") {
            this.direction = this.direction + this.MOVE_ANGLE;
        }
        this.direction = (this.direction % (Math.PI * 2));
        this.rotation = this.direction + Math.PI / 2;
    }

    addedToScene() {
        super.addedToScene();
        console.log("added")
    }

    removedFromScene() {
        super.removedFromScene();
        console.log("removed")
    }

}
