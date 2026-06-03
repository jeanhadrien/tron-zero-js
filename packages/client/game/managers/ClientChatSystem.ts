import { ClientChannel } from '@geckos.io/client';
import { ChatMessageBuffer } from '@tron0/shared/ChatMessageBuffer';
import { ChatMessage } from '@tron0/shared/interfaces/ChatMessage';
import { EventBus } from '../managers/EventBus';

/**
 * Standalone chat relay — listens to geckos named events and pushes messages
 * to the UI via {@link EventBus}.
 *
 * No longer an ECS System; chat has no interaction with the simulation world.
 */
export class ClientChatSystem {
  readonly messages: ChatMessageBuffer;

  private getChannel: () => ClientChannel;

  constructor(getChannel: () => ClientChannel) {
    this.getChannel = getChannel;
    this.messages = new ChatMessageBuffer(100);
  }

  /** Attach geckos listeners. Call once after the channel is created. */
  wire(): void {
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

  /** Send a chat message to the server for broadcast. */
  sendMessage(text: string): void {
    if (!text || text.trim().length === 0) return;
    const channel = this.getChannel();
    if (!channel) return;
    channel.emit('chat_message', text.trim());
  }
}
