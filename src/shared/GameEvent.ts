export enum GameEventType {
  PlayerJoined,
  PlayerLeft,
  PlayerSpawn,
  PlayerDeath,
  PlayerTurn,
  GameStart,
  GameStop,
  GamePause,
}

export interface GameEvent {
  tick: number;
  type: GameEventType;
  entityId?: number;
  playerId?: string;
}
