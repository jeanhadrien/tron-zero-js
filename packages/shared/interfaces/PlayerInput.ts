export interface PlayerInput {
  tick: number;
  playerId: string;
  turn?: 'left' | 'right';
  break?: boolean;
}
