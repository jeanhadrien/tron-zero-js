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

  // We need to emit some events back to the scene, or just handle gameRoom updates here.
  // For pure separation without logic changes, we'll keep the exact same logic
  // but move it here. We'll need a way to notify the scene about humanPlayer, etc.
  onInitState?: (
    humanPlayer: PlayerState | null,
    allPlayers: PlayerState[]
  ) => void;
  onPlayerJoined?: (player: PlayerState) => void;
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
    this.channel = geckos({ port: 3000 });

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

      this.gameRoom.players.clear();

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

      // If we fell significantly behind (e.g. tab was backgrounded/alt-tabbed)
      if (serverTick > this.gameClock.tick + 2) {
        console.warn(
          `[Desync] Local clock fell behind. Snapping to server tick.`
        );
        this.gameClock.setTick(serverTick + this.tickOffset);
        this.gameClock.resetAccumulator();

        for (const playerStateDTO of playerStateDTOList) {
          const player = this.gameRoom.players.get(playerStateDTO.id);
          if (player) {
            player.load(playerStateDTO);
            player.currentTick = serverTick; // Ensure they don't try to update from the past
          }
        }
        return; // Complete the sync directly, skip normal interpolation check
      }

      for (const playerStateDTO of playerStateDTOList) {
        const player = this.gameRoom.players.get(playerStateDTO.id);
        if (player && player.id !== this.channel.id) {
          // If drift is too large, snap them. Otherwise let them be.
          const dx = player.x - playerStateDTO.x;
          const dy = player.y - playerStateDTO.y;
          const distSq = dx * dx + dy * dy;

          if (distSq > 50 * 50) {
            // If they drifted by more than 50 units
            console.warn(
              `[Desync Detected] Snapping player ${player.id} back to server state`
            );

            // We load their state exactly, but because they are in the past (serverTick vs localTick)
            // we must fast forward them to our local present time so they aren't visually dragging behind.
            player.load(playerStateDTO);

            const ticksBehind = this.gameClock.tick - serverTick;
            if (ticksBehind > 0) {
              const allPlayers = this.gameRoom.getAllPlayers();
              for (let i = 0; i < ticksBehind; i++) {
                player.update(
                  serverTick + i + 1,
                  allPlayers,
                  this.gameRoom.area,
                  this.gameClock
                );
              }
            }
          }
        }
      }
    });

    this.channel.on('player_joined', (data: any) => {
      this.logSync(data.tick || this.gameClock.tick, 'player_joined', data);
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
    });

    this.channel.on('player_turn', (data: any) => {
      const [id, turnPointDTO] = data;
      this.logSync(
        turnPointDTO.tick || this.gameClock.tick,
        'player_turn',
        data
      );

      const player = this.gameRoom.players.get(id);
      if (!player) throw new Error("can't handle turn");
      const turnPoint = PlayerPoint.fromDto(turnPointDTO);

      // Use the newly standard applyRemoteTurn
      const allPlayers = this.gameRoom.getAllPlayers();
      player.applyRemoteTurn(
        turnPoint,
        this.gameClock,
        this.gameRoom.area,
        allPlayers
      );

      if (this.onPlayerTurn) {
        this.onPlayerTurn(player);
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
      this.logSync(
        turnPointDTO.tick || this.gameClock.tick,
        'client_turn',
        turnPointDTO
      );
      this.channel.emit('client_turn', [turnPointDTO], {
        reliable: true,
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
