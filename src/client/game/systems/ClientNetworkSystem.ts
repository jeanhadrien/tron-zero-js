import { ClientChannel, geckos } from '@geckos.io/client';
import { eventGetter, inputGetter, System } from '../../../shared/ECSSystem';
import { Logger, RoomLogger } from '../../../shared/otel/Logger';
import { ConnectionError, Data } from '@geckos.io/common/lib/types';
import { decodeMessage, MSG_INIT_STATE, MSG_SYNC_STATE } from '../../../shared/NetworkProtocol';
import { ECSGameRoom } from '../../../shared/ECSGameRoom';
import PlayerSystem from '../../../shared/systems/ECSPlayerSystem';

export const logger = new RoomLogger('ClientNetworkSystem');

export class ClientNetworkSystem extends System {
  readonly key = 'client-network';
  private static readonly RTT_SMOOTHING_ALPHA = 0.2;

  private channel: ClientChannel;
  private smoothedOneWayTime: number = 0;
  private room: ECSGameRoom;
  clientPlayerEid: number;
  clientPlayerId: string;

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

    this.clientPlayerEid = PlayerSystem.getPlayerEidByStringId(this.room, this.channel.id!);
    this.clientPlayerId = this.channel.id!;
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

  sendInput(obj: any): void {}

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
