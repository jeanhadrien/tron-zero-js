import { GameObjects, Physics } from "phaser";

export class Player extends Phaser.GameObjects.Graphics {


    PLAYER_COLOR: number = 0x00ff00;
    direction: number;

    constructor(scene: Phaser.Scene, x: number, y: number, direction: number) {
        super(scene);
        this.fillStyle(this.PLAYER_COLOR);
        this.fillTriangle(0, -7, -7, 7, 7, 7);
        this.direction = direction;
        this.x = x;
        this.y = y;
        this.rotation = this.direction + Math.PI / 2;
        console.log("done");
    }

    update(...args: any[]): void {
        super.update(...args);
    }

    // Move player
    move(keyPressed: string, direction: string) {
        if (this.isKeyDown[keyPressed]) {
            return;
        }
        this.isKeyDown[keyPressed] = true;
        if (direction === "left") {
            this.direction = this.direction - this.MOVE_ANGLE;
        }
        else if (direction === "right") {
            this.direction = this.direction + this.MOVE_ANGLE;
        }
        this.direction = (this.direction % (Math.PI * 2));
        this.player.rotation = this.direction + Math.PI / 2;


    }

    addedToScene() {
        super.addedToScene();
        console.log("added")
        //  This Game Object has been added to a Scene
    }

    removedFromScene() {
        super.removedFromScene();
        console.log("removed")
        //  This Game Object has been removed from a Scene
    }

}
