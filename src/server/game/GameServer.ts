import { trace } from '@opentelemetry/api';
import GameRoom from '../../shared/GameRoom';
import GameArea from '../../shared/GameArea';
import GameClock from '../../shared/GameClock';
import BotController from '../BotController';

const tracer = trace.getTracer('tron-zero-server');

export class GameServer {
  gameRoom: GameRoom;
  gameArea: GameArea;
  gameClock: GameClock;

  bots: any[] = [];
  botControllers: BotController[] = [];

  constructor(gameRoom: GameRoom, gameArea: GameArea, gameClock: GameClock) {
    this.gameRoom = gameRoom;
    this.gameArea = gameArea;
    this.gameClock = gameClock;

    this.setupBots();
  }

  setupBots() {
    const BOT_COUNT = 10;
    for (let i = 1; i <= BOT_COUNT; i++) {
      this.bots.push(this.gameRoom.createPlayerWithForcedId(`bot${i}`));
      this.botControllers.push(new BotController());
    }
  }

  start() {
    // Fixed update loop at 60 FPS (approx 16.66ms)
    const TICK_RATE = 1000 / 60;
    let lastTime = performance.now();

    setInterval(() => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;

      const span = tracer.startSpan('game.tick');
      span.setAttribute('tick', this.gameClock.tick);
      span.setAttribute('player_count', this.gameRoom.playerManagers.size);
      span.setAttribute('bot_count', this.bots.length);

      this.gameRoom.update(delta);

      const allPlayers = this.gameRoom.getAllPlayers();
      for (let i = 0; i < this.bots.length; i++) {
        if (this.bots[i].isAlive == false) {
          this.gameRoom.spawnPlayer(this.bots[i]);
        }
        this.botControllers[i].update(this.bots[i], allPlayers, this.gameArea);
      }

      span.setAttribute('duration_ms', performance.now() - now);
      span.end();
    }, TICK_RATE);
  }
}
