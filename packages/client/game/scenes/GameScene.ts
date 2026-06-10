import { Scene } from 'phaser';
import { EventBus } from '../managers/EventBus';
import DebugHud from '../gameobjects/DebugHud';
import GameArea from '@tron0/shared/systems/GameArenaSystem';
import GameAreaRenderer from '../gameobjects/GameAreaRenderer';
import AudioManager from '../managers/AudioManager';
import GameCamera from '../gameobjects/GameCamera';
import { Logger } from '@tron0/shared/Logger';
import { trace } from '@opentelemetry/api';
import { ClientNetworkSystem, NetworkDataHandler } from '../managers/ClientNetworkSystem';
import { PlayerRenderSystem } from '../systems/PlayerRenderSystem';
import { ClientChatSystem } from '../managers/ClientChatSystem';
import { SimulationWorkerManager } from '../workers/SimulationWorkerManager';
import { ClientInput } from '../input/ClientInput';

const logger = new Logger('Game');
const tracer = trace.getTracer('tron-zero-client');

const DEFAULT_TICK_MS = 1000 / 60;

export class GameScene extends Scene {
  CANVAS_WIDTH: number;
  CANVAS_HEIGHT: number;

  gameOverText: Phaser.GameObjects.Text;
  restartText: Phaser.GameObjects.Text;

  humanEid: number = -1;

  isConnected: boolean = false;
  menuOpen: boolean = false;
  phase: 'idle' | 'stabilizing' | 'playing' = 'idle';

  debugHud: DebugHud;
  gameArea: GameArea;
  gameAreaRenderer: GameAreaRenderer;
  gameCamera: GameCamera;
  audioManager: AudioManager;

  renderSystem: PlayerRenderSystem;
  networkClient: ClientNetworkSystem;
  chatSystem: ClientChatSystem;
  workerManager: SimulationWorkerManager;
  clientInput: ClientInput;

  private _referenceTickTimeMs: number = DEFAULT_TICK_MS;
  private _simLoopHandle: number | null = null;
  private _lastSimTime: number = 0;
  private _clockWarmedUp: boolean = false;

  constructor() {
    super('Game');
  }

  init() {
    this.CANVAS_WIDTH = this.scale.width;
    this.CANVAS_HEIGHT = this.scale.height;
    this.gameArea = new GameArea();
    this.debugHud = new DebugHud(this);
    this.audioManager = new AudioManager(this);

    this.networkClient = new ClientNetworkSystem();
    this.renderSystem = new PlayerRenderSystem(this);
    this.chatSystem = new ClientChatSystem(() => this.networkClient.channel);
    this.workerManager = new SimulationWorkerManager();

    this.gameAreaRenderer = new GameAreaRenderer(this, this.gameArea);
    this.gameCamera = new GameCamera(this, this.gameArea, this.audioManager);
  }

  /** Connect to a game server, spawning the simulation Worker and wiring everything. */
  connectToServer(host: string, port: number, secure?: boolean): void {
    if (this.isConnected) return;
    this.phase = 'stabilizing';
    this._clockWarmedUp = false;
    EventBus.emit('connection-state', 'connecting');

    // 1. Spawn the simulation Worker
    this._stopSimulationLoop();
    this.workerManager.destroy(); // clean up any previous worker
    this.workerManager.onReady = (_tick: number, _leadTicks: number) => {
      logger.info('Worker sim ready');
    };
    this.workerManager.init({
      referenceTickTimeMs: this._referenceTickTimeMs,
      snapshotPeriodX: 10,
      minSnapshotCoverageMs: 100,
      sessionToken: this.networkClient.sessionToken,
    });

    // 2. Wire network → Worker relay
    const relay: NetworkDataHandler = {
      onInitState: (tick, snapshot) => this.workerManager.sendInitState(tick, snapshot),
      onSyncStateBatch: (serverTick, diffs) => this.workerManager.sendSyncStateBatch(serverTick, diffs),
      onPong: (rttMs, serverTick) => this.workerManager.sendPong(rttMs, serverTick),
    };
    this.networkClient.setHandler(relay);

    // 3. Connect the network
    this.networkClient.connect(host, port, secure);

    // 4. Wire input dispatch
    this.clientInput.wire({
      channel: this.networkClient.channel,
      worker: this.workerManager,
      getTick: () => this.workerManager.latestCurrentTick,
      getAlpha: () => this.workerManager.computeAlpha(),
      playerId: this.networkClient.sessionToken,
    });
    this.clientInput.setGamePhase(this.phase);
    this.clientInput.setCanRespawn(false);

    // 5. Wire chat after channel exists
    this.chatSystem.wire();

    // 6. Wire render system
    this.renderSystem.init();

    // 7. Debug HUD — read from Worker state
    this.debugHud.add('OWD', () => this.workerManager.latestOWD);
    this.debugHud.add('TickErr', () => this.workerManager.latestTickError);
    this.debugHud.add('Scale', () => this.workerManager.latestScale);
    this.debugHud.add('Lead', () => this.workerManager.latestLeadTicks);
    this.debugHud.add('Tick', () => this.workerManager.latestCurrentTick);
    this.debugHud.add('FPS', () => this.game.loop.actualFps);

    // 8. Start the simulation driver loop
    this._startSimulationLoop();
  }

  // ── Simulation driver loop (setInterval) ─────────────────────────────────

  /**
   * Sends fixed-interval {@code delta_time} messages to the Worker.
   * The Worker owns clock sync, accumulator, and tick processing.
   */
  private _startSimulationLoop(): void {
    if (this._simLoopHandle !== null) return;
    this._lastSimTime = performance.now();
    this._simLoopHandle = window.setInterval(() => {
      const now = performance.now();
      const delta = now - this._lastSimTime;
      this._lastSimTime = now;

      this.workerManager.sendDeltaTime(delta);

      // Clock warmup detection: when worker is processing ticks, consider it warmed up.
      // The worker's ClockSyncManager handles the actual OWD stabilisation internally.
      if (!this._clockWarmedUp && this.workerManager.latestCurrentTick > 10) {
        this._clockWarmedUp = true;
      }
    }, this._referenceTickTimeMs);
  }

  private _stopSimulationLoop(): void {
    if (this._simLoopHandle !== null) {
      clearInterval(this._simLoopHandle);
      this._simLoopHandle = null;
    }
  }

  private _handleRespawn(): void {
    const tick = this.workerManager.latestCurrentTick;
    this.networkClient.sendRespawn(tick);
    this.workerManager.sendRespawn(tick);
    EventBus.emit('game-start');
  }

  // ── Phaser lifecycle ─────────────────────────────────────────────────────

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

    this.clientInput = new ClientInput(() => this._handleRespawn());

    EventBus.on('chat-send', (text: string) => {
      this.chatSystem.sendMessage(text);
    });

    EventBus.on('menu-open', () => {
      this.menuOpen = true;
      this.clientInput.setMenuOpen(true);
    });
    EventBus.on('menu-closed', () => {
      this.menuOpen = false;
      this.clientInput.setMenuOpen(false);
    });
    EventBus.on('connection-state', (state: string) => {
      this.isConnected = state === 'connected';
    });

    const onGameResume = () => {
      logger.info('Tab resumed, syncing...');
      this.audioManager.resume();
      this.clientInput.reset();
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
      this.gameOverText.setVisible(false);
      this.restartText.setVisible(false);
      this.clientInput.reset();
    });

    this.events.on('shutdown', () => {
      EventBus.off('game-resume', onGameResume);
      this._stopSimulationLoop();
      this.clientInput.destroy();
      this.workerManager.destroy();
    });

    EventBus.emit('current-scene-ready', this);

    span.end();
  }

  // ── Render loop (Phaser's rAF) ───────────────────────────────────────────

  /**
   * Render-only. Simulation runs in the Worker.
   * Consumes {@link SimulationWorkerManager.latestOutput} to draw each frame.
   */
  update(_time: any, delta: number) {
    // Tab resume — request full state sync
    if (delta > 10000) {
      this.audioManager.resume();
      if (this.networkClient.isConnected()) {
        this.networkClient.requestInitState();
      } else {
        this.networkClient.reconnect();
      }
      this.workerManager.destroy();
      return;
    }

    // Sync local player EID from Worker
    this.humanEid = this.workerManager.localPlayerEid;

    this.clientInput.setGamePhase(this.phase);
    this.clientInput.setCanTurn(this.humanEid >= 0);

    // -- non-playing phases: wait for clock stabilisation --------------------
    if (this.phase !== 'playing') {
      this.clientInput.setCanRespawn(false);
      if (this.phase === 'stabilizing' && this._clockWarmedUp) {
        this.phase = 'playing';
        this.clientInput.setGamePhase(this.phase);
        EventBus.emit('game-start');
      }
      this.debugHud.update(_time);
      return;
    }

    // -- playing phase ------------------------------------------------------

    // Feed Worker output to render system
    if (this.workerManager.latestOutput.length > 0) {
      this.renderSystem.consumeWorkerOutput(this.workerManager.latestOutput);
      this.workerManager.latestOutput = [];
    }

    // Game over overlay
    let canRespawn = false;
    if (this.humanEid >= 0) {
      const localDatum = this.renderSystem.getLatest(this.humanEid);
      if (localDatum && !localDatum.isAlive) {
        canRespawn = true;
        const cx = this.cameras.main.worldView.centerX;
        const cy = this.cameras.main.worldView.centerY;
        const zoom = this.cameras.main.zoom;

        this.gameOverText.setPosition(cx, cy - 30 / zoom).setScale(1 / zoom).setVisible(true);
        this.restartText.setPosition(cx, cy + 30 / zoom).setScale(1 / zoom).setVisible(true);
      } else {
        this.gameOverText.setVisible(false);
        this.restartText.setVisible(false);
      }
    }
    this.clientInput.setCanRespawn(canRespawn);

    this.clientInput.endFrame();

    // Render
    const alpha = this.workerManager.computeAlpha();
    this.renderSystem.renderMode = 'unified';
    this.renderSystem.render(
      alpha,
      this.humanEid,
      this.workerManager.latestCurrentTick,
      this.workerManager.latestLeadTicks
    );

    // Camera follow (use extrapolated position, consistent with render)
    if (this.humanEid >= 0) {
      const localDatum = this.renderSystem.getLatest(this.humanEid);
      if (localDatum) {
        const renderX = localDatum.x + (localDatum.vx / 1000) * alpha;
        const renderY = localDatum.y + (localDatum.vy / 1000) * alpha;
        this.gameCamera.update(renderX, renderY);
      }
    }

    this.debugHud.update(_time);
  }
}