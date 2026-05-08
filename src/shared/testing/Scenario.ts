import Player from '../Player';
import { PlayerEventBus } from '../PlayerStateEventBus';
import GameArea from '../GameArea';
import GameClock from '../GameClock';
import { PlayerDriver, directionToRad, type Action } from './PlayerDriver';
import type { PlayerSnapshot } from './PlayerSnapshot';

interface RunState {
  name: string;
  player: Player;
  plan: Action[];
  actionIndex: number;
  moveDistance: number;
  moveStart: { x: number; y: number } | null;
  waitRemaining: number;
  done: boolean;
  dead: boolean;
  hasSpawned: boolean;
}

const COLORS = [0xff4444, 0x4444ff, 0x44ff44, 0xffff44, 0xff44ff, 0x44ffff];

export class ScenarioResults {
  constructor(private snapshots: Map<string, PlayerSnapshot>) {}

  player(name: string): PlayerSnapshot {
    const s = this.snapshots.get(name);
    if (!s) {
      throw new Error(
        `No player named "${name}". Available: ${[...this.snapshots.keys()].join(', ')}`
      );
    }
    return s;
  }
}

export default class Scenario {
  private gameArea: GameArea;
  private gameClock: GameClock;
  private drivers = new Map<string, PlayerDriver>();

  constructor(options?: {
    width?: number;
    height?: number;
    tickTimeMs?: number;
  }) {
    this.gameArea = new GameArea(options?.width, options?.height);
    this.gameClock = new GameClock(options?.tickTimeMs);
  }

  player(name: string): PlayerDriver {
    if (this.drivers.has(name)) {
      throw new Error(`Player "${name}" already exists`);
    }
    const driver = new PlayerDriver(name, this);
    this.drivers.set(name, driver);
    return driver;
  }

  simulate(maxTicks = 5000): ScenarioResults {
    const runStates: RunState[] = [];
    let colorIdx = 0;

    for (const driver of this.drivers.values()) {
      const bus = new PlayerEventBus();
      const player = new Player(
        bus,
        0,
        0,
        0,
        0,
        COLORS[colorIdx++ % COLORS.length]
      );
      runStates.push({
        name: driver.name,
        player,
        plan: driver.plan,
        actionIndex: 0,
        moveDistance: 0,
        moveStart: null,
        waitRemaining: 0,
        done: false,
        dead: false,
        hasSpawned: false,
      });
    }

    const allPlayers = runStates.map((rs) => rs.player);
    let tick = 1;

    while (tick <= maxTicks) {
      let anyDead = false;

      // Phase 1: Process immediate actions (speed, spawn)
      for (const rs of runStates) {
        if (rs.done || rs.dead) continue;

        while (rs.actionIndex < rs.plan.length) {
          const action = rs.plan[rs.actionIndex];

          if (action.type === 'speed') {
            rs.player.speedMult = action.mult;
            rs.player.targetSpeedMult = action.mult;
            rs.player._setSpeedAndVelocity(
              action.mult,
              this.gameClock.tickTimeMs
            );
            rs.actionIndex++;
            continue;
          }

          if (action.type === 'spawn') {
            const rad = directionToRad(action.direction);
            rs.player.spawn(action.x, action.y, rad, this.gameClock.tickTimeMs);
            rs.hasSpawned = true;
            rs.actionIndex++;
            continue;
          }

          break;
        }
      }

      // Phase 2: Queue turns
      for (const rs of runStates) {
        if (rs.done || rs.dead) continue;
        if (rs.actionIndex >= rs.plan.length) {
          rs.done = true;
          continue;
        }

        const action = rs.plan[rs.actionIndex];
        if (action.type === 'turn') {
          rs.player.queueTurn(action.dir, tick);
        }
      }

      // Phase 3: Update all players
      for (const rs of runStates) {
        if (rs.done || rs.dead) continue;
        if (rs.actionIndex >= rs.plan.length) continue;

        const action = rs.plan[rs.actionIndex];
        const prevX = rs.player.x;
        const prevY = rs.player.y;

        const otherPlayers = allPlayers.filter((p) => p.id !== rs.player.id);
        const sharedObstacles = Player.buildSharedCollidableLines(
          otherPlayers,
          this.gameArea
        );
        rs.player.update(tick, this.gameArea, this.gameClock, sharedObstacles);

        if (action.type === 'move') {
          if (!rs.moveStart) {
            rs.moveStart = { x: prevX, y: prevY };
          }
          const dx = rs.player.x - prevX;
          const dy = rs.player.y - prevY;
          rs.moveDistance += Math.sqrt(dx * dx + dy * dy);
        }

        if (!rs.player.isRunning || rs.player.rubber <= 0) {
          rs.dead = true;
          rs.done = true;
          anyDead = true;
        }
      }

      if (anyDead) break;

      // Phase 4: Advance action pointers
      for (const rs of runStates) {
        if (rs.done || rs.dead) continue;
        if (rs.actionIndex >= rs.plan.length) {
          rs.done = true;
          continue;
        }

        const action = rs.plan[rs.actionIndex];

        if (action.type === 'turn') {
          rs.actionIndex++;
        } else if (action.type === 'move') {
          if (rs.moveDistance >= action.distance) {
            rs.actionIndex++;
            rs.moveDistance = 0;
            rs.moveStart = null;
          }
        } else if (action.type === 'wait') {
          if (rs.waitRemaining <= 0) {
            rs.waitRemaining = action.ticks;
          }
          rs.waitRemaining--;
          if (rs.waitRemaining <= 0) {
            rs.actionIndex++;
          }
        }
      }

      if (runStates.every((rs) => rs.done)) break;

      tick++;
    }

    const snapshots = new Map<string, PlayerSnapshot>();
    for (const rs of runStates) {
      snapshots.set(rs.name, {
        name: rs.name,
        dead: rs.dead || !rs.player.isRunning,
        alive: !rs.dead && rs.player.isRunning,
        x: rs.player.x,
        y: rs.player.y,
        direction: rs.player.direction,
        trailLength: rs.player.trail.getPoints().length,
        rubber: rs.player.rubber,
        speedMult: rs.player.speedMult,
      });
    }

    return new ScenarioResults(snapshots);
  }
}
