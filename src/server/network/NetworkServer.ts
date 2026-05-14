import { ServerChannel } from '@geckos.io/server';
import { trace } from '@opentelemetry/api';
import GameClock from '../../shared/GameClock';
import { Logger } from '../../shared/Logger';
import ECSGameRoom from '../../shared/ECSGameRoom';
import PlayerSystem from '../../shared/ECSPlayerSystem';
import { GameEventType } from '../../shared/GameEvent';
import { SystemDiffPayload } from '../../shared/ECSSystem';

const logger = new Logger('NET');
const tracer = trace.getTracer('tron-zero-server');

export class NetworkServer {
  io: any;
  ecsRoom: ECSGameRoom;
  gameClock: GameClock;
  channels: Map<string, ServerChannel> = new Map();

  constructor(io: any, ecsRoom: ECSGameRoom, gameClock: GameClock) {
    this.io = io;
    this.ecsRoom = ecsRoom;
    this.gameClock = gameClock;

    ecsRoom.onDelta((deltas) => this.broadcastDeltas(deltas));
    this.setupListeners();
  }

  private broadcastDeltas(deltas: SystemDiffPayload[]): void {
    for (const channel of this.channels.values()) {
      channel.emit('sync_state', deltas, { reliable: true });
    }
  }

  setupListeners() {
    this.io.onConnection((channel: ServerChannel) => {
      const playerId = channel.id!;
      this.channels.set(playerId, channel);

      const connectSpan = tracer.startSpan('player.connect');
      connectSpan.setAttribute('player.id', playerId);
      logger.info(`Player connected: ${playerId}`);

      // Create ECS entity and record join event
      PlayerSystem.createPlayer(this.ecsRoom.world, playerId);
      this.ecsRoom.addEvent(this.gameClock.tick + 1, { type: GameEventType.PlayerJoined, playerId });

      channel.on('ping', (clientTime: any) => {
        channel.emit('pong', clientTime);
      });

      // Send full serialized world snapshot of the current tick
      channel.emit('init_state', [this.gameClock.tick, this.ecsRoom.worldSnapshotSerializer()], { reliable: true });

      connectSpan.end();

      // Client sends raw turn inputs (sliding window of { tick, turn } pairs)
      channel.on('client_turn', (data: any) => {
        const inputs: { tick: number; turn: 'left' | 'right' }[] = Array.isArray(data) ? data : [data];

        for (const input of inputs) {
          const MAX_FUTURE_OFFSET = 20;
          if (input.tick > this.gameClock.tick + MAX_FUTURE_OFFSET) {
            logger.warn(`Received input too far in the future (${input.tick} vs ${this.gameClock.tick}), clamping`);
            input.tick = this.gameClock.tick + MAX_FUTURE_OFFSET;
          }

          this.ecsRoom.addInput(input.tick, playerId, { turn: input.turn, break: false });
        }
      });

      // Handle manual respawn requests from clients
      channel.on('respawn', (data: any) => {
        const [tick] = data;
        if (!PlayerSystem.isAlive(this.ecsRoom.world, playerId)) {
          PlayerSystem.spawnPlayer(this.ecsRoom.world, playerId);
          this.ecsRoom.addEvent(tick, { type: GameEventType.PlayerSpawn, playerId });
        }
      });

      channel.onDisconnect(() => {
        this.channels.delete(playerId);
        const disconnectSpan = tracer.startSpan('player.disconnect');
        disconnectSpan.setAttribute('player.id', playerId);
        logger.info(`Player disconnected: ${playerId}`);
        PlayerSystem.removePlayerById(this.ecsRoom.world, playerId);
        this.ecsRoom.addEvent(this.gameClock.tick + 1, { type: GameEventType.PlayerLeft, playerId });
        disconnectSpan.end();
      });
    });
  }
}
