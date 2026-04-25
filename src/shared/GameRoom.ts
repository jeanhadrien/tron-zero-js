import PlayerState from './PlayerState';
import { GameEventBus } from './GameEventBus';
import GameClock from './GameClock';
import GameArea from './GameArea';
import { PlayerEventBus } from './PlayerStateEventBus';
import PlayerStateDTO from './PlayerStateDTO';

export default class GameRoom {
  players: Map<string, PlayerState>;
  playerEventBus: PlayerEventBus;
  area: GameArea;
  bus: GameEventBus;
  clock: GameClock;

  constructor(bus: GameEventBus, area: GameArea, clock: GameClock) {
    this.bus = bus;
    this.playerEventBus = new PlayerEventBus();
    this.area = area;
    this.clock = clock;
    this.players = new Map();
  }

  getPlayer(id: string): PlayerState {
    const p = this.players.get(id);
    if (!p) throw new Error('Player not found');
    return p;
  }

  getAllPlayers(): PlayerState[] {
    return Array.from(this.players.values());
  }

  getState(): PlayerStateDTO[] {
    const dtos = [];
    for (const p of this.players) {
      dtos.push(p[1].serialize());
    }
    return dtos;
  }

  registerPlayer(player: PlayerState): PlayerState {
    console.info('+++ Register player', player.id);
    this.players.set(player.id, player);
    return player;
  }

  handleTurn(id: string, direction: 'left' | 'right', tick?: number) {
    const player = this.players.get(id);
    if (player) {
      player.queueTurn(direction, tick);
    }
  }

  spawnPlayer(player: PlayerState) {
    console.info('&&& Spawning player', player.id);
    player.spawn(
      100 + Math.random() * (this.area.width - 200),
      100 + Math.random() * (this.area.height - 200),
      Math.floor(Math.random() * 4) * (Math.PI / 2),
      this.clock.tickTimeMs
    );
  }

  createPlayerWithForcedId(id: string) {
    const p = new PlayerState(
      this.playerEventBus,
      this.clock.tick,
      0,
      0,
      Math.floor(Math.random() * 4) * (Math.PI / 2),
      Math.random() * 0xffffff
    );
    p.id = id;
    this.registerPlayer(p);
    return p;
  }

  removePlayerById(id: string) {
    let p = this.players.get(id);
    if (p) {
      //p.destroy();
      this.players.delete(id);
      console.debug('--- Removed player', id);
      return;
    }
    throw new Error(`Trying to remove player ${id} that doesn't exist`);
  }

  update(deltaTime: number) {
    const ticksToProcess = this.clock.update(deltaTime);
    const startTick = this.clock.tick - ticksToProcess + 1;

    const allPlayers = Array.from(this.players.values());
    for (let index = 0; index < ticksToProcess; index++) {
      const currentSimTick = startTick + index;
      for (const p of allPlayers) {
        p.update(currentSimTick, allPlayers, this.area, this.clock);
      }
    }
  }
}
