import { EventEmitter } from 'eventemitter3';
import Player from './Player';
import { PlayerPoint } from './PlayerPoint';

export class PlayerEventBus extends EventEmitter<PlayerEvents> {}

export interface PlayerEvents {
  player_turn: (player: Player, turnPoint: PlayerPoint) => void;
  player_death: (player: Player) => void;
  player_spawn: (player: Player) => void;
}
