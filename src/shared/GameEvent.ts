export enum GameEventType {
  PlayerJoined,
  PlayerLeft,
  PlayerSpawn,
  PlayerDeath,
  PlayerTurn,
}

export interface GameEvent {
  type: GameEventType;
  playerId?: string;
}
