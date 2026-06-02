import { ClientChannel, geckos } from '@geckos.io/client';
import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import { RoomLogger } from '@tron0/shared/otel/Logger';
import { ConnectionError, Data } from '@geckos.io/common/lib/types';
import { decodeMessage, MSG_INIT_STATE, MSG_SYNC_STATE } from '@tron0/shared/NetworkProtocol';
import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import PlayerSystem from '@tron0/shared/systems/PlayerSystem';
import { EventBus } from '../managers/EventBus';
import { ClockSyncManager } from '../managers/ClockSyncManager';

export const logger = new RoomLogger('ClientNetworkSystem');

export class ClientNetworkSystem extends System {
  readonly key = 'client-network';
  private static readonly SESSION_KEY = 'tronzero_session';
  private static readonly HEARTBEAT_TIMEOUT_MS = 3000;

  channel: ClientChannel;
  readonly sessionToken: string;
  private room: ECSGameRoom;
  private clockSync: ClockSyncManager | null = null;
  private _connected: boolean = false;
  private _pingInterval: number | null = null;
  private _heartbeatTimeout: number | null = null;
  private _initialized = false;
  private _host: string = '';
  private _port: number = 0;

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

  setClockSync(cs: ClockSyncManager): void {
    this.clockSync = cs;
  }

  init?(room: ECSGameRoom): void {
    this.room = room;
    logger.setRoom(room);
  }

  /** Connect to a game server at the given host and port. Creates a new channel and starts signaling. */
  connect(host: string, port: number): void {
    if (this._connected) return;
    this._clearHeartbeat();
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
    }, 250);
  }

  private _stopPingInterval(): void {
    if (this._pingInterval !== null) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  private _resetHeartbeat(): void {
    this._clearHeartbeat();
    if (this._connected) {
      this._heartbeatTimeout = window.setTimeout(
        () => this._handleHeartbeatLoss(),
        ClientNetworkSystem.HEARTBEAT_TIMEOUT_MS
      );
    }
  }

  private _clearHeartbeat(): void {
    if (this._heartbeatTimeout !== null) {
      clearTimeout(this._heartbeatTimeout);
      this._heartbeatTimeout = null;
    }
  }

  private _handleHeartbeatLoss(): void {
    if (!this._connected) return;
    logger.warn('Server heartbeat timeout — forcing disconnect');
    this.channel.close();
    this._onDisconnect();
  }

  isConnected(): boolean {
    return this._connected;
  }

  private _onRaw(data: Data) {
    this._resetHeartbeat();
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
    logger.debug('Received sync state for', tick);

    this.room.addNetworkDiffPayload({
      tick,
      data,
      struct,
    });
  }

  private _onInitState(tick: number, snapshot: ArrayBuffer) {
    logger.warn('Received init state');
    this._initialized = true;

    const leadTicks = this.clockSync?.getLeadTicks() ?? 3;
    this.room.initFromSnapshot(tick, snapshot);
    this.room.tick = tick + leadTicks;

    // Use sessionToken (not channel.id) — survives reconnection
    this.room.localPlayerEid = PlayerSystem.getPlayerEidByStringId(this.room, this.sessionToken);
    this.room.localPlayerId = this.sessionToken;

    this.room.clock.tickTimeMs = this.room.clock.referenceTickTimeMs;

    logger.warn('Player ready — tick:', this.room.tick, 'lead:', leadTicks, 'eid:', this.room.localPlayerEid);
  }

  private _onPong(data: Data) {
    this._resetHeartbeat();
    if (!this._initialized) return;

    const { clientTime, serverTick } = data as { clientTime: number; serverTick: number };
    const rttMs = performance.now() - clientTime;

    this.clockSync?.recordPing(rttMs, serverTick);

    logger.warn(
      `RTT: ${rttMs.toFixed(2)}ms, OWD: ${(rttMs / 2).toFixed(2)}ms, TickErr: ${this.clockSync?.storedTickError?.toFixed(1) ?? '-'}`
    );
  }

  requestInitState(): void {
    logger.info('Requesting init state from server');
    this.room.clock.resetAccumulator();
    this.channel.emit('request_init');
  }

  sendInput(obj: { tick: number; turn?: 'left' | 'right'; break?: boolean; alpha?: number }): void {
    if (!this._connected) return;
    this.channel.emit('client_turn', [{ tick: obj.tick, turn: obj.turn, alpha: obj.alpha }]);
  }

  sendRespawn(): void {
    if (!this._connected || !this.room) return;

    this.channel.emit('respawn', { clientTick: this.room.tick });
  }

  /** Replace the current channel with a new one and re-establish all handlers. */
  reconnect(): void {
    if (!this._host || !this._port) return;
    logger.info('Reconnecting...');
    this._connected = false;
    this._clearHeartbeat();
    this._stopPingInterval();
    this.clockSync?.reset();
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
      this._clearHeartbeat();
      return;
    }

    this._connected = true;
    this._resetHeartbeat();
    logger.info('Connected to server with ID:', this.channel.id);
    EventBus.emit('connection-state', 'connected');

    // Identify ourselves with the persistent session token
    this.channel.emit('handshake', { sessionToken: this.sessionToken });
    this.channel.emit('ping', performance.now());
  }

  private _onDisconnect(): void {
    if (!this._connected) return;
    this._connected = false;
    this._clearHeartbeat();
    this._stopPingInterval();
    this.clockSync?.reset();
    logger.warn('Disconnected from server');
    EventBus.emit('connection-state', 'disconnected');
  }
}
