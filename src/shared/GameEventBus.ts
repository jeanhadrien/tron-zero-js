import { EventEmitter } from 'eventemitter3';
import PlayerState, { PlayerPoint } from './PlayerState';
import { ServerChannel } from '@geckos.io/server';
// We pass this single object around instead of 20 different hooks
export class GameEventBus extends EventEmitter<GameEvents> { }

export interface GameEvents {
    "player_turn2": (player: PlayerState, turnPoint: PlayerPoint) => void;
    "player_death": (player: PlayerState) => void;
    "new_player": (id: ServerChannel) => void;
}