import geckos, { ClientChannel } from '@geckos.io/client';
import { trace } from '@opentelemetry/api';
import { GameEventBus } from '../../../shared/GameEventBus';
import GameClock from '../../../shared/GameClock';
import GameRoom from '../../../shared/GameRoom';
import { PlayerDTO } from '../../../shared/Player';
import { PlayerPoint } from '../../../shared/PlayerPoint';
import Player from '../../../shared/Player';
import PlayerPointDTO from '../../../shared/PlayerPointDTO';
import { TickRingBuffer } from '../../../shared/TickRingBuffer';
import { Logger } from '../../../shared/Logger';
import ECSGameRoom from '../../../shared/ECSGameRoom';

const logger = new Logger('NET');
const tracer = trace.getTracer('tron-zero-client');

export class NetworkClient {
  channel: ClientChannel;
  bus: GameEventBus;
  gameRoom: ECSGameRoom;
  gameClock: GameClock;
  tickOffsetToCatchServer: number = 0;
  aheadTickCount: number = 1;
  turnBuffer = new TickRingBuffer<PlayerPointDTO>(60);
  private lastAckedTurnTick: number = -1;
  private smoothedOneWayTime: number = 0;
  private hasRttMeasurement: boolean = false;
  private static readonly RTT_SMOOTHING_ALPHA = 0.2;

  // We need to emit some events back to the scene, or just handle gameRoom updates here.
  // For pure separation without logic changes, we'll keep the exact same logic
  // but move it here. We'll need a way to notify the scene about humanPlayer, etc.
  onInitState?: (humanPlayer: Player | null, allPlayers: Player[]) => void;
  onPlayerJoined?: (player: Player) => void;
  onPlayerLeft?: (playerId: string) => void;
  onPlayerTurn?: (player: Player) => void; // for sound
  onPlayerDeath?: (player: Player) => void;
  onPlayerSpawn?: (player: Player) => void;

  constructor(bus: GameEventBus, gameRoom: ECSGameRoom, gameClock: GameClock) {
    this.bus = bus;
    this.gameRoom = gameRoom;
    this.gameClock = gameClock;
  }

  private logSync(tick: number | string, eventName: string, ...args: any[]) {
    const tickStr = String(tick).padStart(8, ' ');
    const eventStr = eventName.padEnd(15, ' ');
    logger.info(`[SYNC] tick: ${tickStr} | event: ${eventStr} |`);
  }

  connect() {
    const connectSpan = tracer.startSpan('webrtc.connect');
    connectSpan.setAttribute('hostname', window.location.hostname);

    this.channel = geckos({
      url: `${window.location.protocol}//${window.location.hostname}`,
      iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }],
      port: 3000,
    });

    connectSpan.end();

    this.channel.onConnect((error) => {
      if (error) {
        logger.error(error.message);
        return;
      }
      logger.info('Connected to server with ID:', this.channel.id);

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
      const oneWayTime = pingDifferenceTime / 2;

      this.tickOffsetToCatchServer = Math.ceil(oneWayTime / this.gameClock.tickTimeMs);
      logger.warn(
        this.gameClock.tick,
        'pong',
        `RTT: ${pingDifferenceTime.toFixed(2)}ms, One-way: ${oneWayTime.toFixed(2)}ms,  Tick Offset: ${this.tickOffsetToCatchServer}`
      );
    });

    this.channel.on('init_state', (data: any) => {
      const [_serverTick, _playerStateDTOList]: [number, PlayerDTO[]] = data;

      const initSpan = tracer.startSpan('init_state');
      initSpan.setAttribute('tick', _serverTick);
      initSpan.setAttribute('player_count', _playerStateDTOList.length);

      this.logSync(_serverTick, 'init_state', data);

      const expectedClientTick = _serverTick + this.tickOffsetToCatchServer + this.aheadTickCount;

      this.gameClock.setTick(expectedClientTick);

      this.gameRoom.playerManagers.clear();

      let humanPlayer: Player | null = null;

      let allPlayers: Player[] = [];

      // Recreate from state
      for (const _playerStateDTO of _playerStateDTOList) {
        const p = new Player(this.gameRoom.playerEventBus, this.gameClock.tick, 0, 0, 0, 0);
        p.load(_playerStateDTO);

        this.gameRoom.registerPlayer(p);
        allPlayers.push(p);

        if (_playerStateDTO.id === this.channel.id) {
          humanPlayer = p;
        }
      }

      if (this.onInitState) {
        this.onInitState(humanPlayer, allPlayers);
      }

      initSpan.end();
    });

    this.channel.on('sync_state', (data: any) => {
      const [_serverTick, _playerId, _playerStateDTO]: [number, string, PlayerDTO] = data;

      const syncSpan = tracer.startSpan('sync_state');
      syncSpan.setAttribute('tick', _serverTick);

      this.logSync(_serverTick, 'sync_state', data);

      this.lastAckedTurnTick = Math.max(this.lastAckedTurnTick, _serverTick - 1);

      const expectedClientTick = _serverTick + this.tickOffsetToCatchServer + this.aheadTickCount;
      const drift = expectedClientTick - this.gameClock.tick;

      if (drift !== 0) {
        syncSpan.setAttribute('drift_ticks', drift);
        logger.warn(`[Desync] Local clock late by ${drift} ticks. Snapping to expected tick.`);
        this.gameClock.setTick(expectedClientTick);
        this.gameClock.resetAccumulator();

        const allManagers = Array.from(this.gameRoom.playerManagers.values());
        const manager = this.gameRoom.playerManagers.get(_playerId);
        if (manager) {
          manager.activeState.currentTick = this.gameClock.tick;

          manager.fastForwardFromPastState(_playerStateDTO, _serverTick, this.gameClock, this.gameRoom.gameArea, allManagers);
        }
        syncSpan.end();
        return;
      }

      syncSpan.end();
    });

    this.channel.on('game_add_player', (data: any) => {
      const [id, pStateDTO] = data;
      this.logSync(this.gameClock.tick, 'game_add_player', data);
      if (!this.gameRoom.playerManagers.has(id)) {
        const pState = new Player(
          this.gameRoom.playerEventBus,
          this.gameClock.tick,
          pStateDTO.x,
          pStateDTO.y,
          pStateDTO.direction,
          pStateDTO.color
        );
        pState.load(pStateDTO);

        const player = this.gameRoom.registerPlayer(pState);
        if (this.onPlayerJoined) {
          this.onPlayerJoined(player);
        }
      }
    });

    this.channel.on('game_remove_player', (data: any) => {
      const [id] = data;
      this.logSync(this.gameClock.tick, 'game_remove_player', id);
      this.gameRoom.removePlayerById(id);
      if (this.onPlayerLeft) {
        this.onPlayerLeft(id);
      }
    });

    this.channel.on('player_turn', (data: any) => {
      const [id, turnPointDTO] = data;
      this.logSync(turnPointDTO.tick || this.gameClock.tick, 'player_turn', data);

      const turnSpan = tracer.startSpan('player.turn.receive');
      turnSpan.setAttribute('player.id', id);
      turnSpan.setAttribute('tick', turnPointDTO.tick);

      // If it's our own turn coming back from the server, ack it
      if (id === this.channel.id) {
        this.lastAckedTurnTick = Math.max(this.lastAckedTurnTick, turnPointDTO.tick);
      }

      const manager = this.gameRoom.playerManagers.get(id);
      if (!manager) throw new Error("can't handle turn");
      const turnPoint = PlayerPoint.fromDto(turnPointDTO);

      // Use the newly standard reconcileTurns
      const allManagers = Array.from(this.gameRoom.playerManagers.values());
      manager.reconcileTurns([turnPoint], allManagers);

      turnSpan.end();

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
      const [id, pState]: [string, PlayerDTO] = data;
      this.logSync(this.gameClock.tick, 'player_spawn', data);

      const player = this.gameRoom.getPlayer(id);
      if (player) {
        player.load(pState);
        const manager = this.gameRoom.playerManagers.get(id);
        if (manager) {
          manager.history.clear();
          manager.knownPlayerPoints = new TickRingBuffer<PlayerPoint>(128);
          manager.previousState = null;
          manager.correctionTarget = null;
        }
        if (this.onPlayerSpawn) {
          this.onPlayerSpawn(player);
        }
      } else {
        throw new Error();
      }
    });
  }

  sendTurn(turnPointDTO: PlayerPointDTO) {
    if (this.channel) {
      this.turnBuffer.record(turnPointDTO.tick, 'self', turnPointDTO);

      const turnSpan = tracer.startSpan('player.turn.send');
      turnSpan.setAttribute('tick', turnPointDTO.tick || this.gameClock.tick);

      const unacked = this.turnBuffer.getUnacked(this.lastAckedTurnTick, 'self');
      // getUnacked does gap-filling, so dedupe by entry tick
      const seenTicks = new Set<number>();
      const toSend: PlayerPointDTO[] = [];
      for (const entry of unacked) {
        if (entry !== null && !seenTicks.has(entry.tick)) {
          seenTicks.add(entry.tick);
          toSend.push(entry);
        }
      }

      turnSpan.setAttribute('buffer_size', toSend.length);

      this.logSync(turnPointDTO.tick || this.gameClock.tick, 'client_turn', toSend);
      this.channel.emit('client_turn', toSend, {
        reliable: false,
      });

      turnSpan.end();
    }
  }

  sendRespawn() {
    if (this.channel) {
      this.logSync(this.gameClock.tick, 'respawn');
      this.channel.emit('respawn', undefined, { reliable: true });
    }
  }
}
