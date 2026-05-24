import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import PlayerRenderer, { RenderSnapshot } from '../gameobjects/PlayerRenderer';
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
import PlayerSystem, {
  Position,
  Velocity,
  Direction,
  SpeedMult,
  Rubber,
  IsAlive,
  Color,
  TrailPoints,
  PingInTicks,
} from '../../../shared/ECSPlayerSystem';
import { ECSGameWorld } from '../../../shared/ECSGameWorld';

const logger = new Logger('Game');
const tracer = trace.getTracer('tron-zero-client');

class EntityHistory {
  private snapshots: Map<number, RenderSnapshot[]> = new Map();
  private maxAge = 60;

  snapshot(world: ECSGameWorld, eids: number[]) {
    const tick = world.tick;
    for (const eid of eids) {
      const snap: RenderSnapshot = {
        tick,
        x: Position.x[eid],
        y: Position.y[eid],
        direction: Direction[eid],
        color: Color[eid],
        speedMult: SpeedMult[eid],
        rubber: Rubber[eid],
        isAlive: IsAlive[eid] === 1,
        trailLength: TrailPoints.xs[eid]?.length ?? 0,
      };
      let list = this.snapshots.get(eid);
      if (!list) {
        list = [];
        this.snapshots.set(eid, list);
      }
      list.push(snap);
      while (list.length > 0 && list[0].tick < tick - this.maxAge) list.shift();
    }
  }

  lookup(eid: number, targetTick: number): RenderSnapshot | null {
    const list = this.snapshots.get(eid);
    if (!list || list.length === 0) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].tick <= targetTick) return list[i];
    }
    return list[0];
  }
}

export class GameScene extends Scene {
  CANVAS_WIDTH: number;
  CANVAS_HEIGHT: number;

  isKeyDown: Record<string, boolean>;
  isLocalPlayerAlive: boolean;
  gameOverText: Phaser.GameObjects.Text;
  restartText: Phaser.GameObjects.Text;
  spaceKey: Phaser.Input.Keyboard.Key;

  playerRenderers: Map<string, PlayerRenderer> = new Map();

  humanEid: number = -1;

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

  private entityHistory = new EntityHistory();

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

    EventBus.on('game-start', () => {
      logger.info('game-start');
      this.audioManager.resume();

      this.isLocalPlayerAlive = true;

      this.gameOverText.setVisible(false);
      this.restartText.setVisible(false);

      this.isKeyDown = {};
    });

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

    Object.entries(keyMappings).forEach(([key, direction]) => {
      this.input.keyboard?.on(`keydown-${key}`, () => {
        if (!this.isKeyDown[key]) {
          this.isKeyDown[key] = true;
          if (this.humanEid >= 0) {
            const targetTick = this.gameRoom.world.tick + this._pendingTurnCount;
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
    this.networkClient.onInitState = (humanMeta, allPlayers) => {
      const world = this.gameRoom.world;

      for (const p of allPlayers) {
        this.playerRenderers.set(p.id, new PlayerRenderer(this, p.eid, world, this.audioManager));
      }

      if (humanMeta) {
        this.humanEid = humanMeta.eid;
        this.debugHud.add('Rubber', () => Rubber[this.humanEid]);
        this.debugHud.add('Speed', () => [Velocity.vx[this.humanEid], Velocity.vy[this.humanEid]]);
        this.gameCamera.setHumanPlayer({ x: Position.x[this.humanEid], y: Position.y[this.humanEid] });
      }
    };

    this.networkClient.onPlayerJoined = (player) => {
      if (!this.playerRenderers.has(player.id)) {
        this.playerRenderers.set(
          player.id,
          new PlayerRenderer(this, player.eid, this.gameRoom.world, this.audioManager)
        );
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

  private buildLiveSnapshot(world: ECSGameWorld, eid: number): RenderSnapshot {
    return {
      tick: world.tick,
      x: Position.x[eid],
      y: Position.y[eid],
      direction: Direction[eid],
      color: Color[eid],
      speedMult: SpeedMult[eid],
      rubber: Rubber[eid],
      isAlive: IsAlive[eid] === 1,
      trailLength: TrailPoints.xs[eid]?.length ?? 0,
    };
  }

  update(_time: any, delta: number) {
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

    this.gameRoom.updateFixed(delta);

    this._pendingTurnCount = 0;

    const world = this.gameRoom.world;
    const currentTick = world.tick;

    const remoteEids: number[] = [];
    for (const [id, renderer] of this.playerRenderers) {
      const eid = PlayerSystem.getPlayerEidByStringId(world, id);
      if (eid < 0) {
        renderer.setVisible(false);
        continue;
      }
      if (eid !== this.humanEid) {
        remoteEids.push(eid);
      }
    }

    this.entityHistory.snapshot(world, remoteEids);

    for (const [id, renderer] of this.playerRenderers) {
      const eid = PlayerSystem.getPlayerEidByStringId(world, id);
      if (eid < 0) continue;

      let snapshot: RenderSnapshot;

      if (eid === this.humanEid) {
        snapshot = this.buildLiveSnapshot(world, eid);
      } else {
        const delayTicks = Math.round(PingInTicks[eid]);
        const targetTick = currentTick - delayTicks;
        snapshot = this.entityHistory.lookup(eid, targetTick) ?? this.buildLiveSnapshot(world, eid);
      }

      renderer.renderAt(snapshot);
      renderer.setVisible(true);
    }

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

