import { Data, GeckosServer, ServerChannel } from '@geckos.io/server';
import { trace } from '@opentelemetry/api';
import GameClock from '../../shared/GameClock';
import { Logger } from '../../shared/Logger';
import ECSGameRoom from '../../shared/ECSGameRoom';
import { GameEventType } from '../../shared/GameEvent';
import type { NetworkDiffPayload } from '../../shared/ECSNetworkSystem';
import { encodeInitState, encodeSyncState } from '../../shared/NetworkProtocol';

const logger = new Logger('NET');
const tracer = trace.getTracer('tron-zero-server');

export class NetworkServer {
  io: GeckosServer;
  ecsRoom: ECSGameRoom;
  channels: Map<string, ServerChannel> = new Map();

  constructor(io: GeckosServer, ecsRoom: ECSGameRoom, gameClock: GameClock) {
    this.io = io;
    this.ecsRoom = ecsRoom;

    // Delta broadcast — sends changed entity states to all clients after resimulation.
    ecsRoom.onNetworkDiff((diff) => this.broadcastDeltas(diff));
    this.setupListeners();
  }

  private broadcastDeltas(diff: NetworkDiffPayload): void {
    const packet = encodeSyncState(diff.tick, diff.data, diff.struct);
    for (const channel of this.channels.values()) {
      channel.raw.emit(packet);
    }
  }

  setupListeners() {
    this.io.onConnection((channel: ServerChannel) => {
      const channelId = channel.id!;
      this.channels.set(channelId, channel);

      logger.info(`Player connected from channel: ${channelId}`);
      this.ecsRoom.addEvent(this.ecsRoom.world.tick + 1, { type: GameEventType.PlayerJoined, playerId: channelId });

      channel.on('ping', (clientTime: Data) => {
        channel.emit('pong', clientTime);
      });

      // Send full serialized world snapshot as raw binary
      const packet = encodeInitState(this.ecsRoom.world.tick, this.ecsRoom.snapshotSerialize());
      channel.raw.emit(packet);

      // Client sends raw turn inputs (sliding window of { tick, turn } pairs)
      channel.on('client_turn', (data: Data) => {
        const inputs: { tick: number; turn: 'left' | 'right' }[] = Array.isArray(data) ? data : [data];

        for (const input of inputs) {
          //   const MAX_FUTURE_OFFSET = 20;
          //   if (input.tick > this.gameClock.tick + MAX_FUTURE_OFFSET) {
          //     logger.warn(`Received input too far in the future (${input.tick} vs ${this.gameClock.tick}), clamping`);
          //     input.tick = this.gameClock.tick + MAX_FUTURE_OFFSET;
          //   }
          logger.warn('in', channelId, input);
          this.ecsRoom.addInput({ tick: input.tick, turn: input.turn, break: false });
        }
      });

      // Handle manual respawn requests from clients
      channel.on('respawn', () => {
        this.ecsRoom.addEvent(this.ecsRoom.world.tick + 1, { type: GameEventType.PlayerSpawn, playerId: channelId });
      });

      channel.onDisconnect(() => {
        this.channels.delete(channelId);

        const disconnectSpan = tracer.startSpan('player.disconnect');
        disconnectSpan.setAttribute('player.id', channelId);

        logger.info(`Player disconnected: ${channelId}`);
        this.ecsRoom.addEvent(this.ecsRoom.world.tick + 1, { type: GameEventType.PlayerLeft, playerId: channelId });

        disconnectSpan.end();
      });
    });
  }
}
