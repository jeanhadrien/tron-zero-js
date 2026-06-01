import { ClientChannel } from '@geckos.io/client';
import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import { ChatMessageBuffer } from '@tron0/shared/ChatMessageBuffer';
import { ChatMessage } from '@tron0/shared/interfaces/ChatMessage';
import { EventBus } from '../managers/EventBus';

export class ClientChatSystem extends System {
  readonly key = 'chat-client';

  private getChannel: () => ClientChannel;
  readonly messages: ChatMessageBuffer;

  constructor(getChannel: () => ClientChannel) {
    super();
    this.getChannel = getChannel;
    this.messages = new ChatMessageBuffer(100);
  }

  getComponents(): object[] {
    return [];
  }

  init(_room: ECSGameRoom): void {
    const channel = this.getChannel();
    if (!channel) return;
    channel.on('chat', (data: any) => {
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
    const channel = this.getChannel();
    if (!channel) return;
    channel.emit('chat_message', text.trim());
  }
}
