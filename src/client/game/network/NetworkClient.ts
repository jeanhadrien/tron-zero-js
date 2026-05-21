import geckos, { ClientChannel } from '@geckos.io/client';
import { trace } from '@opentelemetry/api';
import { GameEventBus } from '../../../shared/GameEventBus';
import GameClock from '../../../shared/GameClock';
import { Logger } from '../../../shared/Logger';
import ECSGameRoom from '../../../shared/ECSGameRoom';
import PlayerSystem from '../../../shared/ECSPlayerSystem';
import { ECSPlayerAdapter } from '../ECSPlayerAdapter';
import { decodeMessage, MSG_INIT_STATE, MSG_SYNC_STATE } from '../../../shared/NetworkProtocol';


const logger = new Logger('NET');
const tracer = trace.getTracer('tron-zero-client');

export class NetworkClient {
  channel: ClientChannel;
  bus: GameEventBus;
  gameRoom: ECSGameRoom;
  gameClock: GameClock;
  aheadTickCount: number = 1;
  humanPlayerId: string | null = null;
  private smoothedOneWayTime: number = 0;
  private static readonly RTT_SMOOTHING_ALPHA = 0.2;

  onInitState?: (humanPlayer: ECSPlayerAdapter | null, allPlayers: ECSPlayerAdapter[]) => void;
  onPlayerJoined?: (player: ECSPlayerAdapter) => void;
  onPlayerLeft?: (playerId: string) => void;
  onPlayerTurn?: (player: ECSPlayerAdapter) => void;
  onPlayerDeath?: (player: ECSPlayerAdapter) => void;
  onPlayerSpawn?: (player: ECSPlayerAdapter) => void;

  constructor(bus: GameEventBus, gameRoom: ECSGameRoom, gameClock: GameClock) {
    this.bus = bus;
    this.gameRoom = gameRoom;
    this.gameClock = gameClock;
  }

  private logSync(tick: number | string, eventName: string, ..._args: any[]) {
    const tickStr = String(tick).padStart(8, ' ');
    const eventStr = eventName.padEnd(15, ' ');
    logger.info(`[SYNC] tick: ${tickStr} | event: ${eventStr} |`);
  }

  private buildPlayerAdapters(): ECSPlayerAdapter[] {
    const world = this.gameRoom.world;
    const eids = PlayerSystem.getAllPlayerEids(world);
    return eids.map((eid) => new ECSPlayerAdapter(eid, world));
  }

  private handleInitState(tick: number, snapshot: ArrayBuffer): void {
    const initSpan = tracer.startSpan('init_state');
    initSpan.setAttribute('tick', tick);

    this.logSync(tick, 'init_state');

    this.gameRoom.initFromSnapshot(tick, snapshot);
    this.gameClock.setTick(tick);

    const allPlayers = this.buildPlayerAdapters();
    const humanEid = this.humanPlayerId
      ? PlayerSystem.getPlayerEidByStringId(this.gameRoom.world, this.humanPlayerId)
      : -1;
    const humanPlayer = humanEid >= 0 ? (allPlayers.find((p) => p.eid === humanEid) ?? null) : null;

    if (this.onInitState) {
      this.onInitState(humanPlayer, allPlayers);
    }

    initSpan.end();
  }

  private handleSyncState(tick: number, data: ArrayBuffer, struct: ArrayBuffer): void {
    this.logSync(tick, 'sync_state', `dataLen=${data.byteLength} structLen=${struct.byteLength}`);
    this.gameRoom.addNetworkDiffPayload({ tick, data, struct });
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
      this.humanPlayerId = this.channel.id!;

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

      this.smoothedOneWayTime =
        this.smoothedOneWayTime === 0
          ? oneWayTime
          : this.smoothedOneWayTime * (1 - NetworkClient.RTT_SMOOTHING_ALPHA) +
            oneWayTime * NetworkClient.RTT_SMOOTHING_ALPHA;

      logger.warn(
        this.gameClock.tick,
        'pong',
        `RTT: ${pingDifferenceTime.toFixed(2)}ms, One-way: ${oneWayTime.toFixed(2)}ms`
      );
    });

    this.channel.onRaw((raw: any) => {
      const msg = decodeMessage(raw);
      if (msg.type === MSG_INIT_STATE) {
        this.handleInitState(msg.tick, msg.snapshot);
      } else if (msg.type === MSG_SYNC_STATE) {
        this.handleSyncState(msg.tick, msg.data, msg.struct);
      }
    });

    this.channel.on('game_add_player', (raw: any) => {
      const [id] = raw as [string];
      this.logSync(this.gameClock.tick, 'game_add_player', raw);
      const eid = PlayerSystem.getPlayerEidByStringId(this.gameRoom.world, id);
      if (eid >= 0) {
        const adapter = new ECSPlayerAdapter(eid, this.gameRoom.world);
        if (this.onPlayerJoined) {
          this.onPlayerJoined(adapter);
        }
      }
    });

    this.channel.on('game_remove_player', (raw: any) => {
      const [id] = raw as [string];
      this.logSync(this.gameClock.tick, 'game_remove_player', id);
      if (this.onPlayerLeft) {
        this.onPlayerLeft(id);
      }
    });

    this.channel.on('player_turn', (raw: any) => {
      const [id] = raw as [string];
      this.logSync(this.gameClock.tick, 'player_turn', raw);
      const eid = PlayerSystem.getPlayerEidByStringId(this.gameRoom.world, id);
      if (eid >= 0) {
        const adapter = new ECSPlayerAdapter(eid, this.gameRoom.world);
        if (this.onPlayerTurn) {
          this.onPlayerTurn(adapter);
        }
      }
    });

    this.channel.on('player_death', (raw: any) => {
      const [id] = raw as [string];
      this.logSync(this.gameClock.tick, 'player_death', raw);
      const eid = PlayerSystem.getPlayerEidByStringId(this.gameRoom.world, id);
      if (eid >= 0) {
        const adapter = new ECSPlayerAdapter(eid, this.gameRoom.world);
        if (this.onPlayerDeath) {
          this.onPlayerDeath(adapter);
        }
      }
    });

    this.channel.on('player_spawn', (raw: any) => {
      const [id] = raw as [string];
      this.logSync(this.gameClock.tick, 'player_spawn', raw);
      const eid = PlayerSystem.getPlayerEidByStringId(this.gameRoom.world, id);
      if (eid >= 0) {
        const adapter = new ECSPlayerAdapter(eid, this.gameRoom.world);
        if (this.onPlayerSpawn) {
          this.onPlayerSpawn(adapter);
        }
      }
    });
  }

  sendTurn(tick: number, direction: 'left' | 'right') {
    if (this.channel) {
      const turnSpan = tracer.startSpan('player.turn.send');
      turnSpan.setAttribute('tick', tick);

      // Add input to local simulation
      if (this.humanPlayerId) {
        this.gameRoom.addInput(tick, this.humanPlayerId, { turn: direction, break: false });
      }

      this.logSync(tick, 'client_turn', { tick, turn: direction });
      this.channel.emit('client_turn', { tick, turn: direction }, { reliable: false });

      turnSpan.end();
    }
  }

  sendRespawn() {
    if (this.channel) {
      this.logSync(this.gameClock.tick, 'respawn');
      this.channel.emit('respawn', [this.gameClock.tick], { reliable: true });
    }
  }
}
