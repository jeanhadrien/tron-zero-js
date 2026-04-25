import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import PlayerRenderer from '../gameobjects/PlayerRenderer';
import GameRoom from '../../../shared/GameRoom';
import DebugHud from '../gameobjects/DebugHud';
import geckos, { ClientChannel } from '@geckos.io/client';
import PlayerState from '../../../shared/PlayerState';
import { PlayerPoint } from '../../../shared/PlayerPoint';
import { PlayerTrail } from '../../../shared/PlayerTrail';
import { GameEventBus } from '../../../shared/GameEventBus';
import GameArea from '../../../shared/GameArea';
import GameClock from '../../../shared/GameClock';
import GameAreaRenderer from '../gameobjects/GameAreaRenderer';
import PlayerStateDTO from '../../../shared/PlayerStateDTO';
import { it } from 'vitest';

export class GameScene extends Scene {
  CANVAS_WIDTH: number;
  CANVAS_HEIGHT: number;

  PLAYER_VIEW_WIDTH: number = 800;
  isCameraFollowing: boolean = true;

  isKeyDown: Record<string, boolean>;
  isLocalPlayerAlive: boolean;
  gameOverText: Phaser.GameObjects.Text;
  restartText: Phaser.GameObjects.Text;
  spaceKey: Phaser.Input.Keyboard.Key;

  playerRenderers: Map<string, PlayerRenderer> = new Map();

  humanPlayer: PlayerState | null = null;

  gameClock: GameClock;
  gameRoom: GameRoom;

  debugHud: DebugHud;
  gameArea: GameArea;
  clientChannel: ClientChannel;
  bus: GameEventBus;

  tickOffset: number = -1; // Default minimum offset for latency

  lastFpsEmitTime: number = 0;
  gameAreaRenderer: GameAreaRenderer;

  constructor() {
    super('Game');
  }

  init() {
    this.CANVAS_WIDTH = this.scale.width;
    this.CANVAS_HEIGHT = this.scale.height;
    this.bus = new GameEventBus();
    this.gameArea = new GameArea(2000, 2000);
    this.gameClock = new GameClock(1000 / 60, 0);
    this.gameRoom = new GameRoom(this.bus, this.gameArea, this.gameClock);
    this.debugHud = new DebugHud(this);

    this.gameAreaRenderer = new GameAreaRenderer(this, this.gameArea);
  }

  preload() {
    this.load.setPath('assets');
  }

  create() {
    this.gameAreaRenderer.draw();
    this.setupSocket();

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
        listener.setPosition(
          this.CANVAS_WIDTH / 2,
          this.CANVAS_HEIGHT / 2,
          300
        );
        listener.setOrientation(0, 0, -1, 0, 1, 0);
      }
    }

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

    EventBus.on('game-over', (winner?: string) => {
      console.info('game-over');
      // Server should handle game-over, but for now we keep local UI
      this.isLocalPlayerAlive = false;
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

    EventBus.on('game-start', () => {
      console.info('game-start');
      const audioCtx = (this.sound as any).context as AudioContext;
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      // In multiplayer, restart should probably re-join or tell server to respawn
      this.isLocalPlayerAlive = true;

      // Hide game over text
      this.gameOverText.setVisible(false);
      this.restartText.setVisible(false);

      // Reset key states
      this.isKeyDown = {};
      this.gameClock.setTick(0);
      this.gameClock.resetAccumulator();
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
          if (this.humanPlayer) {
            this.humanPlayer.queueTurn(direction, this.gameClock.tick);

            this.clientChannel.emit(
              'client_turn',
              { direction, tick: this.gameClock.tick },
              { reliable: true }
            );
          }
        }
      });
      this.input.keyboard?.on(`keyup-${key}`, () => {
        this.isKeyDown[key] = false;
      });
    });
  }

  setupSocket() {
    // Connect to server (Vite runs on 8080, we target 3000 for backend)
    this.clientChannel = geckos({ port: 3000 });

    this.clientChannel.onConnect((error) => {
      if (error) {
        console.error(error.message);
        return;
      }
      console.log('Connected to server with ID:', this.clientChannel.id);

      this.clientChannel.emit('ping', performance.now());
    });

    setInterval(() => {
      this.clientChannel.emit('ping', performance.now());
    }, 3000);

    this.clientChannel.on('pong', (data: any) => {
      const oldTime = data;
      const pingDifferenceTime = performance.now() - oldTime;
      this.tickOffset = Math.ceil(pingDifferenceTime);
      console.info(
        `<pong> pingDifferenceTime: ${pingDifferenceTime.toFixed(2)}ms, Tick Offset: ${this.tickOffset}`
      );
      this.gameClock.setTick(this.gameClock.tick + this.tickOffset);
    });

    this.clientChannel.on('init_state', (data: any) => {
      console.log('<init_state>', data);
      const [_tick, _playerStateDTOList]: [number, PlayerStateDTO[]] = data;

      this.gameClock.setTick(data.tick + this.tickOffset);

      this.gameRoom.players.clear();

      // Recreate from state
      for (const _playerStateDTO of _playerStateDTOList) {
        const myP = new PlayerState(
          this.gameRoom.playerEventBus,
          this.gameClock.tick,
          0,
          0,
          0,
          0
        );
        myP.load(_playerStateDTO);

        this.gameRoom.registerPlayer(myP);
        this.playerRenderers.set(myP.id, new PlayerRenderer(this));

        if (_playerStateDTO.id === this.clientChannel.id) {
          this.humanPlayer = myP;
          this.debugHud.add('Rubber', this.humanPlayer, 'rubber');
          this.debugHud.add('Speed', this.humanPlayer, 'velocity');
          this.updateCameraView();
        }
      }

      console.debug(this.humanPlayer);
    });

    this.clientChannel.on('player_joined', (data: any) => {
      console.debug('<player_joined>', data);
      if (!this.gameRoom.players.has(data.id)) {
        const pData = data.state;
        const pState = new PlayerState(
          this.gameRoom.playerEventBus,
          data.tick,
          pData.x,
          pData.y,
          pData.direction,
          pData.color
        );
        pState.id = data.id;
        pState.rubber = pData.rubber;
        pState.isRunning = pData.isRunning;
        pState.speedMult = pData.speed;
        pState.targetSpeed = pData.targetSpeed;
        pState.velocity = pData.velocity;
        if (pData.trailLines) {
          pState.trailLines = pData.trailLines.map(
            (l: any) => new Phaser.Geom.Line(l.x1, l.y1, l.x2, l.y2)
          );
        }
        if (pData.previousLineEnd) {
          pState.previousLineEnd = new Phaser.Math.Vector2(
            pData.previousLineEnd.x,
            pData.previousLineEnd.y
          );
        }
        const player = this.gameRoom.registerPlayer(pState);
        const playerRenderer = new PlayerRenderer(this);
        this.playerRenderers.set(player.id, playerRenderer);
        playerRenderer.setVisible(true);
      }
    });

    this.clientChannel.on('player_left', (data: any) => {
      console.info('Player left', data.id);
      this.gameRoom.removePlayerById(data.id);
    });

    this.clientChannel.on('player_turn', (data: any) => {
      console.debug('<player_turn>', data);
      const [id, turnPointDTO] = data;

      if (id === this.clientChannel.id) return;
      const player = this.gameRoom.players.get(id);
      if (!player) throw new Error("can't handle turn");
      player.trail.fillTurn(PlayerPoint.fromDto(turnPointDTO));
      this.playerRenderers.get(player.id)!._playTurnSound(player);
    });

    this.clientChannel.on('player_death', (data: any) => {
      console.info('<player_death >', data);

      const [id]: [string] = data;
      const player = this.gameRoom.getPlayer(id);

      if (player) {
        player.disable();
      } else {
        throw new Error();
      }
    });

    this.clientChannel.on('player_spawn', (data: any) => {
      console.info('<player_spawn>', data);

      const [id, pState]: [string, PlayerStateDTO] = data;
      const player = this.gameRoom.getPlayer(id);
      if (player) {
        player.load(pState);
      } else {
        throw new Error();
      }
    });
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
        this.clientChannel.emit('respawn', undefined, { reliable: true });
        this.gameClock.setTick(0);
        this.gameClock.resetAccumulator();
        EventBus.emit('game-start');
      }
      return;
    }
    for (const [id, renderer] of this.playerRenderers) {
      renderer.render(this.gameRoom.getPlayer(id));
    }
    const ticksToProcess = this.gameClock.update(delta);
    for (let i = 0; i < ticksToProcess; i++) {
      if (this.gameClock.tick > 0) {
        // Simulate all players
        for (const [id, p] of this.gameRoom.players) {
          if (p.isRunning) {
            // Gather other trails
            let otherTrails: Phaser.Geom.Line[] = [];
            for (const [otherId, otherP] of this.gameRoom.players) {
              if (otherId !== id) {
                otherTrails = otherTrails.concat(otherP.trailLines);
                if (otherP.isRunning) {
                  otherTrails.push(otherP.currentLine);
                }
              }
            }

            p.update(
              this.gameClock.tick,
              this.gameRoom.getAllPlayers(),
              this.gameArea
            );
          }
        }
      }
    }

    // Debug HUD is throttled internally (~12 Hz) to avoid SolidJS reactivity spam
    this.debugHud.update(_time);

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
  }

  releaseKey(key: string) {
    this.isKeyDown[key] = false;
  }

  updateCameraView() {
    if (!this.humanPlayer) return;

    if (this.isCameraFollowing) {
      this.cameras.main.setBounds(
        0,
        0,
        this.gameArea.width,
        this.gameArea.height,
        true
      );
      this.cameras.main.setZoom(this.CANVAS_WIDTH / this.PLAYER_VIEW_WIDTH);
      this.cameras.main.startFollow(this.humanPlayer, true, 0.1, 0.1);
    } else {
      this.cameras.main.removeBounds();
      this.cameras.main.stopFollow();
      const zoomX = this.CANVAS_WIDTH / this.gameArea.width;
      const zoomY = this.CANVAS_HEIGHT / this.gameArea.height;
      this.cameras.main.setZoom(Math.min(zoomX, zoomY));
      this.cameras.main.centerOn(
        this.gameArea.width / 2,
        this.gameArea.height / 2
      );
    }
  }
}
