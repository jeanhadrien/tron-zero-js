export interface ChatMessage {
  tick: number;
  timestamp: number;
  type: 'player' | 'event';
  playerId?: string;
  text: string;
  color?: number;
}
