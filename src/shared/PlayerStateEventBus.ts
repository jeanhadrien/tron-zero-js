import { EventEmitter } from 'eventemitter3';
import PlayerState from './PlayerState';
import { PlayerPoint } from './PlayerPoint';

export class PlayerEventBus extends EventEmitter<PlayerEvents> {}

export interface PlayerEvents {
  player_turn: (player: PlayerState, turnPoint: PlayerPoint) => void;
  player_death: (player: PlayerState) => void;
  player_spawn: (player: PlayerState) => void;
}
