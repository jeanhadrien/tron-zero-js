import { ClientChannel, geckos } from '@geckos.io/client';
import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import { RoomLogger } from '@tron0/shared/otel/Logger';
import { ConnectionError, Data } from '@geckos.io/common/lib/types';
import { decodeMessage, MSG_INIT_STATE, MSG_SYNC_STATE } from '@tron0/shared/NetworkProtocol';
import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import PlayerSystem from '@tron0/shared/systems/PlayerSystem';
import { EventBus } from '../EventBus';

export const logger = new RoomLogger('ClientNetworkSystem');

export class ClientNetworkSystem extends System {
  readonly key = 'client-network';
  private static readonly RTT_SMOOTHING_ALPHA = 0.2;
  private static readonly SESSION_KEY = 'tronzero_session';

  channel: ClientChannel;
  readonly sessionToken: string;
  private smoothedOneWayTime: number = 0;
  private room: ECSGameRoom;
  private _connected: boolean = false;
  private _pingInterval: number | null = null;
  private _host: string = '';
  private _port: number = 0;
  oneWayTime: number = 0;

  constructor() {
    super();

    // Persistent session token — survives tab hide/show and page reloads
    let token = localStorage.getItem(ClientNetworkSystem.SESSION_KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(ClientNetworkSystem.SESSION_KEY, token);
    }
    this.sessionToken = token;
  }

  private _createChannel(): ClientChannel {
    return geckos({
      url: `http://${this._host}`,
      iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }],
      port: this._port,
    });
  }

  getComponents(): object[] {
    return [];
  }

  init?(room: ECSGameRoom): void {
    this.room = room;
    logger.setRoom(room);
  }

  /** Connect to a game server at the given host and port. Creates a new channel and starts signaling. */
  connect(host: string, port: number): void {
    if (this._connected) return;
    this._host = host;
    this._port = port;
    this.channel = this._createChannel();
    this._setupChannel(this.channel);
    this._startPingInterval();
  }

  private _setupChannel(channel: ClientChannel): void {
    channel.onConnect((error) => this._onConnection(error));
    channel.on('pong', (data) => this._onPong(data));
    channel.onRaw((data) => this._onRaw(data));
    channel.onDisconnect(() => this._onDisconnect());
  }

  private _startPingInterval(): void {
    this._stopPingInterval();
    this._pingInterval = window.setInterval(() => {
      if (this._connected) {
        this.channel.emit('ping', performance.now());
      }
    }, 3000);
  }

  private _stopPingInterval(): void {
    if (this._pingInterval !== null) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  isConnected(): boolean {
    return this._connected;
  }

  private _onRaw(data: Data) {
    const msg = decodeMessage(data as ArrayBuffer);

    switch (msg.type) {
      case MSG_INIT_STATE:
        this._onInitState(msg.tick, msg.snapshot);
        break;
      case MSG_SYNC_STATE:
        this._onSyncState(msg.tick, msg.data, msg.struct);
        break;
      default:
        throw new Error('Unknown message');
    }
  }

  private _onSyncState(tick: number, data: ArrayBuffer, struct: ArrayBuffer) {
    logger.debug('Received sync state');

    // Clock-sync: adjust client tickTimeMs so clientTick converges to serverTick + pingTicks + 1
    const targetOffsetTicks = Math.ceil(this.oneWayTime / this.room.gameClock.referenceTickTimeMs);
    const tickError = tick + targetOffsetTicks - this.room.tick + 1;
    const GAIN = 0.1;
    const MAX_SPEEDUP = 0.25; // scale floor = 0.75 (client runs at most 33% faster)
    const MAX_SLOWDOWN = 0.25; // scale ceiling = 1.25 (client runs at most 20% slower)
    // Positive tickError = client is behind → speed up  (correction > 0 → scale < 1)
    // Negative tickError = client is ahead  → slow down (correction < 0 → scale > 1)
    const correction = GAIN * tickError;
    const clamped = Math.max(-MAX_SLOWDOWN, Math.min(MAX_SPEEDUP, correction));
    const scale = 1 - clamped;
    this.room.gameClock.tickTimeMs = this.room.gameClock.referenceTickTimeMs * scale;

    this.room.addNetworkDiffPayload({
      tick,
      data,
      struct,
    });
  }

  private _onInitState(tick: number, snapshot: ArrayBuffer) {
    logger.info('Received init state');

    this.room.initFromSnapshot(tick, snapshot);
    this.room.gameClock.tick = tick;

    // Use sessionToken (not channel.id) — survives reconnection
    this.room.localPlayerEid = PlayerSystem.getPlayerEidByStringId(this.room, this.sessionToken);
    this.room.localPlayerId = this.sessionToken;

    //this.room.gameClock.tickTimeMs = this.room.gameClock.referenceTickTimeMs;

    logger.warn(this.room.tick, 'Player ready — eid:', this.room.localPlayerEid);
  }

  private _onPong(data: Data) {
    const oldTime = data as number;
    const pingDifferenceTime = performance.now() - oldTime;
    this.oneWayTime = pingDifferenceTime / 2;

    logger.warn(
      this.room.tick,
      'pong',
      `RTT: ${pingDifferenceTime.toFixed(2)}ms, One-way: ${this.oneWayTime.toFixed(2)}ms`
    );
  }

  requestInitState(): void {
    logger.info('Requesting init state from server');
    this.room.gameClock.resetAccumulator();
    this.channel.emit('request_init');
  }

  sendInput(obj: { tick: number; turn?: 'left' | 'right'; break?: boolean }): void {
    if (!this._connected) return;

    this.channel.emit('client_turn', [{ tick: obj.tick, turn: obj.turn }]);
  }

  sendRespawn(): void {
    if (!this._connected) return;

    this.channel.emit('respawn');
  }

  /** Replace the current channel with a new one and re-establish all handlers. */
  reconnect(): void {
    if (!this._host || !this._port) return;
    logger.info('Reconnecting...');
    this._connected = false;
    this._stopPingInterval();
    this.channel.close();
    this.channel = this._createChannel();
    this._setupChannel(this.channel);
    this._startPingInterval();
  }

  update(getInput: inputGetter, getEvents: eventGetter): void {
    return;
  }

  private _onConnection(error: ConnectionError | undefined): void {
    if (error) {
      logger.error('Connection failed:', error.message);
      this._connected = false;
      return;
    }

    this._connected = true;
    logger.info('Connected to server with ID:', this.channel.id);
    EventBus.emit('connection-state', 'connected');

    // Identify ourselves with the persistent session token
    this.channel.emit('handshake', { sessionToken: this.sessionToken });
    this.channel.emit('ping', performance.now());
  }

  private _onDisconnect(): void {
    this._connected = false;
    logger.warn('Disconnected from server');
    EventBus.emit('connection-state', 'disconnected');
  }
}
