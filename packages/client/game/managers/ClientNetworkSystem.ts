import { ClientChannel, geckos, RawMessage } from '@geckos.io/client';
import { RoomLogger } from '@tron0/shared/otel/Logger';
import { ConnectionError, Data } from '@geckos.io/common/lib/types';
import { decodeMessage, MSG_INIT_STATE, MSG_SYNC_STATE_BATCH } from '@tron0/shared/NetworkProtocol';
import type { NetworkDiffPayload } from '@tron0/shared/interfaces/Network';
import { EventBus } from './EventBus';

const logger = new RoomLogger('ClientNetwork');

/**
 * Callbacks the network relay invokes when it receives server data.
 * The owner wires these to the simulation Worker (or, for testing, a stub).
 */
export interface NetworkDataHandler {
  onInitState(tick: number, snapshot: ArrayBuffer): void;
  onSyncStateBatch(serverTick: number, diffs: NetworkDiffPayload[]): void;
  onPong(rttMs: number, serverTick: number): void;
}

/**
 * Manages the geckos.io WebRTC connection to a game server.
 *
 * No longer an ECS System — it only forwards received network data to a
 * {@link NetworkDataHandler} (the simulation Worker) and emits UI-relevant
 * status changes via {@link EventBus}.
 */
export class ClientNetworkSystem {
  private static readonly SESSION_KEY = 'tronzero_session';
  private static readonly HEARTBEAT_TIMEOUT_MS = 3000;

  channel!: ClientChannel;
  readonly sessionToken: string;

  private handler: NetworkDataHandler | null = null;
  private _connected: boolean = false;
  private _pingInterval: number | null = null;
  private _heartbeatTimeout: number | null = null;
  private _host: string = '';
  private _port: number = 0;
  private _initialized: boolean = false;

  constructor() {
    let token = localStorage.getItem(ClientNetworkSystem.SESSION_KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(ClientNetworkSystem.SESSION_KEY, token);
    }
    this.sessionToken = token;
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  /** Bind the target that will receive decoded network data. */
  setHandler(handler: NetworkDataHandler): void {
    this.handler = handler;
  }

  // ── Connection ───────────────────────────────────────────────────────────

  private _createChannel(): ClientChannel {
    return geckos({
      url: `http://${this._host}`,
      iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }],
      port: this._port,
    });
  }

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

  isConnected(): boolean {
    return this._connected;
  }

  // ── Outgoing ─────────────────────────────────────────────────────────────

  /** Request a full world snapshot from the server (tab resume, reconnect). */
  requestInitState(): void {
    logger.info('Requesting init state from server');
    this.channel.emit('request_init');
  }

  /** Ask the server to respawn the local player at the given simulation tick. */
  sendRespawn(tick: number): void {
    if (!this._connected) return;
    this.channel.emit('respawn', { clientTick: tick });
  }

  /** Replace the current channel with a new one (tab resume). */
  reconnect(): void {
    if (!this._host || !this._port) return;
    logger.info('Reconnecting...');
    this._connected = false;
    this._clearHeartbeat();
    this._stopPingInterval();
    this.channel.close();
    this.channel = this._createChannel();
    this._setupChannel(this.channel);
    this._startPingInterval();
  }

  // ── Incoming ─────────────────────────────────────────────────────────────

  private _onRaw(data: RawMessage): void {
    this._resetHeartbeat();
    const msg = decodeMessage(data as ArrayBuffer);

    switch (msg.type) {
      case MSG_INIT_STATE:
        this._initialized = true;
        this.handler?.onInitState(msg.tick, msg.snapshot);
        break;
      case MSG_SYNC_STATE_BATCH:
        this.handler?.onSyncStateBatch(msg.serverTick, msg.diffs);
        break;
      default:
        throw new Error('Unknown message');
    }
  }

  private _onPong(data: Data): void {
    this._resetHeartbeat();
    if (!this._initialized) return;

    const { clientTime, serverTick } = data as { clientTime: number; serverTick: number };
    const rttMs = performance.now() - clientTime;

    this.handler?.onPong(rttMs, serverTick);
    logger.debug(`RTT: ${rttMs.toFixed(2)}ms, OWD: ${(rttMs / 2).toFixed(2)}ms`);
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

    this.channel.emit('handshake', { sessionToken: this.sessionToken });
    this.channel.emit('ping', performance.now());
  }

  private _onDisconnect(): void {
    if (!this._connected) return;
    this._connected = false;
    this._clearHeartbeat();
    this._stopPingInterval();
    logger.warn('Disconnected from server');
    EventBus.emit('connection-state', 'disconnected');
  }

  // ── Heartbeat / ping ─────────────────────────────────────────────────────

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
}
