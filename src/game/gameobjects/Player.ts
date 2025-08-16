import { GameObjects, Physics, Scene } from "phaser";
import { pointToLineDistance } from "../utils";

export default class Player extends Phaser.Physics.Arcade.Image {


    PLAYER_COLOR: number = 0x00ff00;
    ROTATION_ANGLE: number = Math.PI / 2;
    BASE_SPEED: number = 150;
    HITBOX_RADIUS: number = 2;



    driverGraphics: GameObjects.Graphics;


    trailPoints: { x: number; y: number; }[] = [];


    maxTrailLength = 2000;
    trailWidth = 3;
    trailGraphics: GameObjects.Graphics;
    container: GameObjects.Container;
    direction: number;
    speed: number;


    constructor(scene: Phaser.Scene, x: number, y: number, direction: number) {
        super(scene, x, y, 'player');

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.direction = direction;
        this.setBounce(1);

        this.driverGraphics = scene.add.graphics();
        this.driverGraphics.fillStyle(this.PLAYER_COLOR);
        this.driverGraphics.fillTriangle(0, -7, -7, 7, 7, 7);
        this.driverGraphics.rotation = this.direction + Math.PI / 2;

        this.trailGraphics = scene.add.graphics();
        this.setVelocity(Math.cos(this.direction) * this.BASE_SPEED, Math.sin(this.direction) * this.BASE_SPEED);

    }

    update(delta: number) {
        super.update(delta);
        console.log(this.x, this.y);

        this.driverGraphics.x = this.x;
        this.driverGraphics.y = this.y;

        this.trailPoints.push({ x: this.x, y: this.y });

        if (this.trailPoints.length > this.maxTrailLength) {
            this.trailPoints.shift();
        }

        // Check trail collision
        this.checkTrailCollision(this.trailPoints);

        // Redraw trail
        this.drawTrail();
    }

    rotate(type: string) {
        if (type === "left") {
            this.direction = this.direction - this.ROTATION_ANGLE;
        }
        else if (type === "right") {
            this.direction = this.direction + this.ROTATION_ANGLE;
        }
        this.setVelocity(Math.cos(this.direction) * this.BASE_SPEED, Math.sin(this.direction) * this.BASE_SPEED);

        this.direction = (this.direction % (Math.PI * 2));
        this.driverGraphics.rotation = this.direction + Math.PI / 2;
    }


    checkTrailCollision(trailPoints: any) {
        // Only check collision with trail points that are far enough away
        // This prevents collision with the trail we just created
        const checkablePoints = trailPoints.length - 30;

        for (let i = 0; i < checkablePoints - 1; i++) {
            const point1 = trailPoints[i];
            const point2 = trailPoints[i + 1];

            // Check collision with line segment
            if (pointToLineDistance(this.x, this.y, point1.x, point1.y, point2.x, point2.y)
                < this.HITBOX_RADIUS + 3) {
                return;
            }
        }
    }

    drawTrail() {
        this.trailGraphics.clear();
        if (this.trailPoints.length > 1) {
            // Create gradient effect by drawing multiple lines with decreasing alpha
            const alpha = 0.5;

            this.trailGraphics.lineStyle(this.trailWidth, this.PLAYER_COLOR, alpha);
            this.trailGraphics.beginPath();
            this.trailGraphics.moveTo(this.trailPoints[0].x, this.trailPoints[0].y);

            for (let i = 1; i < this.trailPoints.length; i++) {
                this.trailGraphics.lineTo(this.trailPoints[i].x, this.trailPoints[i].y);
            }
            this.trailGraphics.strokePath();

        }
    }


}
