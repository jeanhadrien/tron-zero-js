import { ServerChannel } from '@geckos.io/server';
import { trace } from '@opentelemetry/api';
import GameClock from '../../shared/GameClock';
import { Logger } from '../../shared/Logger';
import ECSGameRoom from '../../shared/ECSGameRoom';
import PlayerSystem from '../../shared/ECSPlayerSystem';
import { GameEventType } from '../../shared/GameEvent';
import type { SystemDiffPayload } from '../../shared/ECSSystem';

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

    // Delta broadcast — sends changed entity states to all clients after resimulation.
    ecsRoom.onDelta((deltas) => this.broadcastDeltas(deltas));
    this.setupListeners();
  }

  private broadcastDeltas(deltas: SystemDiffPayload[]): void {
    const encoder = new TextEncoder();

    let totalSize = 1 + 4 + 2; // u8 type, u32 tick, u16 count
    for (const d of deltas) {
      const keyBytes = encoder.encode(d.systemKey);
      totalSize += 1 + keyBytes.byteLength + 4 + d.buffer.byteLength; // u8 keyLen, bytes key, u32 bufLen, bytes buffer
    }

    const packet = new ArrayBuffer(totalSize);
    const view = new DataView(packet);
    let offset = 0;

    view.setUint8(offset, 0x01);
    offset += 1;
    view.setUint32(offset, this.gameClock.tick);
    offset += 4;
    view.setUint16(offset, deltas.length);
    offset += 2;

    for (const d of deltas) {
      const keyBytes = encoder.encode(d.systemKey);
      view.setUint8(offset, keyBytes.byteLength);
      offset += 1;
      new Uint8Array(packet, offset, keyBytes.byteLength).set(keyBytes);
      offset += keyBytes.byteLength;
      view.setUint32(offset, d.buffer.byteLength);
      offset += 4;
      new Uint8Array(packet, offset, d.buffer.byteLength).set(new Uint8Array(d.buffer));
      offset += d.buffer.byteLength;
    }

    for (const channel of this.channels.values()) {
      channel.raw.emit(packet);
    }
  }

  setupListeners() {
    this.io.onConnection((channel: ServerChannel) => {
      const playerId = channel.id!;
      this.channels.set(playerId, channel);

      const connectSpan = tracer.startSpan('player.connect');
      connectSpan.setAttribute('player.id', playerId);
      logger.info(`Player connected: ${playerId}`);

      // Create ECS entity and spawn immediately so the snapshot includes a live player
      PlayerSystem.createPlayer(this.ecsRoom.world, playerId);
      PlayerSystem.spawnPlayer(this.ecsRoom.world, playerId);
      this.ecsRoom.addEvent(this.gameClock.tick + 1, { type: GameEventType.PlayerJoined, playerId });

      channel.on('ping', (clientTime: any) => {
        channel.emit('pong', clientTime);
      });

      // Send full serialized world snapshot as raw binary (geckos.io JSON-stringifies non-raw messages, destroying ArrayBuffers)
      // Format: [u8: messageType=0x00 init_state][u32: tick][bytes: snapshot]
      const snapshot = this.ecsRoom.worldSnapshotSerializer();
      const combined = new ArrayBuffer(1 + 4 + snapshot.byteLength);
      new DataView(combined).setUint8(0, 0x00);
      new DataView(combined).setUint32(1, this.gameClock.tick);
      new Uint8Array(combined, 5).set(new Uint8Array(snapshot));
      channel.raw.emit(combined);

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
