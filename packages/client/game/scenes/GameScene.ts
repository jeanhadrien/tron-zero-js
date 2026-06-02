import { Scene } from 'phaser';
import { EventBus } from '../managers/EventBus';
import DebugHud from '../gameobjects/DebugHud';
import GameClock from '@tron0/shared/GameClock';
import GameAreaRenderer from '../gameobjects/GameAreaRenderer';
import AudioManager from '../managers/AudioManager';

import GameCamera from '../gameobjects/GameCamera';
import { Logger } from '@tron0/shared/Logger';
import { trace } from '@opentelemetry/api';
import PlayerSystem, { Position, Rubber, IsAlive } from '@tron0/shared/systems/PlayerSystem';
import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import GameArea, { GameArenaSystem } from '@tron0/shared/systems/GameArenaSystem';
import { ClientNetworkSystem } from '../systems/ClientNetworkSystem';
import { PlayerRenderSystem } from '../systems/PlayerRenderSystem';
import { ClientChatSystem } from '../systems/ClientChatSystem';
import { ClockSyncManager } from '../managers/ClockSyncManager';

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

  humanEid: number = -1;

  isConnected: boolean = false;
  menuOpen: boolean = false;
  phase: 'idle' | 'stabilizing' | 'playing' = 'idle';

  gameClock: GameClock;
  room?: ECSGameRoom;

  debugHud: DebugHud;
  gameArea: GameArea;

  private _pendingTurnCount: number = 0;
  private _simLoopHandle: number | null = null;
  private _lastSimTime: number = 0;

  lastFpsEmitTime: number = 0;
  gameAreaRenderer: GameAreaRenderer;
  gameCamera: GameCamera;
  audioManager: AudioManager;

  renderSystem: PlayerRenderSystem;
  networkClient: ClientNetworkSystem;
  chatSystem: ClientChatSystem;
  clockSync: ClockSyncManager;

  constructor() {
    super('Game');
  }

  init() {
    this.CANVAS_WIDTH = this.scale.width;
    this.CANVAS_HEIGHT = this.scale.height;
    this.gameArea = new GameArea();
    this.gameClock = new GameClock();
    this.debugHud = new DebugHud(this);
    this.audioManager = new AudioManager(this);

    this.networkClient = new ClientNetworkSystem();
    this.renderSystem = new PlayerRenderSystem(this);
    this.chatSystem = new ClientChatSystem(() => this.networkClient.channel);
    this.clockSync = new ClockSyncManager();

    this.gameAreaRenderer = new GameAreaRenderer(this, this.gameArea);
    this.gameCamera = new GameCamera(this, this.gameArea, this.audioManager);
  }

  /** Connect to a game server, creating the ECS room and starting the simulation. */
  connectToServer(host: string, port: number): void {
    if (this.isConnected) return;
    this.phase = 'stabilizing';
    EventBus.emit('connection-state', 'connecting');

    this.networkClient.connect(host, port);

    this.networkClient.setClockSync(this.clockSync);

    this.room = new ECSGameRoom(this.gameClock, [
      new GameArenaSystem(),
      new PlayerSystem(),
      this.networkClient,
      this.renderSystem,
      this.chatSystem,
    ]);

    this.clockSync.attach(this.room);

    this.debugHud.add('OWD', () => {
      const owd = this.clockSync?.smoothedOWD;
      return owd != null ? owd.toFixed(1) + 'ms' : '-';
    });
    this.debugHud.add('TickErr', () => {
      const err = this.clockSync?.storedTickError;
      return err != null ? err.toFixed(1) : '-';
    });
    this.debugHud.add('Scale', () => {
      const tt = this.room?.clock.tickTimeMs;
      const ref = this.room?.clock.referenceTickTimeMs;
      return tt && ref ? (tt / ref).toFixed(3) : '-';
    });
    this.debugHud.add('Lead', () => this.clockSync?.getLeadTicks() ?? '-');

    this._startSimulationLoop();
  }

  // -- simulation loop (setInterval, separate from Phaser's render) ----------

  /**
   * Runs simulation ticks on a fixed cadence via {@link setInterval}.
   * Yields to the browser between calls so painting is never blocked by
   * simulation bursts. Clock sync adjustment and input consumption happen here.
   */
  private _startSimulationLoop(): void {
    if (this._simLoopHandle !== null) return;
    this._lastSimTime = performance.now();
    this._simLoopHandle = window.setInterval(() => {
      if (!this.room) return;

      const now = performance.now();
      const delta = now - this._lastSimTime;
      this._lastSimTime = now;

      this.clockSync?.adjustClock();
      this.room.clock.addDelta(delta);

      // Cap burst to prevent spiral if the timer was delayed (GC, etc.)
      for (let i = 0; i < 3; i++) {
        if (!this.room.processNextTick()) break;
      }
    }, this.gameClock.referenceTickTimeMs);
  }

  private _stopSimulationLoop(): void {
    if (this._simLoopHandle !== null) {
      clearInterval(this._simLoopHandle);
      this._simLoopHandle = null;
    }
  }

  // -- Phaser lifecycle ------------------------------------------------------

  preload() {
    this.load.setPath('assets');
  }

  create() {
    const span = tracer.startSpan('game.scene.create');

    this.gameAreaRenderer.draw();

    this.audioManager.initListener(this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.CANVAS_WIDTH = gameSize.width;
      this.CANVAS_HEIGHT = gameSize.height;
    });

    this.isLocalPlayerAlive = true;

    this.isKeyDown = {};

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

    EventBus.on('chat-send', (text: string) => {
      this.chatSystem.sendMessage(text);
    });

    EventBus.on('menu-open', () => {
      this.menuOpen = true;
    });
    EventBus.on('menu-closed', () => {
      this.menuOpen = false;
    });
    EventBus.on('connection-state', (state: string) => {
      this.isConnected = state === 'connected';
    });

    const onGameResume = () => {
      logger.info('Tab resumed, syncing...');
      this.audioManager.resume();
      if (this.networkClient.isConnected()) {
        this.networkClient.requestInitState();
      } else {
        this.networkClient.reconnect();
      }
    };
    EventBus.on('game-resume', onGameResume);

    EventBus.on('game-start', () => {
      logger.info('game-start');
      this.audioManager.resume();

      this.isLocalPlayerAlive = true;

      this.gameOverText.setVisible(false);
      this.restartText.setVisible(false);

      this.isKeyDown = {};
    });

    this.events.on('shutdown', () => {
      EventBus.off('game-resume', onGameResume);
      this._stopSimulationLoop();
    });

    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.keyboard!.removeCapture(Phaser.Input.Keyboard.KeyCodes.SPACE);

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

    Object.entries(keyMappings).forEach(([key, direction]) => {
      this.input.keyboard?.on(`keydown-${key}`, () => {
        if (this.menuOpen || this.phase !== 'playing') return;
        if (!this.isKeyDown[key]) {
          this.isKeyDown[key] = true;
          if (this.humanEid >= 0) {
            const targetTick = this.room!.tick + this._pendingTurnCount;
            const alpha = this.room!.clock.getAlpha();
            this.networkClient.sendInput({
              tick: targetTick,
              turn: direction as 'left' | 'right',
              break: false,
              alpha,
            });
            this.room!.clientAddLocalInput({
              tick: targetTick,
              turn: direction as 'left' | 'right',
              playerId: this.room!.localPlayerId,
              alpha,
            });
            this._pendingTurnCount++;
          } else {
            logger.warn('Key ignored — humanEid is', this.humanEid);
          }
        }
      });
      this.input.keyboard?.on(`keyup-${key}`, () => {
        this.isKeyDown[key] = false;
      });
    });

    EventBus.emit('current-scene-ready', this);

    span.end();
  }

  // -- render loop (Phaser's rAF) --------------------------------------------

  /**
   * Render-only. Simulation runs independently via {@link _startSimulationLoop}.
   * This callback only reads the ECS state and draws.
   */
  update(_time: any, delta: number) {
    if (!this.room) return;

    // Tab resume — request full state sync
    if (delta > 10000) {
      this.audioManager.resume();
      if (this.networkClient.isConnected()) {
        this.networkClient.requestInitState();
      } else {
        this.networkClient.reconnect();
      }
      return;
    }

    // Sync local player EID from sim state
    if (this.room.localPlayerEid) {
      this.humanEid = this.room.localPlayerEid;
    }

    // -- non-playing phases: wait for clock stabilisation --------------------
    if (this.phase !== 'playing') {
      if (this.phase === 'stabilizing' && this.clockSync.isWarmedUp()) {
        this.phase = 'playing';
        this.networkClient.sendRespawn();
        EventBus.emit('game-start');
      }
      this.debugHud.update(_time);
      return;
    }

    // -- playing phase ------------------------------------------------------

    // Game over overlay (still render the scene underneath)
    if (this.humanEid >= 0 && IsAlive[this.humanEid] !== 1) {
      const cx = this.cameras.main.worldView.centerX;
      const cy = this.cameras.main.worldView.centerY;
      const zoom = this.cameras.main.zoom;

      this.gameOverText.setPosition(cx, cy - 30 / zoom).setScale(1 / zoom);
      this.restartText.setPosition(cx, cy + 30 / zoom).setScale(1 / zoom);

      if (this.spaceKey.isDown) {
        this.networkClient.sendRespawn();
        EventBus.emit('game-start');
      }
    }

    // Reset pending turn counter (input captured in keyboard handlers this frame)
    this._pendingTurnCount = 0;

    // Render the current ECS state
    this.renderSystem.localPlayerEid = this.humanEid;
    this.renderSystem.render(this.room.clock.getAlpha());

    // Camera follow
    if (this.humanEid >= 0) {
      this.gameCamera.update(Position.x[this.humanEid], Position.y[this.humanEid]);
    }

    // Rubber death detection
    if (this.humanEid >= 0 && Rubber[this.humanEid] <= 0 && IsAlive[this.humanEid] === 1) {
      EventBus.emit('game-over', 'ai');
    }

    // FPS counter
    if (_time - this.lastFpsEmitTime > 50) {
      this.lastFpsEmitTime = _time;
      EventBus.emit('fps-update', this.game.loop.actualFps);
    }

    this.debugHud.update(_time);
  }

  releaseKey(key: string) {
    this.isKeyDown[key] = false;
  }
}
