import geckos, { ClientChannel, Data } from '@geckos.io/client';
import { trace } from '@opentelemetry/api';
import { GameEventBus } from '../../../shared/GameEventBus';
import GameClock from '../../../shared/GameClock';
import { Logger } from '../../../shared/Logger';
import ECSGameRoom from '../../../shared/ECSGameRoom';
import PlayerSystem, { Position, PlayerId } from '../../../shared/ECSPlayerSystem';
import { decodeMessage, MSG_INIT_STATE, MSG_SYNC_STATE } from '../../../shared/NetworkProtocol';

const logger = new Logger('NetworkClient');
const tracer = trace.getTracer('tron-zero-client');

export interface PlayerMeta {
  eid: number;
  id: string;
}

export interface PlayerPosition {
  x: number;
  y: number;
}

export class NetworkClient {
  channel: ClientChannel;
  bus: GameEventBus;
  gameRoom: ECSGameRoom;
  gameClock: GameClock;
  aheadTickCount: number = 1;
  humanPlayerId: string | null = null;
  private smoothedOneWayTime: number = 0;
  private static readonly RTT_SMOOTHING_ALPHA = 0.2;

  onInitState?: (humanPlayer: PlayerMeta | null, allPlayers: PlayerMeta[]) => void;
  onPlayerJoined?: (player: PlayerMeta) => void;
  onPlayerLeft?: (playerId: string) => void;
  onPlayerTurn?: (player: PlayerPosition) => void;
  onPlayerDeath?: (player: PlayerMeta) => void;
  onPlayerSpawn?: (player: PlayerMeta) => void;

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

  private buildPlayerMeta(): PlayerMeta[] {
    const world = this.gameRoom.world;
    const eids = PlayerSystem.getAllPlayerEids(world);
    return eids.map((eid) => ({
      eid,
      id: PlayerId[eid],
    }));
  }

  private handleInitState(tick: number, snapshot: ArrayBuffer): void {
    const initSpan = tracer.startSpan('init_state');
    initSpan.setAttribute('tick', tick);

    this.logSync(tick, 'init_state');

    this.gameRoom.initFromSnapshot(tick, snapshot);
    this.gameClock.setTick(tick);

    const allPlayers = this.buildPlayerMeta();
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

    this.channel.onRaw((raw: Data) => {
      if (!(raw instanceof ArrayBuffer)) {
        throw new Error('?');
      }
      const msg = decodeMessage(raw);
      if (msg.type === MSG_INIT_STATE) {
        this.handleInitState(msg.tick, msg.snapshot);
      } else if (msg.type === MSG_SYNC_STATE) {
        this.handleSyncState(msg.tick, msg.data, msg.struct);
      }
    });
  }

  sendTurn(tick: number, direction: 'left' | 'right') {
    if (this.channel) {
      const turnSpan = tracer.startSpan('player.turn.send');
      turnSpan.setAttribute('tick', tick);

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
