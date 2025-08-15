import { GameObjects, Physics } from "phaser";

export class Player extends Physics.Arcade.Image {

    constructor({ scene }) {
        super(scene, -190, 100, "player");
        this.scene = scene;
        this.scene.add.existing(this);

        var circle = new Phaser.Geom.Circle(10, 10, 10);


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
