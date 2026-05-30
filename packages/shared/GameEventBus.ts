import { EventEmitter } from 'eventemitter3';
import Player from './Player';

export class GameEventBus extends EventEmitter<GameEvents> {}

export interface GameEvents {
  game_add_player: (player: Player) => void;
  game_remove_player: (player: Player) => void;
}
