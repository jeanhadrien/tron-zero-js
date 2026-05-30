import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import DebugHud from '../gameobjects/DebugHud';
import { GameEventBus } from '../../../shared/GameEventBus';
import GameClock from '../../../shared/GameClock';
import GameAreaRenderer from '../gameobjects/GameAreaRenderer';
import AudioManager from '../gameobjects/AudioManager';

import GameCamera from '../gameobjects/GameCamera';
import { Logger } from '../../../shared/Logger';
import { trace } from '@opentelemetry/api';
import PlayerSystem, { Position, Rubber, IsAlive } from '../../../shared/systems/PlayerSystem';
import { ECSGameRoom } from '../../../shared/ECSGameRoom';
import GameArea, { GameArenaSystem } from '../../../shared/systems/GameArenaSystem';
import { ClientNetworkSystem } from '../systems/ClientNetworkSystem';
import { PlayerRenderSystem } from '../systems/PlayerRenderSystem';
import { ChatClientSystem } from '../systems/ChatClientSystem';

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

  gameClock: GameClock;
  room: ECSGameRoom;

  debugHud: DebugHud;
  gameArea: GameArea;

  private _pendingTurnCount: number = 0;

  lastFpsEmitTime: number = 0;
  gameAreaRenderer: GameAreaRenderer;
  gameCamera: GameCamera;
  audioManager: AudioManager;

  renderSystem: PlayerRenderSystem;
  networkClient: ClientNetworkSystem;
  chatSystem: ChatClientSystem;

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

    this.networkClient = new ClientNetworkSystem();
    this.renderSystem = new PlayerRenderSystem(this);
    this.chatSystem = new ChatClientSystem(this.networkClient.channel);

    this.room = new ECSGameRoom(new GameEventBus(), this.gameClock, [
      new GameArenaSystem(),
      new PlayerSystem(),
      this.networkClient,
      this.renderSystem,
      this.chatSystem,
    ]);

    this.gameAreaRenderer = new GameAreaRenderer(this, this.gameArea);
    this.gameCamera = new GameCamera(this, this.gameArea, this.audioManager);
  }

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
    });

    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.keyboard.removeCapture(Phaser.Input.Keyboard.KeyCodes.SPACE);

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
        if (!this.isKeyDown[key]) {
          this.isKeyDown[key] = true;
          if (this.humanEid >= 0) {
            const targetTick = this.room.tick + this._pendingTurnCount;
            this.networkClient.sendInput({
              tick: targetTick,
              turn: direction as 'left' | 'right',
              break: false,
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

    span.end();
  }

  //   setupSocket() {
  //     this.networkClient.onInitState = (humanMeta, allPlayers) => {
  //       const world = this.room.world;

  //       for (const p of allPlayers) {
  //         this.playerRenderers.set(p.id, new PlayerRenderer(this, p.eid, world, this.audioManager));
  //       }

  //       if (humanMeta) {
  //         this.humanEid = humanMeta.eid;
  //         this.debugHud.add('Rubber', () => Rubber[this.humanEid]);
  //         this.debugHud.add('Speed', () => [Velocity.vx[this.humanEid], Velocity.vy[this.humanEid]]);
  //         this.gameCamera.setHumanPlayer({ x: Position.x[this.humanEid], y: Position.y[this.humanEid] });
  //       }
  //     };

  //     this.networkClient.onPlayerJoined = (player) => {
  //       if (!this.playerRenderers.has(player.id)) {
  //         this.playerRenderers.set(player.id, new PlayerRenderer(this, player.eid, this.room.world, this.audioManager));
  //       }
  //     };

  //     this.networkClient.onPlayerLeft = (playerId) => {
  //       const renderer = this.playerRenderers.get(playerId);
  //       if (renderer) {
  //         renderer.destroy();
  //         this.playerRenderers.delete(playerId);
  //       }
  //     };

  //     this.networkClient.onPlayerTurn = (player) => {
  //       this.audioManager.playTurnSound(player.x, player.y);
  //     };

  //     this.networkClient.connect();
  //   }

  update(_time: any, delta: number) {
    if (delta > 10000) {
      this.audioManager.resume();
      if (this.networkClient.isConnected()) {
        this.networkClient.requestInitState();
      } else {
        this.networkClient.reconnect();
      }
      return;
    }
    if (this.humanEid >= 0 && IsAlive[this.humanEid] !== 1) {
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

    this.room.updateFixed(delta);

    this._pendingTurnCount = 0;

    if (this.room.localPlayerEid) {
      this.humanEid = this.room.localPlayerEid;
    }

    this.renderSystem.localPlayerEid = this.humanEid;
    this.renderSystem.render();

    if (this.humanEid >= 0) {
      this.gameCamera.update(Position.x[this.humanEid], Position.y[this.humanEid]);
    }

    if (this.humanEid >= 0 && Rubber[this.humanEid] <= 0 && IsAlive[this.humanEid] === 1) {
      EventBus.emit('game-over', 'ai');
    }

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
