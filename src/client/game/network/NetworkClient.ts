import geckos, { ClientChannel } from '@geckos.io/client';
import { GameEventBus } from '../../../shared/GameEventBus';
import GameClock from '../../../shared/GameClock';
import GameRoom from '../../../shared/GameRoom';
import PlayerStateDTO from '../../../shared/PlayerStateDTO';
import { PlayerPoint } from '../../../shared/PlayerPoint';
import PlayerState from '../../../shared/PlayerState';

export class NetworkClient {
  channel: ClientChannel;
  bus: GameEventBus;
  gameRoom: GameRoom;
  gameClock: GameClock;
  tickOffset: number = 1;
  turnBuffer: any[] = [];

  // We need to emit some events back to the scene, or just handle gameRoom updates here.
  // For pure separation without logic changes, we'll keep the exact same logic
  // but move it here. We'll need a way to notify the scene about humanPlayer, etc.
  onInitState?: (
    humanPlayer: PlayerState | null,
    allPlayers: PlayerState[]
  ) => void;
  onPlayerJoined?: (player: PlayerState) => void;
  onPlayerLeft?: (playerId: string) => void;
  onPlayerTurn?: (player: PlayerState) => void; // for sound
  onPlayerDeath?: (player: PlayerState) => void;
  onPlayerSpawn?: (player: PlayerState) => void;

  constructor(bus: GameEventBus, gameRoom: GameRoom, gameClock: GameClock) {
    this.bus = bus;
    this.gameRoom = gameRoom;
    this.gameClock = gameClock;
  }

  private logSync(tick: number | string, eventName: string, ...args: any[]) {
    const tickStr = String(tick).padStart(8, ' ');
    const eventStr = eventName.padEnd(15, ' ');
    console.info(`[SYNC] tick: ${tickStr} | event: ${eventStr} |`, ...args);
  }

  connect() {
    this.channel = geckos({ 
      url: window.location.origin,
      port: window.location.port ? parseInt(window.location.port) : (window.location.protocol === 'https:' ? 443 : 80)
    });

    this.channel.onConnect((error) => {
      if (error) {
        console.error(error.message);
        return;
      }
      console.log('Connected to server with ID:', this.channel.id);

      this.channel.emit('ping', performance.now());
    });

    setInterval(() => {
      if (this.channel) {
        this.channel.emit('ping', performance.now());
      }
    }, 3000);

    this.channel.on('pong', (data: any) => {
      const oldTime = data;
      const pingDifferenceTime = performance.now() - oldTime;
      // We only care about one-way trip time to figure out what tick the server is actually on
      const oneWayTime = pingDifferenceTime / 2;
      this.tickOffset = Math.ceil(oneWayTime / this.gameClock.tickTimeMs);
      this.logSync(
        this.gameClock.tick,
        'pong',
        `RTT: ${pingDifferenceTime.toFixed(2)}ms, One-way: ${oneWayTime.toFixed(2)}ms, Tick Offset: ${this.tickOffset}`
      );
    });

    this.channel.on('init_state', (data: any) => {
      const [_tick, _playerStateDTOList]: [number, PlayerStateDTO[]] = data;
      this.logSync(_tick, 'init_state', data);

      this.gameClock.setTick(_tick + this.tickOffset);

      this.gameRoom.playerManagers.clear();

      let humanPlayer: PlayerState | null = null;

      let allPlayers: PlayerState[] = [];

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
        allPlayers.push(myP);

        if (_playerStateDTO.id === this.channel.id) {
          humanPlayer = myP;
        }
      }

      if (this.onInitState) {
        this.onInitState(humanPlayer, allPlayers);
      }
    });

    this.channel.on('sync_state', (data: any) => {
      const [serverTick, playerStateDTOList]: [number, PlayerStateDTO[]] = data;
      this.logSync(serverTick, 'sync_state', data);
      
      // Clear acknowledged turns from our sliding window buffer
      this.turnBuffer = this.turnBuffer.filter((t) => t.tick >= serverTick);

      // If we fell significantly behind (e.g. tab was backgrounded/alt-tabbed)
      if (serverTick > this.gameClock.tick + 2) {
        console.warn(
          `[Desync] Local clock fell behind. Snapping to server tick.`
        );
        this.gameClock.setTick(serverTick + this.tickOffset);
        this.gameClock.resetAccumulator();

        for (const playerStateDTO of playerStateDTOList) {
          const manager = this.gameRoom.playerManagers.get(playerStateDTO.id);
          if (manager) {
            manager.activeState.load(playerStateDTO);
            manager.activeState.currentTick = serverTick; // Ensure they don't try to update from the past
          }
        }
        return; // Complete the sync directly, skip normal interpolation check
      }

      for (const playerStateDTO of playerStateDTOList) {
        const manager = this.gameRoom.playerManagers.get(playerStateDTO.id);
        if (manager && manager.id !== this.channel.id) {
          // Compare against historical state at serverTick, not activeState
          const historicalState = manager.__getHydratedStateAtTick(serverTick);

          // If drift is too large, snap them. Otherwise let them be.
          const dx = historicalState.x - playerStateDTO.x;
          const dy = historicalState.y - playerStateDTO.y;
          const distSq = dx * dx + dy * dy;

          if (distSq > 50 * 50) {
            // If they drifted by more than 50 units
            console.warn(
              `[Desync Detected] Snapping player ${manager.activeState.id} back to server state`
            );

            // We load their state exactly, but because they are in the past (serverTick vs localTick)
            // we must fast forward them to our local present time so they aren't visually dragging behind.
            const allManagers = Array.from(
              this.gameRoom.playerManagers.values()
            );
            manager.fastForwardFromPastState(
              playerStateDTO,
              serverTick,
              this.gameClock,
              this.gameRoom.area,
              allManagers
            );
          }
        }
      }
    });

    this.channel.on('player_joined', (data: any) => {
      this.logSync(data.tick || this.gameClock.tick, 'player_joined', data);
      if (!this.gameRoom.playerManagers.has(data.id)) {
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
        pState.targetSpeedMult = pData.targetSpeed;
        pState.velocity = pData.velocity;

        const player = this.gameRoom.registerPlayer(pState);
        if (this.onPlayerJoined) {
          this.onPlayerJoined(player);
        }
      }
    });

    this.channel.on('player_left', (data: any) => {
      this.logSync(this.gameClock.tick, 'player_left', data.id);
      this.gameRoom.removePlayerById(data.id);
      if (this.onPlayerLeft) {
        this.onPlayerLeft(data.id);
      }
    });

    this.channel.on('player_turn', (data: any) => {
      const [id, turnPointDTO] = data;
      this.logSync(
        turnPointDTO.tick || this.gameClock.tick,
        'player_turn',
        data
      );

      // If it's our own turn coming back from the server, we can clear it from our buffer
      if (id === this.channel.id) {
        this.turnBuffer = this.turnBuffer.filter((t) => t.tick > turnPointDTO.tick);
      }

      const manager = this.gameRoom.playerManagers.get(id);
      if (!manager) throw new Error("can't handle turn");
      const turnPoint = PlayerPoint.fromDto(turnPointDTO);

      // Use the newly standard reconcileTurns
      const allManagers = Array.from(this.gameRoom.playerManagers.values());
      manager.reconcileTurns(
        [turnPoint],
        this.gameClock,
        this.gameRoom.area,
        allManagers
      );

      if (this.onPlayerTurn) {
        this.onPlayerTurn(manager.activeState);
      }
    });

    this.channel.on('player_death', (data: any) => {
      const [id]: [string] = data;
      this.logSync(this.gameClock.tick, 'player_death', data);

      const player = this.gameRoom.getPlayer(id);

      if (player) {
        player.disable();
        if (this.onPlayerDeath) {
          this.onPlayerDeath(player);
        }
      } else {
        throw new Error();
      }
    });

    this.channel.on('player_spawn', (data: any) => {
      const [id, pState]: [string, PlayerStateDTO] = data;
      this.logSync(this.gameClock.tick, 'player_spawn', data);

      const player = this.gameRoom.getPlayer(id);
      if (player) {
        player.load(pState);
        const manager = this.gameRoom.playerManagers.get(id);
        if (manager) {
          manager.history.clear();
          manager.knownTurns = [];
        }
        if (this.onPlayerSpawn) {
          this.onPlayerSpawn(player);
        }
      } else {
        throw new Error();
      }
    });
  }

  sendTurn(turnPointDTO: any) {
    if (this.channel) {
      this.turnBuffer.push(turnPointDTO);
      if (this.turnBuffer.length > 20) {
        this.turnBuffer.shift();
      }

      this.logSync(
        turnPointDTO.tick || this.gameClock.tick,
        'client_turn',
        this.turnBuffer
      );
      this.channel.emit('client_turn', this.turnBuffer, {
        reliable: false,
      });
    }
  }

  sendRespawn() {
    if (this.channel) {
      this.logSync(this.gameClock.tick, 'respawn');
      this.channel.emit('respawn', undefined, { reliable: true });
    }
  }
}
