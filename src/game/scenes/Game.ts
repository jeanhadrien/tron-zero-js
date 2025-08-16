import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { Player } from '../gameobjects/Player';

export class Game extends Scene {


    PLAYER_COLOR: number = 0x00ff00;
    CANVAS_WIDTH: number = 900
    CANVAS_HEIGHT: number = 600
    MOVE_ANGLE: number = Math.PI / 2;

    isKeyDown: Record<string, boolean>;
    gridGraphics: Phaser.GameObjects.Graphics;
    cursors: Phaser.Types.Input.Keyboard.CursorKeys;
    player: Player;
    trail: Phaser.GameObjects.Graphics;
    trailPoints: never[];
    maxTrailLength: number;
    trailWidth: number;
    playerRadius: number;
    trailRadius: number;
    safeDistance: number;
    isAlive: boolean;
    gameOverText: Phaser.GameObjects.Text;
    restartText: Phaser.GameObjects.Text;
    spaceKey: Phaser.Input.Keyboard.Key;

    constructor() {
        super('Game');
    }

    preload() {
        this.load.setPath('assets');
    }

    create() {
        this.gridGraphics = this.add.graphics();
        this.gridGraphics.lineStyle(1, 0x333333, 0.5); // Grey lines with 50% opacity

        const gridSize = 40; // Space between grid lines

        // Draw vertical lines
        for (let x = 0; x <= this.CANVAS_WIDTH; x += gridSize) {
            this.gridGraphics.moveTo(x, 0);
            this.gridGraphics.lineTo(x, this.CANVAS_HEIGHT);
        }

        // Draw horizontal lines
        for (let y = 0; y <= this.CANVAS_HEIGHT; y += gridSize) {
            this.gridGraphics.moveTo(0, y);
            this.gridGraphics.lineTo(this.CANVAS_WIDTH, y);
        }

        this.gridGraphics.strokePath();

        // Send grid to back so it appears behind other elements
        this.gridGraphics.setDepth(-1);

        // Controls/ Player
        this.cursors = this.input.keyboard.createCursorKeys();


        this.player = new Player(this, 400, 300, - Math.PI / 2);
        this.add.existing(this.player);


        // Trail graphics
        this.trail = this.add.graphics();
        this.trailPoints = [];
        this.maxTrailLength = 2000;
        this.trailWidth = 3;

        // Collision detection settings
        this.playerRadius = 2; // Collision radius for triangle
        this.trailRadius = this.trailWidth / 2; // Half of trail width
        this.safeDistance = 30; // Don't check collision for recent trail points

        // Game state
        this.isAlive = true;

        // Controls
        this.isKeyDown = {};

        // Game Over text (hidden initially)
        this.gameOverText = this.add.text(this.CANVAS_WIDTH / 2, this.CANVAS_HEIGHT / 2 - 30, 'GAME OVER', {
            fontSize: '48px',
            fill: '#ff0000',
            fontFamily: 'Arial'
        }).setOrigin(0.5).setVisible(false);

        this.restartText = this.add.text(this.CANVAS_WIDTH / 2, this.CANVAS_HEIGHT / 2 + 30, 'Press SPACE to restart', {
            fontSize: '24px',
            fill: '#ffffff',
            fontFamily: 'Courier New'
        }).setOrigin(0.5).setVisible(false);

        // Add space key for restart
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

        const leftKeys = ["Q", "S", "D", "LEFT"];
        const rightKeys = ["K", "L", "M", "RIGHT"];

        for (let i = 0; i < leftKeys.length; i++) {
            this.input.keyboard?.on(`keydown-${leftKeys[i]}`, () => {
                if (this.isKeyDown[leftKeys[i]]) {
                    return;
                }
                this.isKeyDown[leftKeys[i]] = true;
                this.player.rotate("left");
            });
            this.input.keyboard?.on(`keydown-${rightKeys[i]}`, () => {
                if (this.isKeyDown[rightKeys[i]]) {
                    return;
                }
                this.isKeyDown[rightKeys[i]] = true;
                this.player.rotate("right");
            });
            this.input.keyboard?.on(`keyup-${leftKeys[i]}`, () => this.isKeyDown[leftKeys[i]] = false);
            this.input.keyboard?.on(`keyup-${rightKeys[i]}`, () => this.isKeyDown[rightKeys[i]] = false);
        }

    }


    update(_time: any, delta: number) {
        if (!this.isAlive) {
            // Check for restart
            if (this.spaceKey.isDown) {
                this.restartGame();
            }
            return;
        }

        this.player.update(_time, delta);

        // Check boundary collision
        if (this.player.x < 0 || this.player.x > this.CANVAS_WIDTH ||
            this.player.y < 0 || this.player.y > this.CANVAS_HEIGHT) {
            this.gameOver();
            return;
        }


        // Update trail
        this.trailPoints.push({ x: this.player.x, y: this.player.y });

        if (this.trailPoints.length > this.maxTrailLength) {
            this.trailPoints.shift();
        }

        // Check trail collision
        this.checkTrailCollision();

        // Redraw trail
        this.drawTrail();
    }


    releaseKey(key: string) {
        this.isKeyDown[key] = false;
    }


    checkTrailCollision() {
        const playerX = this.player.x;
        const playerY = this.player.y;

        // Only check collision with trail points that are far enough away
        // This prevents collision with the trail we just created
        const checkablePoints = this.trailPoints.length - this.safeDistance;

        for (let i = 0; i < checkablePoints - 1; i++) {
            const point1 = this.trailPoints[i];
            const point2 = this.trailPoints[i + 1];

            // Check collision with line segment
            if (this.pointToLineDistance(playerX, playerY, point1.x, point1.y, point2.x, point2.y)
                < this.playerRadius + this.trailRadius) {
                this.gameOver();
                return;
            }
        }
    }

    // Calculate distance from a point to a line segment
    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) {
            // Line segment is actually a point
            return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
        }

        // Calculate the t parameter for the closest point on the line segment
        let t = ((px - x1) * dx + (py - y1) * dy) / (length * length);
        t = Math.max(0, Math.min(1, t)); // Clamp t to [0, 1]

        // Find the closest point on the line segment
        const closestX = x1 + t * dx;
        const closestY = y1 + t * dy;

        // Return distance from point to closest point on line segment
        return Math.sqrt((px - closestX) * (px - closestX) + (py - closestY) * (py - closestY));
    }

    drawTrail() {
        this.trail.clear();
        if (this.trailPoints.length > 1) {
            // Create gradient effect by drawing multiple lines with decreasing alpha
            const alpha = 0.5;

            this.trail.lineStyle(this.trailWidth, this.PLAYER_COLOR, alpha);
            this.trail.beginPath();
            this.trail.moveTo(this.trailPoints[0].x, this.trailPoints[0].y);

            for (let i = 1; i < this.trailPoints.length; i++) {
                this.trail.lineTo(this.trailPoints[i].x, this.trailPoints[i].y);
            }
            this.trail.strokePath();

        }
    }

    gameOver() {
        this.isAlive = false;
        this.gameOverText.setVisible(true);
        this.restartText.setVisible(true);

        // Optional: Add a death effect
        this.player.fillStyle(0xff0000); // Turn triangle red
    }

    restartGame() {
        // Reset all game state
        this.isAlive = true;
        this.player.x = 400;
        this.player.y = 500;
        this.direction = 0;
        this.player.rotation = this.direction + Math.PI / 2;
        this.trailPoints = [];
        this.trail.clear();


        // Hide game over text
        this.gameOverText.setVisible(false);
        this.restartText.setVisible(false);

        // Reset key states
        this.isKeyDown = {};
    }
}