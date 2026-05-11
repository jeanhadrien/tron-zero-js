import Player from './Player';
import { PlayerDTO } from './Player';
import { PlayerPoint } from './PlayerPoint';
import { TickRingBuffer } from './TickRingBuffer';
import GameClock from './GameClock';
import GameArea from './GameArea';
import { Logger } from './Logger';

const logger = new Logger('PlayerStateManager');

export default class PlayerStateManager {
  id: string;
  activeState: Player;
  cursorState: Player;
  history: Map<number, PlayerDTO> = new Map();
  maxHistoryTicks: number = 120; // About 2 seconds of history
  knownPlayerPoints = new TickRingBuffer<PlayerPoint>(128);
  previousState: PlayerDTO | null = null;
  correctionTarget: { x: number; y: number } | null = null;
  readonly gameClock: GameClock;
  readonly gameArea: GameArea;

  constructor(activeState: Player, gameClock: GameClock, gameArea: GameArea) {
    this.id = activeState.id;
    this.gameClock = gameClock;
    this.gameArea = gameArea;
    this.activeState = activeState;
    this.previousState = activeState.serialize();
    // Ghost state is used to hydrate past states for collision checks without allocating new objects
    this.cursorState = new Player(
      activeState.eventBus,
      activeState.currentTick,
      0,
      0,
      0,
      0
    );
  }

  saveState(tick: number) {
    this.history.set(tick, this.activeState.serialize());
    this.previousState = this.history.get(tick - 1)!;

    // Prune old history
    const oldestAllowedTick = tick - this.maxHistoryTicks;
    for (const key of this.history.keys()) {
      if (key < oldestAllowedTick) {
        this.history.delete(key);
      }
    }
  }

  resetFromPlayerStateDTO(state: PlayerDTO) {
    this.activeState.load(state);
    this.previousState = state;
    this.history.clear();
    this.knownPlayerPoints = new TickRingBuffer<PlayerPoint>(128);
    this.correctionTarget = null;
  }

  applyServerCorrection(correctedState: PlayerDTO) {
    this.activeState.x = correctedState.x;
    this.activeState.y = correctedState.y;
    this.correctionTarget = { x: correctedState.x, y: correctedState.y };
  }

  getInterpolatedRenderPosition(alpha: number): { x: number; y: number } {
    if (!this.previousState) {
      return { x: this.activeState.x, y: this.activeState.y };
    }

    let x =
      this.previousState.x +
      (this.activeState.x - this.previousState.x) * alpha;
    let y =
      this.previousState.y +
      (this.activeState.y - this.previousState.y) * alpha;

    if (this.correctionTarget) {
      const lerpFactor = 0.15;
      x = x + (this.correctionTarget.x - x) * lerpFactor;
      y = y + (this.correctionTarget.y - y) * lerpFactor;

      const dx = Math.abs(this.correctionTarget.x - x);
      const dy = Math.abs(this.correctionTarget.y - y);
      if (dx < 0.5 && dy < 0.5) {
        this.correctionTarget = null;
      }
    }

    return { x, y };
  }

  // Returns PlayerState with data at given tick
  getHistoryStateAtTick(tick: number): Player {
    const dto = this.history.get(tick);
    if (dto) {
      this.cursorState.load(dto);
      if (this.cursorState.currentTick !== tick) {
        throw new Error('invalid tick');
      }
      this.cursorState.currentTick = tick;
      return this.cursorState;
    }
    throw new Error('missing tick');
  }

  getHistoryStateAtLowerBoundTick(tick: number): Player | null {
    // Try exact match first
    const dto = this.history.get(tick);
    if (dto) {
      this.cursorState.load(dto);
      this.cursorState.currentTick = tick;
      return this.cursorState;
    }
    // Walk down to closest lower tick
    let bestDto = null;
    let bestTick = -1;
    for (const entry of this.history.values()) {
      if (entry.tick < tick && entry.tick > bestTick) {
        bestTick = entry.tick;
        bestDto = entry;
      }
    }
    if (bestDto) {
      this.cursorState.load(bestDto);
      this.cursorState.currentTick = bestTick;
      return this.cursorState;
    }
    return null;
  }

  // Receive a target tick to update our active player state to
  update(targetTick: number, allPlayerStateManagers: PlayerStateManager[]) {
    if (targetTick < this.activeState.currentTick) {
      logger.warn(`Loading a past tick for ${targetTick} for ${this.id}`);
      const cursorState = this.getHistoryStateAtLowerBoundTick(targetTick);
      if (!cursorState) {
        this.activeState.currentTick = targetTick;
      } else {
        this.activeState = cursorState;
      }
      this.saveState(targetTick);
      return;
    }

    if (targetTick == this.activeState.currentTick) {
      logger.warn(`Nothing to do for ${this.id} at tick ${targetTick}`);
      this.saveState(targetTick);
      return;
    }

    if (targetTick > this.activeState.currentTick + 1) {
      logger.warn(
        `fast forwarding to ${targetTick} from ${this.activeState.currentTick}`
      );
    }

    for (
      let _catchupTick = this.activeState.currentTick + 1;
      _catchupTick <= targetTick;
      _catchupTick++
    ) {
      const knownPlayerPoint = this.knownPlayerPoints.get(
        _catchupTick,
        this.id
      );
      if (knownPlayerPoint) {
        this.activeState.x = knownPlayerPoint.coordinates.x;
        this.activeState.y = knownPlayerPoint.coordinates.y;
        this.activeState.direction = knownPlayerPoint.direction;
        this.activeState.velocity = [...knownPlayerPoint.velocity];
        this.activeState.speedMult = knownPlayerPoint.speedMult;
        try {
          this.activeState.trail.insertTurn(knownPlayerPoint);
        } catch (e) {
          logger.warn(`Failed to fill turn for ${this.id}: ${e}`);
        }
      }

      const otherStates = allPlayerStateManagers
        .filter((m) => m.id !== this.id)
        .map((m) => {
          try {
            return m.getHistoryStateAtTick(_catchupTick);
          } catch {
            return m.activeState;
          }
        })
        .filter((s): s is Player => s !== null);

      const otherObstacles = Player.buildSharedCollidableLines(
        otherStates,
        this.gameArea
      );

      this.activeState.update(_catchupTick, this.gameClock, otherObstacles);
      this.saveState(_catchupTick);
    }
  }

  // Take a list of potentially new turn points to include in our state
  reconcileTurns(turnPoints: PlayerPoint[], allManagers: PlayerStateManager[]) {
    if (!turnPoints || turnPoints.length === 0) return;

    let added = false;
    let earliestPastTick = Infinity;

    for (const turn of turnPoints) {
      if (this.knownPlayerPoints.get(turn.tick, this.id) !== null)
        continue;

      this.knownPlayerPoints.record(turn.tick, this.id, turn);
      added = true;
      if (turn.tick <= this.activeState.currentTick) {
        earliestPastTick = Math.min(earliestPastTick, turn.tick);
      }
    }

    if (!added || earliestPastTick === Infinity) return;

    const startTick = earliestPastTick;

    const cursorState = this.getHistoryStateAtLowerBoundTick(startTick);
    if (!cursorState) {
      logger.warn(
        `No history found at turn.tick ${startTick} for player ${this.id}. Using active state.`
      );
      this.cursorState.load(this.activeState.serialize());
      this.cursorState.currentTick = startTick;
    } else {
      this.cursorState.currentTick = startTick;
    }

    this.cursorState.turnQueue = [];

    for (
      let simTick = startTick;
      simTick <= this.activeState.currentTick;
      simTick++
    ) {
      if (!this.cursorState.isAlive || this.cursorState.rubber <= 0) {
        break;
      }

      const knownTurn = this.knownPlayerPoints.get(simTick, this.id);
      if (knownTurn) {
        // Apply the turn point data directly to cursorState
        this.cursorState.x = knownTurn.coordinates.x;
        this.cursorState.y = knownTurn.coordinates.y;
        this.cursorState.direction = knownTurn.direction;
        this.cursorState.velocity = [...knownTurn.velocity];
        this.cursorState.speedMult = knownTurn.speedMult;

        try {
          this.cursorState.trail.insertTurn(knownTurn);
        } catch (e) {
          console.warn(
            `[PlayerStateManager] Failed to fill turn for ${this.id}: ${e}`
          );
        }
      }

      const otherStates = allManagers
        .filter((m) => m.id !== this.id)
        .map((m) => {
          try {
            const playerState = m.getHistoryStateAtTick(simTick)!;
            return playerState;
          } catch (e) {
            return null;
          }
        })
        .filter((s): s is Player => s !== null);

      if (!otherStates) throw new Error();

      try {
        const sharedObstacles = Player.buildSharedCollidableLines(
          otherStates,
          this.gameArea
        );
        this.cursorState.update(simTick, this.gameClock, sharedObstacles);
      } catch (e) {
        console.warn(
          `[PlayerStateManager] Error updating cursorState for ${this.id} at tick ${simTick}: ${e}`
        );
      }

      // Update history inline to ensure subsequent collision checks for this frame are accurate
      this.history.set(simTick, this.cursorState.serialize());
    }

    // - make activestate match cursorstate and saveState
    this.activeState.load(this.cursorState.serialize());
    this.activeState.currentTick = this.cursorState.currentTick;
    this.previousState = this.activeState.serialize();
    this.correctionTarget = null;
    this.saveState(this.activeState.currentTick);
  }

  fastForwardFromPastState(
    pastDto: PlayerDTO,
    serverTick: number,
    gameClock: GameClock,
    gameArea: GameArea,
    allManagers: PlayerStateManager[]
  ) {
    // - set cursorstate : load dto from history at pastDto tick
    this.cursorState.load(pastDto);
    this.cursorState.currentTick = serverTick;
    this.cursorState.turnQueue = [];

    const targetTick = this.activeState.currentTick;

    // - update cursorstate tick by tick, until activestate tick, or until cursorstate dies
    // (by passing all states of at tick we're simulating)
    for (let simTick = serverTick + 1; simTick <= targetTick; simTick++) {
      if (!this.cursorState.isAlive || this.cursorState.rubber <= 0) {
        break;
      }

      const knownTurn = this.knownPlayerPoints.get(simTick, this.id);
      if (knownTurn) {
        this.cursorState.x = knownTurn.coordinates.x;
        this.cursorState.y = knownTurn.coordinates.y;
        this.cursorState.direction = knownTurn.direction;
        this.cursorState.velocity = [...knownTurn.velocity];
        this.cursorState.speedMult = knownTurn.speedMult;

        try {
          this.cursorState.trail.insertTurn(knownTurn);
        } catch (e) {
          logger.warn(`Failed to fill turn for ${this.id}: ${e}`);
        }
      }

      const otherStates = allManagers
        .filter((m) => m.id !== this.id)
        .map((m) => {
          try {
            return m.getHistoryStateAtTick(simTick);
          } catch (e) {
            return m.activeState;
          }
        });

      try {
        const sharedObstacles = Player.buildSharedCollidableLines(
          otherStates,
          gameArea
        );
        this.cursorState.update(simTick, gameClock, sharedObstacles);
      } catch (e) {
        logger.warn(
          `Error updating cursorState for ${this.id} at tick ${simTick}: ${e}`
        );
      }

      this.history.set(simTick, this.cursorState.serialize());
    }

    // - make activestate match cursorstate and saveState
    this.activeState.load(this.cursorState.serialize());
    this.activeState.currentTick = this.cursorState.currentTick;
    this.previousState = this.activeState.serialize();
    this.correctionTarget = null;
    this.saveState(this.activeState.currentTick);
  }
}
