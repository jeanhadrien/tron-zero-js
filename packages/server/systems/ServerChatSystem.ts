import { GeckosServer, ServerChannel, Data } from '@geckos.io/server';
import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import { GameEventType, GameEvent } from '@tron0/shared/interfaces/GameEvent';
import { ChatMessageBuffer } from '@tron0/shared/ChatMessageBuffer';
import { ChatMessage } from '@tron0/shared/interfaces/ChatMessage';
import { RoomLogger } from '@tron0/shared/otel/Logger';
import PlayerSystem, { Color } from '@tron0/shared/systems/PlayerSystem';

const logger = new RoomLogger('chat-server');

// Convert a GameEvent to human-friendly chat text, skip noisy events
function gameEventToText(event: GameEvent): string | null {
  const pid = event.playerId ? event.playerId.substring(0, 16) : '?';
  switch (event.type) {
    case GameEventType.PlayerJoined:
      return `Player ${pid} joined the game`;
    case GameEventType.PlayerLeft:
      return `Player ${pid} left the game`;
    case GameEventType.PlayerSpawn:
      return `Player ${pid} spawned`;
    case GameEventType.PlayerDeath:
      return `Player ${pid} died`;
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
  private room: ECSGameRoom;
  buffer: ChatMessageBuffer;

  constructor(io: GeckosServer) {
    super();
    this.server = io;
    this.buffer = new ChatMessageBuffer(100);
  }

  getComponents(): object[] {
    return [];
  }

  init(room: ECSGameRoom): void {
    this.room = room;

    this.server.onConnection((channel) => {
      const channelId = channel.id!;
      this.channels.set(channelId, channel);

      // Send full chat history to newly connected player
      const history = this.buffer.getAll();
      channel.emit('chat', { type: 'history', messages: history });

      // Listen for player chat messages
      channel.on('chat_message', (data: Data) => {
        const text = data as string;
        if (!text || typeof text !== 'string' || text.trim().length === 0) return;

        const playerId = this.room.channelPlayerIds.get(channelId) ?? channelId;
        let color: number | undefined;
        try {
          const eid = PlayerSystem.getPlayerEidByStringId(this.room, playerId);
          color = Color[eid];
        } catch { /* player entity may not exist yet */ }

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

        // Broadcast to all connected clients
        this.broadcast(message);

        // Easter egg: respond to "hello server"
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
    // Skip events emitted during rollback/resimulation
    if (this.room.replaying) return;

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
