import { ClientChannel, geckos } from '@geckos.io/client';
import { eventGetter, inputGetter, System } from '../../../shared/ECSSystem';
import { RoomLogger } from '../../../shared/otel/Logger';
import { ConnectionError, Data } from '@geckos.io/common/lib/types';
import { decodeMessage, MSG_INIT_STATE, MSG_SYNC_STATE } from '../../../shared/NetworkProtocol';
import { ECSGameRoom } from '../../../shared/ECSGameRoom';
import PlayerSystem from '../../../shared/systems/ECSPlayerSystem';
import { PlayerInput } from '../../../shared/PlayerInput';
import { GameEvent, GameEventType } from '../../../shared/GameEvent';

export const logger = new RoomLogger('ClientNetworkSystem');

export class ClientNetworkSystem extends System {
  readonly key = 'client-network';
  private static readonly RTT_SMOOTHING_ALPHA = 0.2;

  channel: ClientChannel;
  private smoothedOneWayTime: number = 0;
  private room: ECSGameRoom;

  constructor() {
    super();
    this.channel = geckos({
      url: `${window.location.protocol}//${window.location.hostname}`,
      iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }],
      port: 3000,
    });
  }

  getComponents(): object[] {
    return [];
  }

  init?(room: ECSGameRoom): void {
    this.room = room;
    logger.setRoom(room);

    this.channel.onConnect((error) => this.onConnection(error));
    this.channel.on('pong', (data) => this.onPong(data));
    this.channel.onRaw((data) => this.onRaw(data));

    setInterval(() => {
      this.channel.emit('ping', performance.now());
    }, 3000);

    this.channel.emit('ping', performance.now());
  }

  private onRaw(data: Data) {
    const msg = decodeMessage(data as ArrayBuffer);

    switch (msg.type) {
      case MSG_INIT_STATE:
        this.onInitState(msg.tick, msg.snapshot);
        break;
      case MSG_SYNC_STATE:
        this.onSyncState(msg.tick, msg.data, msg.struct);
        break;
      default:
        throw new Error('Unknown message');
    }
  }

  private onSyncState(tick: number, data: ArrayBuffer, struct: ArrayBuffer) {
    logger.debug('Received sync state');

    if (this.smoothedOneWayTime) {
      const targetOffsetTicks = Math.ceil(this.smoothedOneWayTime / this.room.gameClock.referenceTickTimeMs);
      const targetTick = tick + targetOffsetTicks;
      const tickError = targetTick - this.room.tick;
      const GAIN = 0.5;
      this.room.gameClock.tickTimeMs = this.room.gameClock.referenceTickTimeMs - tickError * GAIN;
    }

    this.room.addNetworkDiffPayload({
      tick,
      data,
      struct,
    });
  }

  private onInitState(tick: number, snapshot: ArrayBuffer) {
    logger.info('Received init state');

    this.room.initFromSnapshot(tick, snapshot);
    this.room.gameClock.tick = tick;

    this.room.localPlayerEid = PlayerSystem.getPlayerEidByStringId(this.room, this.channel.id!);
    this.room.localPlayerId = this.channel.id!;

    logger.warn(this.room.tick, 'Player ready — eid:', this.room.localPlayerEid, 'id:', this.room.localPlayerId);
  }

  private onPong(data: Data) {
    const oldTime = data as number;
    const pingDifferenceTime = performance.now() - oldTime;
    const oneWayTime = pingDifferenceTime / 2;

    this.smoothedOneWayTime =
      this.smoothedOneWayTime === 0
        ? oneWayTime
        : this.smoothedOneWayTime * (1 - ClientNetworkSystem.RTT_SMOOTHING_ALPHA) +
          oneWayTime * ClientNetworkSystem.RTT_SMOOTHING_ALPHA;

    logger.warn(this.room.tick, 'pong', `RTT: ${pingDifferenceTime.toFixed(2)}ms, One-way: ${oneWayTime.toFixed(2)}ms`);
  }

  requestInitState(): void {
    logger.info('Requesting init state from server');
    this.room.gameClock.resetAccumulator();
    this.channel.emit('request_init');
  }

  /** Queue an input locally for client prediction and relay it to the server. */
  sendInput(obj: { tick: number; turn?: 'left' | 'right'; break?: boolean }): void {
    if (!this.room?.localPlayerId) return;

    const playerInput: PlayerInput = {
      tick: obj.tick,
      playerId: this.room.localPlayerId,
      turn: obj.turn,
      break: obj.break ?? false,
    };

    // Add locally so client-side prediction processes the turn
    //this.room.addInput(playerInput);

    // Relay to the server for authoritative processing
    this.channel.emit('client_turn', [{ tick: obj.tick, turn: obj.turn }]);

    logger.warn('SENT turn:', obj.turn, 'at tick:', obj.tick);
  }

  sendRespawn(): void {
    if (!this.room?.localPlayerId) return;

    const playerRespawn: GameEvent = {
      tick: this.room.tick,
      playerId: this.room.localPlayerId,
      type: GameEventType.PlayerSpawn,
    };

    // Relay to the server for authoritative processing
    this.channel.emit('respawn', [playerRespawn]);

    logger.warn('SENT respawn:', playerRespawn.tick);
  }

  update(getInput: inputGetter, getEvents: eventGetter): void {
    return;
  }

  private onConnection(error: ConnectionError | undefined): void {
    if (error) {
      throw new Error(error.message);
    }
    logger.info('Connected to server with ID:', this.channel.id);
    this.channel.emit('ping', performance.now());
  }
}
