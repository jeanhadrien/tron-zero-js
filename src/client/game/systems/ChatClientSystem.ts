import { ClientChannel } from '@geckos.io/client';
import { eventGetter, inputGetter, System } from '../../../shared/interfaces/System';
import { ECSGameRoom } from '../../../shared/ECSGameRoom';
import { ChatMessageBuffer } from '../../../shared/ChatMessageBuffer';
import { ChatMessage } from '../../../shared/interfaces/ChatMessage';
import { EventBus } from '../EventBus';

export class ChatClientSystem extends System {
  readonly key = 'chat-client';

  private channel: ClientChannel;
  readonly messages: ChatMessageBuffer;

  constructor(channel: ClientChannel) {
    super();
    this.channel = channel;
    this.messages = new ChatMessageBuffer(100);
  }

  getComponents(): object[] {
    return [];
  }

  init(_room: ECSGameRoom): void {
    this.channel.on('chat', (data: any) => {
      if (data.type === 'history') {
        for (const msg of data.messages) {
          this.messages.push(msg);
          EventBus.emit('chat-message', msg as ChatMessage);
        }
      } else if (data.type === 'message') {
        const msg = data.message as ChatMessage;
        this.messages.push(msg);
        EventBus.emit('chat-message', msg);
      }
    });
  }

  update(_getInput: inputGetter, _getEvents: eventGetter): void {
    // No-op — chat is event-driven via geckos named events
  }

  // Send a chat message to the server for broadcast
  sendMessage(text: string): void {
    if (!text || text.trim().length === 0) return;
    this.channel.emit('chat_message', text.trim());
  }
}
