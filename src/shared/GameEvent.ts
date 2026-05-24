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
  type: GameEventType;
  entityId?: number;
  playerId?: string;
}
