import { GeckosServer, ServerChannel, Data } from '@geckos.io/server';
import { eventGetter, inputGetter, System } from '../../shared/ECSSystem';
import { GameEventType } from '../../shared/GameEvent';
import { encodeInitState, encodeSyncState } from '../../shared/NetworkProtocol';
import { Logger } from '../../shared/Logger';
import { ECSGameRoom } from '../../shared/ECSGameRoom';

export const logger = new Logger('ServerNetworkSystem');

export class ServerNetworkSystem extends System {
  readonly key = 'server-network';
  server: GeckosServer;
  channels: Map<string, ServerChannel> = new Map();
  room: ECSGameRoom;

  constructor(io: GeckosServer) {
    super();
    this.server = io;
  }

  getComponents(): object[] {
    return [];
  }

  init(room: ECSGameRoom) {
    this.room = room;
    this.server.onConnection((channel) => this.onConnection(channel));
  }

  update(getInput: inputGetter, getEvents: eventGetter): void {
    // If we're rollbacking the world, don't send stuff to clients;
    if (this.room.replaying) return;

    if (getEvents) {
      for (const event of getEvents()) {
        switch (event.type) {
          case GameEventType.PlayerJoined: {
            if (!event.playerId) break;
            const packet = encodeInitState(this.room.tick, this.room.snapshotSerialize());
            const channel = this.channels.get(event.playerId);
            if (channel) channel.raw.emit(packet);
            break;
          }
          default:
            break;
        }
      }
    }

    const dirtyEntities = [...this.room.dirtyEntities];
    this.room.dirtyEntities.clear();
    if (!dirtyEntities) return;

    this.sendStateToClients(dirtyEntities);
  }

  private sendStateToClients(entities: number[]) {
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

  private onConnection(channel: ServerChannel) {
    const channelId = channel.id!;
    this.channels.set(channelId, channel);

    logger.info(`Player connected from channel: ${channelId}`);
    this.room.addEvent({ type: GameEventType.PlayerJoined, tick: this.room.tick, playerId: channelId });
    this.room.addEvent({ type: GameEventType.PlayerSpawn, tick: this.room.tick, playerId: channelId });

    channel.on('ping', (clientTime: Data) => {
      channel.emit('pong', clientTime);
    });

    channel.on('client_turn', this.onClientTurn(channel));
    channel.on('respawn', this.onClientRespawn(channel));
    channel.onDisconnect(this.onDisconnect(channel));
  }

  private onClientTurn(channel: ServerChannel) {
    return (data: Data) => {
      const inputs: { tick: number; turn: 'left' | 'right' }[] = Array.isArray(data) ? data : [data];
      for (const input of inputs) {
        this.room.addInput({
          turn: input.turn,
          playerId: channel.id!,
          break: false,
          tick: input.tick,
        });
      }
    };
  }

  private onClientRespawn(channel: ServerChannel) {
    return () => {
      this.room.addEvent({ type: GameEventType.PlayerSpawn, tick: this.room.tick + 1, playerId: channel.id! });
    };
  }

  private onDisconnect(channel: ServerChannel) {
    return () => {
      this.channels.delete(channel.id!);
      this.room.addEvent({ type: GameEventType.PlayerLeft, tick: this.room.tick, playerId: channel.id! });
    };
  }
}
