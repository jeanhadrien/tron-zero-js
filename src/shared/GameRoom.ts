import PlayerState from './PlayerState';
import PlayerStateManager from './PlayerStateManager';
import { GameEventBus } from './GameEventBus';
import GameClock from './GameClock';
import GameArea from './GameArea';
import { PlayerEventBus } from './PlayerStateEventBus';
import PlayerStateDTO from './PlayerStateDTO';

export default class GameRoom {
  playerManagers: Map<string, PlayerStateManager>;
  playerEventBus: PlayerEventBus;
  area: GameArea;
  bus: GameEventBus;
  clock: GameClock;

  constructor(bus: GameEventBus, area: GameArea, clock: GameClock) {
    this.bus = bus;
    this.playerEventBus = new PlayerEventBus();
    this.area = area;
    this.clock = clock;
    this.playerManagers = new Map();
  }

  getPlayer(id: string): PlayerState {
    const p = this.playerManagers.get(id);
    if (!p) throw new Error('Player not found');
    return p.activeState;
  }

  getAllPlayers(): PlayerState[] {
    return Array.from(this.playerManagers.values()).map((m) => m.activeState);
  }

  getState(): PlayerStateDTO[] {
    const dtos = [];
    for (const m of this.playerManagers.values()) {
      dtos.push(m.activeState.serialize());
    }
    return dtos;
  }

  registerPlayer(player: PlayerState): PlayerState {
    console.info('+++ Register player', player.id);
    const manager = new PlayerStateManager(player);
    this.playerManagers.set(player.id, manager);
    return player;
  }

  spawnPlayer(player: PlayerState) {
    console.info('&&& Spawning player', player.id);
    const pm = this.playerManagers.get(player.id);
    if (pm?.activeState) {
      pm.activeState = player;
      pm.history.clear();
    }

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
    let p = this.playerManagers.get(id);
    if (p) {
      this.playerManagers.delete(id);
      console.debug('--- Removed player', id);
      return;
    }
    console.warn(`Trying to remove player ${id} that doesn't exist`);
  }

  update(deltaTime: number) {
    const ticksToProcess = this.clock.update(deltaTime);
    const startTick = this.clock.tick - ticksToProcess + 1;

    const allManagers = Array.from(this.playerManagers.values());
    for (let index = 0; index < ticksToProcess; index++) {
      const currentSimTick = startTick + index;
      for (const m of allManagers) {
        m.tick(currentSimTick, allManagers, this.area, this.clock);
      }
    }
  }
}
