import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import Player from '../gameobjects/Player';
import PlayerManager from '../gameobjects/PlayerManager';
import DebugHud from '../gameobjects/DebugHud';
import BotController from '../controllers/BotController';

export class GameScene extends Scene {
    CANVAS_WIDTH: number;
    CANVAS_HEIGHT: number;
    WORLD_WIDTH: number = 1000;
    WORLD_HEIGHT: number = 1000;
    PLAYER_VIEW_WIDTH: number = 800;
    isCameraFollowing: boolean = true;

    isKeyDown: Record<string, boolean>;
    gridGraphics: Phaser.GameObjects.Graphics;
    humanPlayer: Player;
    safeDistance: number;
    isAlive: boolean;
    gameOverText: Phaser.GameObjects.Text;
    restartText: Phaser.GameObjects.Text;
    spaceKey: Phaser.Input.Keyboard.Key;
    aiPlayers: Player[] = [];
    aiControllers: BotController[] = [];
    NUM_BOTS: number = 5;

    playerManager: PlayerManager;
    debugHud: DebugHud;

    constructor() {
        super('Game');
    }

    init() {
        this.CANVAS_WIDTH = this.scale.width;
        this.CANVAS_HEIGHT = this.scale.height;
        this.playerManager = new PlayerManager(this);
        this.debugHud = new DebugHud(this);
    }

    preload() {
        this.load.setPath('assets');
    }

    create() {
        this.drawGridOnce();

        // Initialize AudioContext listener
        const audioCtx = (this.sound as any).context as AudioContext;
        if (audioCtx) {
            const listener = audioCtx.listener;
            if (listener.positionX) {
                listener.positionX.value = this.CANVAS_WIDTH / 2;
                listener.positionY.value = this.CANVAS_HEIGHT / 2;
                listener.positionZ.value = 300;
                listener.forwardX.value = 0;
                listener.forwardY.value = 0;
                listener.forwardZ.value = -1;
                listener.upX.value = 0;
                listener.upY.value = 1;
                listener.upZ.value = 0;
            } else {
                listener.setPosition(this.CANVAS_WIDTH / 2, this.CANVAS_HEIGHT / 2, 300);
                listener.setOrientation(0, 0, -1, 0, 1, 0);
            }
        }

        this.humanPlayer = this.playerManager.addPlayer(this.WORLD_WIDTH * (1 / 3), this.WORLD_HEIGHT / 2, 0x00ff00);
        
        for(let i=0; i<this.NUM_BOTS; i++) {
            const spacing = this.WORLD_HEIGHT / (this.NUM_BOTS + 1);
            const yPos = spacing * (i + 1);
            const randomColor = Phaser.Display.Color.HSVToRGB(Math.random(), 1, 1).color;
            const bot = this.playerManager.addPlayer(this.WORLD_WIDTH * (2 / 3), yPos, randomColor);
            this.aiPlayers.push(bot);
            this.aiControllers.push(new BotController(this, bot));
        }

        this.debugHud.add("Rubber", this.humanPlayer, "rubber");
        this.debugHud.add("Speed", this.humanPlayer, "velocity");

        EventBus.on('toggle-invincibility', (invincibleState: boolean) => {
            if (this.humanPlayer) {
                this.humanPlayer.isInvincible = invincibleState;
            }
        });

        EventBus.on('toggle-camera-follow', (followState: boolean) => {
            this.isCameraFollowing = followState;
            this.updateCameraView();
        });

        this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
            this.CANVAS_WIDTH = gameSize.width;
            this.CANVAS_HEIGHT = gameSize.height;

            this.updateCameraView();
        });

        this.updateCameraView();

        // Game state
        this.isAlive = true;

        // Controls
        this.isKeyDown = {};

        // Game Over text (hidden initially)
        this.gameOverText = this.add
            .text(0, 0, 'GAME OVER', {
                fontSize: '48px',
                color: '#ff0000',
                fontFamily: 'Arial',
            })
            .setOrigin(0.5)
            .setDepth(1000)
            .setVisible(false);

        this.restartText = this.add
            .text(
                0, 0,
                'Press SPACE to restart',
                {
                    fontSize: '24px',
                    color: '#ffffff',
                    fontFamily: 'Courier New',
                }
            )
            .setOrigin(0.5)
            .setDepth(1000)
            .setVisible(false);

        this.restartText = this.add
            .text(
                this.CANVAS_WIDTH / 2,
                this.CANVAS_HEIGHT / 2 + 30,
                'Press SPACE to restart',
                {
                    fontSize: '24px',
                    color: '#ffffff',
                    fontFamily: 'Courier New',
                }
            )
            .setOrigin(0.5)
            .setVisible(false);

        EventBus.on("game-over", (winner?: string) => {
            this.humanPlayer.isRunning = false;
            for(let bot of this.aiPlayers) {
                bot.isRunning = false;
            }
            this.isAlive = false;
            
            if (winner === 'human') {
                this.gameOverText.setText('YOU WIN!');
                this.gameOverText.setColor('#00ff00');
            } else if (winner === 'ai') {
                this.gameOverText.setText('BOT WINS!');
                this.gameOverText.setColor('#ff0000');
            } else {
                this.gameOverText.setText('GAME OVER');
                this.gameOverText.setColor('#ff0000');
            }
            
            this.gameOverText.setVisible(true);
            this.restartText.setVisible(true);
        });

        EventBus.on("game-start", () => {
            const audioCtx = (this.sound as any).context as AudioContext;
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }

            // Reset all game state
            this.isAlive = true;

            this.humanPlayer.reset(this.WORLD_WIDTH * (1 / 3), this.WORLD_HEIGHT / 2, -Math.PI / 2);
            this.humanPlayer.isRunning = true;

            for(let i=0; i<this.NUM_BOTS; i++) {
                const spacing = this.WORLD_HEIGHT / (this.NUM_BOTS + 1);
                const yPos = spacing * (i + 1);
                this.aiPlayers[i].reset(this.WORLD_WIDTH * (2 / 3), yPos, -Math.PI / 2);
                this.aiPlayers[i].isRunning = true;
            }

            // Hide game over text
            this.gameOverText.setVisible(false);
            this.restartText.setVisible(false);

            // Reset key states
            this.isKeyDown = {};
        });


        // Add space key for restart
        this.spaceKey = this.input.keyboard!.addKey(
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
            // Keep game over text centered and correctly sized relative to camera
            const cx = this.cameras.main.worldView.centerX;
            const cy = this.cameras.main.worldView.centerY;
            const zoom = this.cameras.main.zoom;

            this.gameOverText.setPosition(cx, cy - (30 / zoom));
            this.gameOverText.setScale(1 / zoom);

            this.restartText.setPosition(cx, cy + (30 / zoom));
            this.restartText.setScale(1 / zoom);

            // Check for restart
            if (this.spaceKey.isDown) {
                EventBus.emit("game-start");
            }
            return;
        }

        //const renderFps = Math.round(this.game.loop.actualFps);
        //console.log(renderFps);
        for(let controller of this.aiControllers) {
            controller.update(_time, delta);
        }
        this.playerManager.update(_time, delta);
        this.debugHud.update(delta);

        // Update audio listener to follow the camera center
        const audioCtx = (this.sound as any).context as AudioContext;
        if (audioCtx) {
            const listener = audioCtx.listener;
            const cam = this.cameras.main;
            const camMidX = cam.scrollX + cam.width / 2;
            const camMidY = cam.scrollY + cam.height / 2;

            if (listener.positionX) {
                listener.positionX.setTargetAtTime(camMidX, audioCtx.currentTime, 0.05);
                listener.positionY.setTargetAtTime(camMidY, audioCtx.currentTime, 0.05);
            } else {
                listener.setPosition(camMidX, camMidY, 300);
            }
        }

        // Check boundary collision and rubber for all players
        if (
            this.humanPlayer.x < 0 ||
            this.humanPlayer.x > this.WORLD_WIDTH ||
            this.humanPlayer.y < 0 ||
            this.humanPlayer.y > this.WORLD_HEIGHT ||
            this.humanPlayer.rubber <= 0
        ) {
            EventBus.emit("game-over", "ai");
        } else {
            let activeBots = 0;
            for(let bot of this.aiPlayers) {
                if(!bot.isRunning) continue;
                
                if (
                    bot.x < 0 ||
                    bot.x > this.WORLD_WIDTH ||
                    bot.y < 0 ||
                    bot.y > this.WORLD_HEIGHT ||
                    bot.rubber <= 0
                ) {
                    bot.isRunning = false;
                    bot.trailLines = [];
                    bot.staticTrailGraphics.clear();
                    bot.activeTrailGraphics.clear();
                    bot.driverGraphics.clear();
                    if(bot.oscillator) {
                        try { bot.oscillator.stop(); } catch(e){}
                    }
                } else {
                    activeBots++;
                }
            }
            if(activeBots === 0) {
                EventBus.emit("game-over", "human");
            }
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
        for (let x = 0; x <= this.WORLD_WIDTH; x += gridSize) {
            this.gridGraphics.moveTo(x, 0);
            this.gridGraphics.lineTo(x, this.WORLD_HEIGHT);
        }

        // Draw horizontal lines
        for (let y = 0; y <= this.WORLD_HEIGHT; y += gridSize) {
            this.gridGraphics.moveTo(0, y);
            this.gridGraphics.lineTo(this.WORLD_WIDTH, y);
        }
        this.gridGraphics.strokePath();

        // Send grid to back so it appears behind other elements
        this.gridGraphics.setDepth(-1);
    }

    updateCameraView() {
        if (this.isCameraFollowing) {
            this.cameras.main.setBounds(0, 0, this.WORLD_WIDTH, this.WORLD_HEIGHT, true);
            this.cameras.main.setZoom(this.CANVAS_WIDTH / this.PLAYER_VIEW_WIDTH);
            this.cameras.main.startFollow(this.humanPlayer, true, 0.1, 0.1);
        } else {
            this.cameras.main.removeBounds();
            this.cameras.main.stopFollow();
            const zoomX = this.CANVAS_WIDTH / this.WORLD_WIDTH;
            const zoomY = this.CANVAS_HEIGHT / this.WORLD_HEIGHT;
            this.cameras.main.setZoom(Math.min(zoomX, zoomY));
            this.cameras.main.centerOn(this.WORLD_WIDTH / 2, this.WORLD_HEIGHT / 2);
        }
    }


}
