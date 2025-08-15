import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { Player } from '../gameobjects/Player';

export class Game extends Scene {
    cursors: any;
    playerSpeed: any;
    velocity: any;
    player: any;
    constructor() {
        super('Game');
    }

    preload() {
        this.load.setPath('assets');

        this.load.image('star', 'star.png');
        this.load.image('background', 'bg.png');
        this.load.image('logo', 'logo.png');
    }

    create() {
        // Triangle setup
        this.player = this.add.graphics();
        this.player.fillStyle(0x00ff00);
        this.player.fillTriangle(0, -15, -12, 15, 12, 15);
        this.player.x = 400;
        this.player.y = 300;

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
        this.cursors = this.input.keyboard.createCursorKeys();
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
        this.gameOverText = this.add.text(400, 250, 'GAME OVER', {
            fontSize: '48px',
            fill: '#ff0000',
            fontFamily: 'Arial'
        }).setOrigin(0.5).setVisible(false);

        this.restartText = this.add.text(400, 320, 'Press SPACE to restart', {
            fontSize: '24px',
            fill: '#ffffff',
            fontFamily: 'Arial'
        }).setOrigin(0.5).setVisible(false);

        // Add space key for restart
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
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
            for (let pass = 0; pass < 3; pass++) {
                const alpha = (3 - pass) * 0.3;
                const width = this.trailWidth + pass * 2;

                this.trail.lineStyle(width, 0xffffff, alpha);
                this.trail.beginPath();
                this.trail.moveTo(this.trailPoints[0].x, this.trailPoints[0].y);

                for (let i = 1; i < this.trailPoints.length; i++) {
                    this.trail.lineTo(this.trailPoints[i].x, this.trailPoints[i].y);
                }
                this.trail.strokePath();
            }
        }
    }

    gameOver() {
        this.isAlive = false;
        this.gameOverText.setVisible(true);
        this.restartText.setVisible(true);

        // Optional: Add a death effect
        this.player.fillStyle(0xff0000); // Turn triangle red
        this.player.clear();
        this.player.fillTriangle(0, -15, -12, 15, 12, 15);
    }

    restartGame() {
        // Reset all game state
        this.isAlive = true;
        this.player.x = 400;
        this.player.y = 300;
        this.direction = 0;
        this.player.rotation = this.directions[this.direction].angle;
        this.trailPoints = [];
        this.trail.clear();

        // Reset player color
        this.player.clear();
        this.player.fillStyle(0x00ff00);
        this.player.fillTriangle(0, -15, -12, 15, 12, 15);

        // Hide game over text
        this.gameOverText.setVisible(false);
        this.restartText.setVisible(false);

        // Reset key states
        this.lastKeyPressed = {};
    }
}
