import GameRoom from '../../shared/GameRoom';
import GameArea from '../../shared/GameArea';
import GameClock from '../../shared/GameClock';
import BotController from '../BotController';

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
    this.bots.push(this.gameRoom.createPlayerWithForcedId('bot1'));
    this.bots.push(this.gameRoom.createPlayerWithForcedId('bot2'));
    this.bots.push(this.gameRoom.createPlayerWithForcedId('bot3'));
    this.bots.push(this.gameRoom.createPlayerWithForcedId('bot4'));
    this.bots.push(this.gameRoom.createPlayerWithForcedId('bot5'));

    this.botControllers.push(new BotController());
    this.botControllers.push(new BotController());
    this.botControllers.push(new BotController());
    this.botControllers.push(new BotController());
    this.botControllers.push(new BotController());
  }

  start() {
    // Fixed update loop at 60 FPS (approx 16.66ms)
    const TICK_RATE = 1000 / 60;
    let lastTime = performance.now();

    setInterval(() => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      this.gameRoom.update(delta);
      
      const allPlayers = this.gameRoom.getAllPlayers();
      for (let i = 0; i < this.bots.length; i++) {
        if (this.bots[i].isRunning == false) {
          this.gameRoom.spawnPlayer(this.bots[i]);
        }
      }

      for (let i = 0; i < this.bots.length; i++) {
        this.botControllers[i].update(this.bots[i], allPlayers, this.gameArea);
      }
    }, TICK_RATE);
  }
}
