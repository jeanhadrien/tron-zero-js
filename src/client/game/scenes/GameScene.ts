import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import PlayerRenderer from '../gameobjects/PlayerRenderer';
import GameRoom from '../../../shared/GameRoom';
import DebugHud from '../gameobjects/DebugHud';
import Player from '../../../shared/Player';
import { GameEventBus } from '../../../shared/GameEventBus';
import GameArea from '../../../shared/GameArea';
import GameClock from '../../../shared/GameClock';
import GameAreaRenderer from '../gameobjects/GameAreaRenderer';
import AudioManager from '../gameobjects/AudioManager';

import { NetworkClient } from '../network/NetworkClient';
import GameCamera from '../gameobjects/GameCamera';

export class GameScene extends Scene {
  CANVAS_WIDTH: number;
  CANVAS_HEIGHT: number;

  isKeyDown: Record<string, boolean>;
  isLocalPlayerAlive: boolean;
  gameOverText: Phaser.GameObjects.Text;
  restartText: Phaser.GameObjects.Text;
  spaceKey: Phaser.Input.Keyboard.Key;

  playerRenderers: Map<string, PlayerRenderer> = new Map();

  humanPlayer: Player | null = null;

  gameClock: GameClock;
  gameRoom: GameRoom;

  debugHud: DebugHud;
  gameArea: GameArea;
  networkClient: NetworkClient;

  tickOffset: number = 1;

  lastFpsEmitTime: number = 0;
  gameAreaRenderer: GameAreaRenderer;
  gameCamera: GameCamera;
  audioManager: AudioManager;

  constructor() {
    super('Game');
  }

  init() {
    this.CANVAS_WIDTH = this.scale.width;
    this.CANVAS_HEIGHT = this.scale.height;
    let bus = new GameEventBus();
    this.gameArea = new GameArea();
    this.gameClock = new GameClock();
    this.gameRoom = new GameRoom(bus, this.gameArea, this.gameClock);
    this.debugHud = new DebugHud(this);
    this.audioManager = new AudioManager(this);

    this.gameAreaRenderer = new GameAreaRenderer(this, this.gameArea);
    this.networkClient = new NetworkClient(bus, this.gameRoom, this.gameClock);
    this.gameCamera = new GameCamera(this, this.gameArea, this.audioManager);
  }

  preload() {
    this.load.setPath('assets');
  }

  create() {
    this.gameAreaRenderer.draw();
    this.setupSocket();

    // Initialize AudioContext listener
    this.audioManager.initListener(this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.CANVAS_WIDTH = gameSize.width;
      this.CANVAS_HEIGHT = gameSize.height;
    });

    // Game state
    this.isLocalPlayerAlive = true;

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
      .text(0, 0, 'Press SPACE to restart', {
        fontSize: '24px',
        color: '#ffffff',
        fontFamily: 'Courier New',
      })
      .setOrigin(0.5)
      .setDepth(1000)
      .setVisible(false);

    EventBus.on('game-start', () => {
      console.info('game-start');
      this.audioManager.resume();

      // In multiplayer, restart should probably re-join or tell server to respawn
      this.isLocalPlayerAlive = true;

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

    this.gameRoom.playerEventBus.on('player_turn', (pState, pTurnPoint) => {
      if (pState.id == this.humanPlayer?.id)
        this.networkClient.sendTurn(pTurnPoint.serialize());
    });

    // Bind key down events to controls
    Object.entries(keyMappings).forEach(([key, direction]) => {
      this.input.keyboard?.on(`keydown-${key}`, () => {
        if (!this.isKeyDown[key]) {
          this.isKeyDown[key] = true;
          if (this.humanPlayer) {
            this.humanPlayer.queueTurn(direction, this.gameClock.tick);
          }
        }
      });
      this.input.keyboard?.on(`keyup-${key}`, () => {
        this.isKeyDown[key] = false;
      });
    });
  }

  setupSocket() {
    this.networkClient.onInitState = (humanPlayer, allPlayers) => {
      for (const player of allPlayers) {
        this.playerRenderers.set(
          player.id,
          new PlayerRenderer(this, this.audioManager)
        );
      }

      if (humanPlayer) {
        this.humanPlayer = humanPlayer;
        this.debugHud.add('Rubber', this.humanPlayer, 'rubber');
        this.debugHud.add('Speed', this.humanPlayer, 'velocity');
        this.gameCamera.setHumanPlayer(this.humanPlayer);
      }
    };

    this.networkClient.onPlayerJoined = (player) => {
      const playerRenderer = new PlayerRenderer(this, this.audioManager);
      this.playerRenderers.set(player.id, playerRenderer);
    };

    this.networkClient.onPlayerLeft = (playerId) => {
      const renderer = this.playerRenderers.get(playerId);
      if (renderer) {
        renderer.destroy();
        this.playerRenderers.delete(playerId);
      }
    };

    this.networkClient.onPlayerTurn = (player) => {
      this.audioManager.playTurnSound(player.x, player.y);
    };

    this.networkClient.connect();
  }

  update(_time: any, delta: number) {
    if (this.humanPlayer && !this.humanPlayer.isRunning) {
      // Keep game over text centered and correctly sized relative to camera
      const cx = this.cameras.main.worldView.centerX;
      const cy = this.cameras.main.worldView.centerY;
      const zoom = this.cameras.main.zoom;

      this.gameOverText.setPosition(cx, cy - 30 / zoom);
      this.gameOverText.setScale(1 / zoom);

      this.restartText.setPosition(cx, cy + 30 / zoom);
      this.restartText.setScale(1 / zoom);

      // Check for restart
      if (this.spaceKey.isDown) {
        this.networkClient.sendRespawn();
        // Do NOT reset the game clock to 0 here! The server drives the time.
        // We will wait for the server to spawn us and send 'player_spawn'.
        // We can emit game-start locally to hide the game over UI.
        EventBus.emit('game-start');
      }
    }

    this.gameRoom.update(delta);

    const alpha = this.gameClock.getAlpha();

    for (const [id, renderer] of this.playerRenderers) {
      try {
        const pos = this.gameRoom.getRenderPosition(id, alpha);
        const player = this.gameRoom.getPlayer(id);
        if (pos && player) {
          renderer.renderInterpolated(player, pos.x, pos.y);
        }
      } catch (e) {
        // Player might be missing temporarily before sync catches up
      }
    }

    if (this.humanPlayer) {
      const humanPos = this.gameRoom.getRenderPosition(
        this.humanPlayer.id,
        alpha
      );
      if (humanPos) {
        this.gameCamera.update(humanPos.x, humanPos.y);
      }
    }

    // Handle death
    if (
      this.humanPlayer &&
      this.humanPlayer.rubber <= 0 &&
      this.humanPlayer.isRunning
    ) {
      EventBus.emit('game-over', 'ai');
    }

    // Throttle FPS emit to avoid Reactivity spam in SolidJS
    if (_time - this.lastFpsEmitTime > 50) {
      // Every 250ms
      this.lastFpsEmitTime = _time;
      EventBus.emit('fps-update', this.game.loop.actualFps);
    }
    // Debug HUD is throttled internally (~12 Hz) to avoid SolidJS reactivity spam
    this.debugHud.update(_time);
  }

  releaseKey(key: string) {
    this.isKeyDown[key] = false;
  }
}
