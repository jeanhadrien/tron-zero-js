import { EventEmitter } from 'eventemitter3';
import PlayerState from './PlayerState';

export class GameEventBus extends EventEmitter<GameEvents> {}

export interface GameEvents {
  game_add_player: (player: PlayerState) => void;
  game_remove_player: (player: PlayerState) => void;
}
