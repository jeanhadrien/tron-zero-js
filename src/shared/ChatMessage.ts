export interface ChatMessage {
  tick: number;
  timestamp: number;
  type: 'player' | 'event';
  playerId?: string;
  text: string;
}

// Ring buffer for chat messages, capped at maxSize
export class ChatMessageBuffer {
  private messages: ChatMessage[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  push(message: ChatMessage): void {
    this.messages.push(message);
    if (this.messages.length > this.maxSize) {
      this.messages = this.messages.slice(-this.maxSize);
    }
  }

  getAll(): ChatMessage[] {
    return [...this.messages];
  }
}
