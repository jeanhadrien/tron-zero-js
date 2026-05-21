import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import PlayerRenderer from '../gameobjects/PlayerRenderer';
import DebugHud from '../gameobjects/DebugHud';
import { GameEventBus } from '../../../shared/GameEventBus';
import GameArea, { ECSGameAreaSystem } from '../../../shared/GameArea';
import GameClock from '../../../shared/GameClock';
import GameAreaRenderer from '../gameobjects/GameAreaRenderer';
import AudioManager from '../gameobjects/AudioManager';

import { NetworkClient } from '../network/NetworkClient';
import GameCamera from '../gameobjects/GameCamera';
import { Logger } from '../../../shared/Logger';
import { trace } from '@opentelemetry/api';
import ECSGameRoom from '../../../shared/ECSGameRoom';
import PlayerSystem from '../../../shared/ECSPlayerSystem';
import { ECSPlayerAdapter } from '../ECSPlayerAdapter';

const logger = new Logger('Game');
const tracer = trace.getTracer('tron-zero-client');

export class GameScene extends Scene {
  CANVAS_WIDTH: number;
  CANVAS_HEIGHT: number;

  isKeyDown: Record<string, boolean>;
  isLocalPlayerAlive: boolean;
  gameOverText: Phaser.GameObjects.Text;
  restartText: Phaser.GameObjects.Text;
  spaceKey: Phaser.Input.Keyboard.Key;

  playerRenderers: Map<string, PlayerRenderer> = new Map();

  humanPlayer: ECSPlayerAdapter | null = null;

  gameClock: GameClock;
  gameRoom: ECSGameRoom;

  debugHud: DebugHud;
  gameArea: GameArea;
  networkClient: NetworkClient;

  tickOffset: number = 1;
  private _pendingTurnCount: number = 0;

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
    this.debugHud = new DebugHud(this);
    this.audioManager = new AudioManager(this);
    this.gameRoom = new ECSGameRoom(new GameEventBus(), this.gameClock, [new ECSGameAreaSystem(), new PlayerSystem()]);

    this.gameAreaRenderer = new GameAreaRenderer(this, this.gameArea);
    this.networkClient = new NetworkClient(bus, this.gameRoom, this.gameClock);
    this.gameCamera = new GameCamera(this, this.gameArea, this.audioManager);
  }

  preload() {
    this.load.setPath('assets');
  }

  create() {
    const span = tracer.startSpan('game.scene.create');

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
      logger.info('game-start');
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
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

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
          if (this.humanPlayer) {
            const targetTick = this.gameRoom.world.tick - 1 + this._pendingTurnCount;
            this.networkClient.sendTurn(targetTick, direction as 'left' | 'right');
            this._pendingTurnCount++;
          }
        }
      });
      this.input.keyboard?.on(`keyup-${key}`, () => {
        this.isKeyDown[key] = false;
      });
    });

    span.end();
  }

  setupSocket() {
    this.networkClient.onInitState = (humanPlayer, allPlayers) => {
      for (const player of allPlayers) {
        if (!this.playerRenderers.has(player.id)) {
          this.playerRenderers.set(player.id, new PlayerRenderer(this, this.audioManager));
        }
      }

      if (humanPlayer) {
        this.humanPlayer = humanPlayer;
        this.debugHud.add('Rubber', this.humanPlayer, 'rubber');
        this.debugHud.add('Speed', this.humanPlayer, 'velocity');
        this.gameCamera.setHumanPlayer(this.humanPlayer);
      }
    };

    this.networkClient.onPlayerJoined = (player) => {
      if (!this.playerRenderers.has(player.id)) {
        const playerRenderer = new PlayerRenderer(this, this.audioManager);
        this.playerRenderers.set(player.id, playerRenderer);
      }
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
    if (this.humanPlayer && !this.humanPlayer.isAlive) {
      const cx = this.cameras.main.worldView.centerX;
      const cy = this.cameras.main.worldView.centerY;
      const zoom = this.cameras.main.zoom;

      this.gameOverText.setPosition(cx, cy - 30 / zoom);
      this.gameOverText.setScale(1 / zoom);

      this.restartText.setPosition(cx, cy + 30 / zoom);
      this.restartText.setScale(1 / zoom);

      if (this.spaceKey.isDown) {
        this.networkClient.sendRespawn();
        EventBus.emit('game-start');
      }
    }

    this.gameRoom.updateFixed(delta);

    this._pendingTurnCount = 0;

    for (const [id, renderer] of this.playerRenderers) {
      const eid = PlayerSystem.getPlayerEidByStringId(this.gameRoom.world, id);
      if (eid < 0) {
        renderer.setVisible(false);
        continue;
      }
      // Reuse a lightweight adapter per frame for rendering — created inline
      // since ECSPlayerAdapter is just a thin wrapper reading component stores.
      const adapter = this._adapterCache.get(id) ?? new ECSPlayerAdapter(eid, this.gameRoom.world);
      if (!this._adapterCache.has(id)) {
        this._adapterCache.set(id, adapter);
      }
      adapter.eid = eid;

      renderer.renderInterpolated(adapter, adapter.x, adapter.y);
      renderer.setVisible(true);
    }

    if (this.humanPlayer) {
      this.gameCamera.update(this.humanPlayer.x, this.humanPlayer.y);
    }

    // Handle death
    if (this.humanPlayer && this.humanPlayer.rubber <= 0 && this.humanPlayer.isAlive) {
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

  // Cache adapters across frames to avoid allocations
  private _adapterCache = new Map<string, ECSPlayerAdapter>();

  releaseKey(key: string) {
    this.isKeyDown[key] = false;
  }
}
