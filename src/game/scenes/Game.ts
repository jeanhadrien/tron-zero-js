import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { Player } from '../gameobjects/Player';

export class Game extends Scene {
    cursors: any;
    playerSpeed: any;
    velocity: any;
    player: Phaser.GameObjects.Graphics
    gridGraphics: Phaser.GameObjects.Graphics;
    trail: Phaser.GameObjects.Graphics;
    trailPoints: never[];
    maxTrailLength: number;
    trailWidth: number;
    playerRadius: number;
    trailRadius: number;
    safeDistance: number;
    isAlive: boolean;
    direction: number;
    directions: { x: number; y: number; angle: number; }[];
    lastKeyPressed: {};
    gameOverText: Phaser.GameObjects.Text;
    restartText: Phaser.GameObjects.Text;
    spaceKey: Phaser.Input.Keyboard.Key;

    PLAYER_COLOR: number = 0x00ff00;
    CANVAS_WIDTH: number = 900
    CANVAS_HEIGHT: number = 600

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


        // Trail graphics
        this.trail = this.add.graphics();
        this.trailPoints = [];
        this.maxTrailLength = 2000;
        this.trailWidth = 3;

        // Triangle setup
        this.player = this.add.graphics();
        this.player.fillStyle(this.PLAYER_COLOR);
        this.player.fillTriangle(0, -7, -7, 7, 7, 7);
        this.player.x = 400;
        this.player.y = 300;

        // Collision detection settings
        this.playerRadius = 2; // Collision radius for triangle
        this.trailRadius = this.trailWidth / 2; // Half of trail width
        this.safeDistance = 30; // Don't check collision for recent trail points

        // Game state
        this.isAlive = true;

        // Controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.controls = this.input.keyboard?.add
        this.playerSpeed = 150;
        this.direction = 0;
        this.directions = [
            { x: 0, y: -1, angle: 0 },      // Up
            { x: 1, y: 0, angle: Math.PI / 2 },   // Right
            { x: 0, y: 1, angle: Math.PI },       // Down
            { x: -1, y: 0, angle: -Math.PI / 2 }  // Left
        ];
        this.player.rotation = this.directions[this.direction].angle;
        this.lastKeyPressed = {};

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

        // Add callbacks to pressed keys for movement 
        // Use QSD for left and KLM for right
        this.input.keyboard?.on('keydown_Q', this.moveLeft, this);
        this.input.keyboard?.on('keydown_S', this.moveLeft, this);
        this.input.keyboard?.on('keydown_D', this.moveLeft, this);
        this.input.keyboard?.on('keydown_K', this.moveRight, this);
        this.input.keyboard?.on('keydown_L', this.moveRight, this);
        this.input.keyboard?.on('keydown_M', this.moveRight, this);

        // Also add callbacks for arrow keys
        this.input.keyboard?.on('keydown_LEFT', this.moveLeft, this);
        this.input.keyboard?.on('keydown_RIGHT', this.moveRight, this);

    }

    moveLeft() {
        this.direction = (this.direction + 3) % 4;
        this.player.rotation = this.directions[this.direction].angle;
    }

    moveRight() {
    }

    update(time, delta) {
        if (!this.isAlive) {
            // Check for restart
            if (this.spaceKey.isDown) {
                this.restartGame();
            }
            return;
        }

        // Handle turning
        if (this.cursors.left.isDown && !this.lastKeyPressed.left) {
            this.direction = (this.direction + 3) % 4;
            this.player.rotation = this.directions[this.direction].angle;
        }
        if (this.cursors.right.isDown && !this.lastKeyPressed.right) {
            this.direction = (this.direction + 1) % 4;
            this.player.rotation = this.directions[this.direction].angle;
        }
        this.lastKeyPressed.left = this.cursors.left.isDown;
        this.lastKeyPressed.right = this.cursors.right.isDown;

        // Move player
        const currentDir = this.directions[this.direction];
        this.player.x += currentDir.x * this.playerSpeed * (delta / 1000);
        this.player.y += currentDir.y * this.playerSpeed * (delta / 1000);

        // Check boundary collision
        if (this.player.x < 0 || this.player.x > 800 ||
            this.player.y < 0 || this.player.y > 600) {
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
        this.player.rotation = this.directions[this.direction].angle;
        this.trailPoints = [];
        this.trail.clear();


        // Hide game over text
        this.gameOverText.setVisible(false);
        this.restartText.setVisible(false);

        // Reset key states
        this.lastKeyPressed = {};
    }
}