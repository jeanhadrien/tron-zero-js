import { GeckosServer, ServerChannel, Data } from '@geckos.io/server';
import { encodeInitState, encodeSyncState } from '@tron0/shared/NetworkProtocol';
import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import { GameEventType } from '@tron0/shared/interfaces/GameEvent';
import { Logger } from '@tron0/shared/Logger';
import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import PlayerSystem from '@tron0/shared/systems/PlayerSystem';

export const logger = new Logger('ServerNetworkSystem');

export class ServerNetworkSystem extends System {
  readonly key = 'server-network';
  server: GeckosServer;
  room: ECSGameRoom;

  private channels: Map<string, ServerChannel> = new Map();
  private sessionByChannelId: Map<string, string> = new Map();

  constructor(io: GeckosServer) {
    super();
    this.server = io;
  }

  getComponents(): object[] {
    return [];
  }

  init(room: ECSGameRoom) {
    this.room = room;
    this.server.onConnection((channel) => this._onConnection(channel));
  }

  update(getInput: inputGetter, getEvents: eventGetter): void {
    if (this.room.replaying) return;

    if (getEvents) {
      for (const event of getEvents()) {
        if (event.type === GameEventType.PlayerJoined && event.playerId) {
          const packet = encodeInitState(this.room.tick, this.room.snapshotSerialize());
          const channel = this._getChannelBySessionToken(event.playerId);
          if (channel) channel.raw.emit(packet);
        }
      }
    }

    const dirtyEntities = [...this.room.dirtyEntities];
    this.room.dirtyEntities.clear();
    if (dirtyEntities.length === 0) return;

    this._sendStateToClients(dirtyEntities);
  }

  private _sendStateToClients(entities: number[]) {
    const diff = {
      tick: this.room.tick,
      struct: this.room.observerSerializeNetwork(),
      data: this.room.soaSerialize(entities),
    };
    if (diff.struct.byteLength > 0 || diff.data.byteLength > 0) {
      const packet = encodeSyncState(diff.tick, diff.data, diff.struct);
      for (const channel of this.channels.values()) {
        channel.raw.emit(packet);
      }
    }
  }

  private _onConnection(channel: ServerChannel) {
    const channelId = channel.id!;
    this.channels.set(channelId, channel);

    logger.info(`New WebRTC connection: ${channelId}`);

    channel.on('handshake', (data: Data) => this._onHandshake(channel, data));

    channel.on('request_init', () => {
      const packet = encodeInitState(this.room.tick, this.room.snapshotSerialize());
      channel.raw.emit(packet);
    });

    channel.on('ping', (clientTime: Data) => {
      channel.emit('pong', { clientTime, serverTick: this.room.tick });
    });

    channel.on('client_turn', this._onClientTurn(channel));
    channel.on('respawn', this._onClientRespawn(channel));
    channel.onDisconnect(() => this._onDisconnect(channel));
  }

  private _onHandshake(channel: ServerChannel, data: Data): void {
    const { sessionToken } = data as { sessionToken: string };
    const channelId = channel.id!;

    logger.info(`Handshake: session=${sessionToken}, channel=${channelId}`);

    // If this session token already has a channel mapped, close the old one (e.g., old tab)
    for (const [cid, st] of this.sessionByChannelId) {
      if (st === sessionToken && cid !== channelId) {
        logger.info(`Session ${sessionToken} reconnecting — closing old channel ${cid}`);
        const oldChannel = this.channels.get(cid);
        if (oldChannel) oldChannel.close();
        this.channels.delete(cid);
        this.sessionByChannelId.delete(cid);
        this.room.channelPlayerIds.delete(cid);
        break;
      }
    }

    this.sessionByChannelId.set(channelId, sessionToken);
    this.room.channelPlayerIds.set(channelId, sessionToken);

    // Check if player entity already exists (reconnection)
    try {
      PlayerSystem.getPlayerEidByStringId(this.room, sessionToken);
      logger.info(`Player reconnected: ${sessionToken}`);
      // Send init state directly — entity already exists, no PlayerJoined/Spawn needed
      const packet = encodeInitState(this.room.tick, this.room.snapshotSerialize());
      channel.raw.emit(packet);
    } catch {
      // New player — create entity and spawn
      logger.info(`New player: ${sessionToken}`);
      this.room.serverAddEvent({ type: GameEventType.PlayerJoined, tick: this.room.tick, playerId: sessionToken });
      this.room.serverAddEvent({ type: GameEventType.PlayerSpawn, tick: this.room.tick, playerId: sessionToken });
    }
  }

  private _onClientTurn(channel: ServerChannel) {
    return (data: Data) => {
      const sessionToken = this.sessionByChannelId.get(channel.id!);
      if (!sessionToken) return;

      const inputs: { tick: number; turn: 'left' | 'right'; alpha?: number }[] = Array.isArray(data) ? data : [data];
      for (const input of inputs) {
        logger.warn('received input from client, diff', input.tick - this.room.tick);

        this.room.serverAddInput({
          turn: input.turn,
          playerId: sessionToken,
          break: false,
          tick: input.tick,
          alpha: input.alpha,
        });
      }
    };
  }

  private _onClientRespawn(channel: ServerChannel) {
    return (data?: Data) => {
      const sessionToken = this.sessionByChannelId.get(channel.id!);
      if (!sessionToken) return;

      const clientTick = (data as { clientTick?: number })?.clientTick ?? 0;
      const targetTick = Math.max(this.room.tick + 1, clientTick);
      this.room.serverAddEvent({ type: GameEventType.PlayerSpawn, tick: targetTick, playerId: sessionToken });
    };
  }

  private _onDisconnect(channel: ServerChannel) {
    const channelId = channel.id!;
    const sessionToken = this.sessionByChannelId.get(channelId);

    this.room.channelPlayerIds.delete(channelId);
    this.channels.delete(channelId);
    if (sessionToken) {
      this.sessionByChannelId.delete(channelId);
      logger.info(`Player disconnected (kept alive): ${sessionToken}`);
    }

    // Player entity stays in simulation — no PlayerLeft.
    // The player goes straight (no inputs) until auto-kick timeout (later) or reconnect.
  }

  private _getChannelBySessionToken(sessionToken: string): ServerChannel | undefined {
    for (const [cid, st] of this.sessionByChannelId) {
      if (st === sessionToken) return this.channels.get(cid);
    }
    return undefined;
  }
}
