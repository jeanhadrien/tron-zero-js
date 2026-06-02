export interface PlayerInput {
  tick: number;
  playerId: string;
  turn?: 'left' | 'right';
  break?: boolean;
  /** 0–1 interpolation point within the tick interval where the turn was pressed. */
  alpha?: number;
}
