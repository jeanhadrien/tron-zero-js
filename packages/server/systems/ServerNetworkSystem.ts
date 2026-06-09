import { GeckosServer, ServerChannel, Data } from '@geckos.io/server';
import { encodeInitState, encodeSyncStateBatch, SERVER_DIFF_HISTORY_SIZE } from '@tron0/shared/NetworkProtocol';
import type { NetworkDiffPayload } from '@tron0/shared/interfaces/Network';
import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import { GameEventType } from '@tron0/shared/interfaces/GameEvent';
import { Logger } from '@tron0/shared/Logger';
import type { SimulationContext } from '@tron0/shared/interfaces/SimulationContext';
import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import PlayerSystem from '@tron0/shared/systems/PlayerSystem';

const logger = new Logger('ServerNetworkSystem');

export class ServerNetworkSystem extends System {
  readonly key = 'server-network';
  server: GeckosServer;
  room: ECSGameRoom;

  /** Channel ID → session token mapping (server-owned, previously on ECSGameRoom). */
  channelPlayerIds: Map<string, string> = new Map();

  private channels: Map<string, ServerChannel> = new Map();
  private sessionByChannelId: Map<string, string> = new Map();
  private _diffHistory: NetworkDiffPayload[] = [];

  constructor(io: GeckosServer) {
    super();
    this.server = io;
  }

  getComponents(): object[] {
    return [];
  }

  init(ctx: SimulationContext) {
    this.room = ctx as ECSGameRoom;
    this.server.onConnection((channel) => this._onConnection(channel));
  }

  /** How many players are currently connected (have an active WebRTC channel). */
  getPlayerCount(): number {
    return this.channelPlayerIds.size;
  }

  update(_getInput: inputGetter, getEvents: eventGetter): void {
    if (getEvents) {
      for (const event of getEvents()) {
        if (event.type === GameEventType.PlayerJoined && event.playerId) {
          const packet = encodeInitState(this.room.tick + 1, this.room.snapshotSerialize());
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
    const diff: NetworkDiffPayload = {
      tick: this.room.tick + 1,
      struct: this.room.observerSerializeNetwork(),
      data: this.room.soaSerialize(entities),
    };

    this._diffHistory.push(diff);
    if (this._diffHistory.length > SERVER_DIFF_HISTORY_SIZE) {
      this._diffHistory.shift();
    }

    const serverTick = this.room.tick + 1;
    const packet = encodeSyncStateBatch(serverTick, this._diffHistory);
    for (const channel of this.channels.values()) {
      channel.raw.emit(packet);
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

    for (const [cid, st] of this.sessionByChannelId) {
      if (st === sessionToken && cid !== channelId) {
        logger.info(`Session ${sessionToken} reconnecting — closing old channel ${cid}`);
        const oldChannel = this.channels.get(cid);
        if (oldChannel) oldChannel.close();
        this.channels.delete(cid);
        this.sessionByChannelId.delete(cid);
        this.channelPlayerIds.delete(cid);
        break;
      }
    }

    this.sessionByChannelId.set(channelId, sessionToken);
    this.channelPlayerIds.set(channelId, sessionToken);

    if (PlayerSystem.getPlayerEidByStringId(this.room, sessionToken)) {
      logger.info(`Player reconnected: ${sessionToken}`);
      const packet = encodeInitState(this.room.tick, this.room.snapshotSerialize());
      channel.raw.emit(packet);
    } else {
      logger.info(`New player: ${sessionToken}`);
      this.room.addEvent({ type: GameEventType.PlayerJoined, tick: this.room.tick + 1, playerId: sessionToken });
      //this.room.addEvent({ type: GameEventType.PlayerSpawn, tick: this.room.tick, playerId: sessionToken });
    }
  }

  private _onClientTurn(channel: ServerChannel) {
    return (data: Data) => {
      const sessionToken = this.sessionByChannelId.get(channel.id!);
      if (!sessionToken) return;

      const inputs: { tick: number; turn: 'left' | 'right'; alpha?: number }[] = Array.isArray(data) ? data : [data];
      for (const input of inputs) {
        logger.warn('received input from client, diff', input.tick - this.room.tick);

        this.room.addInput({
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
      const targetTick = Math.max(this.room.tick, clientTick);
      this.room.addEvent({ type: GameEventType.PlayerSpawn, tick: targetTick, playerId: sessionToken });
    };
  }

  private _onDisconnect(channel: ServerChannel) {
    const channelId = channel.id!;
    const sessionToken = this.sessionByChannelId.get(channelId);

    this.channelPlayerIds.delete(channelId);
    this.channels.delete(channelId);
    if (sessionToken) {
      this.sessionByChannelId.delete(channelId);
      logger.info(`Player disconnected (kept alive): ${sessionToken}`);
    }
  }

  private _getChannelBySessionToken(sessionToken: string): ServerChannel | undefined {
    for (const [cid, st] of this.sessionByChannelId) {
      if (st === sessionToken) return this.channels.get(cid);
    }
    return undefined;
  }
}
