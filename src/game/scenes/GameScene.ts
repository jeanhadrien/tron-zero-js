import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import Player from '../gameobjects/Player';
import PlayerManager from '../gameobjects/PlayerManager';
import DebugHud from '../gameobjects/DebugHud';

export class GameScene extends Scene {
    CANVAS_WIDTH: number = 900;
    CANVAS_HEIGHT: number = 600;

    isKeyDown: Record<string, boolean>;
    gridGraphics: Phaser.GameObjects.Graphics;
    humanPlayer: Player;
    safeDistance: number;
    isAlive: boolean;
    gameOverText: Phaser.GameObjects.Text;
    restartText: Phaser.GameObjects.Text;
    spaceKey: Phaser.Input.Keyboard.Key;
    aiPlayer: Player;

    playerManager: PlayerManager;
    debugHud: DebugHud;

    constructor() {
        super('Game');
    }

    init() {
        this.playerManager = new PlayerManager(this);
        this.debugHud = new DebugHud(this);
    }

    preload() {
        this.load.setPath('assets');
    }

    create() {
        this.drawGridOnce();

        let bounds = this.physics.world.setBounds(
            0,
            0,
            this.CANVAS_WIDTH,
            this.CANVAS_HEIGHT
        );

        this.physics.world.setBoundsCollision();

        this.humanPlayer = this.playerManager.addPlayer(this.CANVAS_WIDTH * (1 / 3), this.CANVAS_HEIGHT / 2, 0x00ff00);
        this.aiPlayer = this.playerManager.addPlayer(this.CANVAS_WIDTH * (2 / 3), this.CANVAS_HEIGHT / 2, 0xff0000);

        this.debugHud.add("Rubber", this.humanPlayer, "rubber");
        this.debugHud.add("Speed", this.humanPlayer, "velocity");

        //this.debugHud.initialize();

        // add collision box
        // let v = this.physics.add.staticBody(200, 200, 300, 30);
        // this.physics.add.collider(this.humanPlayer, v, () => {
        //   this.humanPlayer.persistTrail();
        // });

        // Game state
        this.isAlive = true;

        // Controls
        this.isKeyDown = {};

        // Game Over text (hidden initially)
        this.gameOverText = this.add
            .text(this.CANVAS_WIDTH / 2, this.CANVAS_HEIGHT / 2 - 30, 'GAME OVER', {
                fontSize: '48px',
                fill: '#ff0000',
                fontFamily: 'Arial',
            })
            .setOrigin(0.5)
            .setVisible(false);

        this.restartText = this.add
            .text(
                this.CANVAS_WIDTH / 2,
                this.CANVAS_HEIGHT / 2 + 30,
                'Press SPACE to restart',
                {
                    fontSize: '24px',
                    fill: '#ffffff',
                    fontFamily: 'Courier New',
                }
            )
            .setOrigin(0.5)
            .setVisible(false);

        EventBus.on("game-over", () => {
            this.humanPlayer.isRunning = false;
            this.isAlive = false;
            this.gameOverText.setVisible(true);
            this.restartText.setVisible(true);
        });

        EventBus.on("game-start", () => {
            // Reset all game state
            this.humanPlayer.isRunning = true;
            this.isAlive = true;
            this.humanPlayer.x = 400;
            this.humanPlayer.y = 500;
            this.humanPlayer.direction = 0;
            this.humanPlayer.driverGraphics.rotation = this.humanPlayer.direction + Math.PI / 2;
            this.humanPlayer.trailGraphics.clear();
            this.humanPlayer.trailLines = [];

            // Hide game over text
            this.gameOverText.setVisible(false);
            this.restartText.setVisible(false);

            // Reset key states
            this.isKeyDown = {};
        });


        // Add space key for restart
        this.spaceKey = this.input.keyboard.addKey(
            Phaser.Input.Keyboard.KeyCodes.SPACE
        );

        const keyMappings = {
            Q: 'left',
            S: 'left',
            D: 'left',
            LEFT: 'left',
            K: 'right',
            L: 'right',
            M: 'right',
            RIGHT: 'right',
        };

        // Bind key down events to controls
        Object.entries(keyMappings).forEach(([key, direction]) => {
            this.input.keyboard?.on(`keydown-${key}`, () => {
                if (!this.isKeyDown[key]) {
                    this.isKeyDown[key] = true;
                    this.humanPlayer.turn(direction);
                    //EventBus.emit("human.move", direction);
                }
            });
            this.input.keyboard?.on(`keyup-${key}`, () => {
                this.isKeyDown[key] = false;
            });
        });
    }

    update(_time: any, delta: number) {
        if (!this.isAlive) {
            // Check for restart
            if (this.spaceKey.isDown) {
                EventBus.emit("game-start");
            }
            return;
        }

        //const renderFps = Math.round(this.game.loop.actualFps);
        //console.log(renderFps);
        this.playerManager.update(_time, delta);
        this.debugHud.update(delta);

        // Check boundary collision
        if (
            this.humanPlayer.x < 0 ||
            this.humanPlayer.x > this.CANVAS_WIDTH ||
            this.humanPlayer.y < 0 ||
            this.humanPlayer.y > this.CANVAS_HEIGHT
        ) {
            EventBus.emit("game-over");

        }
        if (this.humanPlayer.rubber <= 0) {
            EventBus.emit("game-over");
        }

    }

    releaseKey(key: string) {
        this.isKeyDown[key] = false;
    }

    drawGridOnce() {
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
    }


}
