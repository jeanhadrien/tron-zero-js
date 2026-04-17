import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import Player from '../gameobjects/Player';
import PlayerManager from '../gameobjects/PlayerManager';
import DebugHud from '../gameobjects/DebugHud';
import { io, Socket } from 'socket.io-client';
import PlayerState from '../shared/PlayerState';

export class GameScene extends Scene {
    CANVAS_WIDTH: number;
    CANVAS_HEIGHT: number;
    WORLD_WIDTH: number = 4000;
    WORLD_HEIGHT: number = 4000;
    PLAYER_VIEW_WIDTH: number = 800;
    isCameraFollowing: boolean = true;

    isKeyDown: Record<string, boolean>;
    gridGraphics: Phaser.GameObjects.Graphics;
    humanPlayer: Player | null = null;
    safeDistance: number;
    isAlive: boolean;
    gameOverText: Phaser.GameObjects.Text;
    restartText: Phaser.GameObjects.Text;
    spaceKey: Phaser.Input.Keyboard.Key;

    playerManager: PlayerManager;
    debugHud: DebugHud;
    socket: Socket;
    myId: string | null = null;

    accumulator: number = 0;
    FIXED_DELTA: number = 1000 / 60; // 60 updates per second

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

        this.setupSocket();

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

        EventBus.on("game-over", (winner?: string) => {
            // Server should handle game-over, but for now we keep local UI
            this.isAlive = false;
            if (this.humanPlayer) this.humanPlayer.isRunning = false;
            
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

            // In multiplayer, restart should probably re-join or tell server to respawn
            this.isAlive = true;

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
                    if (this.humanPlayer && this.humanPlayer.isRunning) {
                        this.socket.emit('turn', { direction });
                    }
                }
            });
            this.input.keyboard?.on(`keyup-${key}`, () => {
                this.isKeyDown[key] = false;
            });
        });
    }

    setupSocket() {
        // Connect to Vite proxy which forwards to :3000
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server with ID:', this.socket.id);
            this.myId = this.socket.id!;
        });

        this.socket.on('init_state', (state: any) => {
            console.log('Received init state', Object.keys(state).length, 'players');
            // Clear existing players
            for (let [id, p] of this.playerManager.players) {
                p.destroy();
            }
            this.playerManager.players.clear();

            // Recreate from state
            for (const id in state) {
                const pData = state[id];
                const pState = new PlayerState(pData.x, pData.y, pData.direction, pData.color);
                pState.id = id;
                pState.rubber = pData.rubber;
                pState.isRunning = pData.isRunning;
                
                const player = this.playerManager.addPlayer(pState);
                player.setVisible(true);

                if (id === this.myId) {
                    this.humanPlayer = player;
                    this.debugHud.add("Rubber", this.humanPlayer, "rubber");
                    this.debugHud.add("Speed", this.humanPlayer, "velocity");
                    this.updateCameraView();
                }
            }
        });

        this.socket.on('player_joined', (data: { id: string, state: any }) => {
            console.log('Player joined', data.id);
            if (!this.playerManager.players.has(data.id)) {
                const pData = data.state;
                const pState = new PlayerState(pData.x, pData.y, pData.direction, pData.color);
                pState.id = data.id;
                pState.rubber = pData.rubber;
                pState.isRunning = pData.isRunning;
                const player = this.playerManager.addPlayer(pState);
                player.setVisible(true);
            }
        });

        this.socket.on('player_left', (data: { id: string }) => {
            console.log('Player left', data.id);
            this.playerManager.removePlayer(data.id);
        });

        this.socket.on('sync_state', (state: any) => {
            for (const id in state) {
                const serverState = state[id];
                const localPlayer = this.playerManager.players.get(id);
                if (localPlayer) {
                    localPlayer.updateServerState(serverState);
                }
            }
        });
    }

    update(_time: any, delta: number) {
        if (!this.isAlive && this.humanPlayer) {
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

        // We no longer simulate the game locally.
        // We just call update on players to update sound smoothly,
        // and HUD.
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

        // Handle death
        if (this.humanPlayer && this.humanPlayer.rubber <= 0 && this.isAlive) {
            EventBus.emit("game-over", "ai");
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
        if(!this.humanPlayer) return;

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
