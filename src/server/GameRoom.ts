import { GameEventBus } from '../shared/GameEventBus';
import PlayerState from '../shared/PlayerState';
import PlayerStateDTO from '../shared/PlayerStateDTO';
import { PlayerEventBus } from '../shared/PlayerStateEventBus';
import BotController from './BotController';
import * as Phaser from 'phaser';

export default class GameRoom {
  players: Map<string, PlayerState>;
  playerEventBus: PlayerEventBus;
  bus: GameEventBus;
  bots: Map<string, BotController>;
  worldWidth = 2000;
  worldHeight = 2000;

  constructor() {
    this.bus = new GameEventBus();
    this.playerEventBus = new PlayerEventBus();
    this.players = new Map();
    this.bots = new Map();
    // Initialize some bots
    for (let i = 0; i < 5; i++) {
      const botId = `bot_${i}`;
      const startX = 100 + Math.random() * (this.worldWidth - 200);
      const startY = 100 + Math.random() * (this.worldHeight - 200);
      const state = new PlayerState(
        this.playerEventBus,
        0,
        startX,
        startY,
        Math.floor(Math.random() * 4) * (Math.PI / 2),
        Math.random() * 0xffffff
      );
      state.id = botId;
      state.isRunning = true;
      this.players.set(botId, state);
      const botController = new BotController(state);
      this.bots.set(botId, botController);
    }
  }
}
