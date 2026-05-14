import Player from './Player';
import PlayerStateManager from './PlayerStateManager';
import { GameEventBus } from './GameEventBus';
import GameClock from './GameClock';
import GameArea from './GameArea';
import { PlayerEventBus } from './PlayerStateEventBus';
import { PlayerDTO } from './Player';
import { Logger } from './Logger';

const MIN_COLOR_COMPONENT = 0x66;
const logger = new Logger('GameRoom');

function generatePlayerColor(): number {
  const r = MIN_COLOR_COMPONENT + Math.floor(Math.random() * (0x100 - MIN_COLOR_COMPONENT));
  const g = MIN_COLOR_COMPONENT + Math.floor(Math.random() * (0x100 - MIN_COLOR_COMPONENT));
  const b = MIN_COLOR_COMPONENT + Math.floor(Math.random() * (0x100 - MIN_COLOR_COMPONENT));
  return (r << 16) | (g << 8) | b;
}

export default class GameRoom {
  playerManagers: Map<string, PlayerStateManager>;
  playerEventBus: PlayerEventBus;
  gameArea: GameArea;
  gameEventBus: GameEventBus;
  gameClock: GameClock;

  constructor(bus: GameEventBus, area: GameArea, clock: GameClock) {
    this.gameEventBus = bus;
    this.playerEventBus = new PlayerEventBus();
    this.gameArea = area;
    this.gameClock = clock;
    this.playerManagers = new Map();
  }

  getPlayer(id: string): Player {
    const p = this.playerManagers.get(id);
    if (!p) throw new Error('Player not found');
    return p.activeState;
  }

  getRenderPosition(id: string, alpha: number): { x: number; y: number } | null {
    const m = this.playerManagers.get(id);
    if (!m) return null;
    return m.getInterpolatedRenderPosition(alpha);
  }

  getAllPlayers(): Player[] {
    return Array.from(this.playerManagers.values()).map((m) => m.activeState);
  }

  getState(): PlayerDTO[] {
    const dtos = [];
    for (const m of this.playerManagers.values()) {
      dtos.push(m.activeState.serialize());
    }
    return dtos;
  }

  registerPlayer(player: Player): Player {
    logger.info('+++ Register player', player.id);
    const manager = new PlayerStateManager(player, this.gameClock, this.gameArea);
    this.playerManagers.set(player.id, manager);
    this.gameEventBus.emit('game_add_player', player);
    return player;
  }

  spawnPlayer(player: Player) {
    logger.info('&&& Spawning player', player.id);
    const pm = this.playerManagers.get(player.id);
    if (pm?.activeState) {
      pm.activeState = player;
      pm.history.clear();
    }

    player.spawn(
      100 + Math.random() * (this.gameArea.width - 200),
      100 + Math.random() * (this.gameArea.height - 200),
      Math.floor(Math.random() * 4) * (Math.PI / 2),
      this.gameClock.tickTimeMs
    );
  }

  createPlayerWithForcedId(id: string) {
    const p = new Player(
      this.playerEventBus,
      this.gameClock.tick,
      0,
      0,
      Math.floor(Math.random() * 4) * (Math.PI / 2),
      generatePlayerColor()
    );
    p.id = id;
    this.registerPlayer(p);
    return p;
  }

  removePlayerById(id: string) {
    let p = this.playerManagers.get(id);
    if (p) {
      this.playerManagers.delete(id);
      this.gameEventBus.emit('game_remove_player', p.activeState);
      logger.debug('--- Removed player', id);
      return;
    }
    logger.warn(`Trying to remove player ${id} that doesn't exist`);
  }

  update(deltaTime: number) {
    const ticksToProcess = this.gameClock.update(deltaTime);
    const startTick = this.gameClock.tick - ticksToProcess + 1;

    const allManagers = Array.from(this.playerManagers.values());
    for (let index = 0; index < ticksToProcess; index++) {
      const currentSimTick = startTick + index;
      for (const m of allManagers) {
        m.update(currentSimTick, allManagers);
      }
    }
  }
}
