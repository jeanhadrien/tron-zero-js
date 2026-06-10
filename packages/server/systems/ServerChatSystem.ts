import { GeckosServer, ServerChannel, Data } from '@geckos.io/server';
import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import type { SimulationContext } from '@tron0/shared/interfaces/SimulationContext';
import { GameEventType, GameEvent } from '@tron0/shared/interfaces/GameEvent';
import { ChatMessageBuffer } from '@tron0/shared/ChatMessageBuffer';
import { ChatMessage } from '@tron0/shared/interfaces/ChatMessage';
import { RoomLogger } from '@tron0/shared/otel/Logger';
import PlayerSystem, { Color } from '@tron0/shared/systems/PlayerSystem';

const logger = new RoomLogger('chat-server');

function gameEventToText(event: GameEvent): string | null {
  const pid = event.playerId ? event.playerId.substring(0, 16) : '?';
  switch (event.type) {
    case GameEventType.PlayerJoined:
      return `Player ${pid} joined the game`;
    case GameEventType.PlayerLeft:
      return `Player ${pid} left the game`;
    // case GameEventType.PlayerSpawn:
    //   return `Player ${pid} spawned`;
    // case GameEventType.PlayerDeath:
    //   return `Player ${pid} died`;
    case GameEventType.GameStart:
      return 'Game started';
    case GameEventType.GameStop:
      return 'Game stopped';
    case GameEventType.GamePause:
      return 'Game paused';
    default:
      return null;
  }
}

export class ServerChatSystem extends System {
  readonly key = 'chat-server';

  private server: GeckosServer;
  private channels: Map<string, ServerChannel> = new Map();
  private room: SimulationContext;
  private channelPlayerIds: Map<string, string>;
  buffer: ChatMessageBuffer;

  constructor(io: GeckosServer, channelPlayerIds: Map<string, string>) {
    super();
    this.server = io;
    this.channelPlayerIds = channelPlayerIds;
    this.buffer = new ChatMessageBuffer(100);
  }

  getComponents(): object[] {
    return [];
  }

  init(room: SimulationContext): void {
    this.room = room;

    this.server.onConnection((channel) => {
      const channelId = channel.id!;
      this.channels.set(channelId, channel);

      const history = this.buffer.getAll();
      channel.emit('chat', { type: 'history', messages: history });

      channel.on('chat_message', (data: Data) => {
        const text = data as string;
        if (!text || typeof text !== 'string' || text.trim().length === 0) return;

        const playerId = this.channelPlayerIds.get(channelId) ?? channelId;
        let color: number | undefined;
        try {
          const eid = PlayerSystem.getPlayerEidByStringId(this.room, playerId);
          color = Color[eid];
        } catch {
          /* player entity may not exist yet */
        }

        const message: ChatMessage = {
          tick: this.room.tick,
          timestamp: Date.now(),
          type: 'player',
          playerId,
          color,
          text: text.trim(),
        };

        logger.log(`${playerId}: ${message.text}`);

        this.buffer.push(message);
        this.broadcast(message);

        if (text.toLowerCase().includes('hello server')) {
          const reply: ChatMessage = {
            tick: this.room.tick,
            timestamp: Date.now(),
            type: 'event',
            playerId: '[Server]',
            text: 'hello clients!',
          };
          this.buffer.push(reply);
          this.broadcast(reply);
        }
      });

      channel.onDisconnect(() => {
        this.channels.delete(channelId);
      });
    });
  }

  update(_getInput: inputGetter, getEvents: eventGetter): void {
    if (getEvents) {
      for (const event of getEvents()) {
        const text = gameEventToText(event);
        if (!text) continue;

        const message: ChatMessage = {
          tick: event.tick,
          timestamp: Date.now(),
          type: 'event',
          playerId: event.playerId,
          text,
        };

        this.buffer.push(message);
        this.broadcast(message);
      }
    }
  }

  private broadcast(message: ChatMessage): void {
    for (const channel of this.channels.values()) {
      channel.emit('chat', { type: 'message', message });
    }
  }
}

