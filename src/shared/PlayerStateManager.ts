import PlayerState from './PlayerState';
import PlayerStateDTO from './PlayerStateDTO';
import { PlayerPoint } from './PlayerPoint';
import GameClock from './GameClock';
import GameArea from './GameArea';

export default class PlayerStateManager {
  id: string;
  activeState: PlayerState;
  cursorState: PlayerState;
  history: Map<number, PlayerStateDTO> = new Map();
  maxHistoryTicks: number = 120; // About 2 seconds of history

  constructor(activeState: PlayerState) {
    this.id = activeState.id;
    this.activeState = activeState;
    // Ghost state is used to hydrate past states for collision checks without allocating new objects
    this.cursorState = new PlayerState(
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

    // Prune old history
    const oldestAllowedTick = tick - this.maxHistoryTicks;
    for (const key of this.history.keys()) {
      if (key < oldestAllowedTick) {
        this.history.delete(key);
      }
    }
  }

  resetFromPlayerStateDTO(state: PlayerStateDTO) {
    this.activeState.load(state);
    this.history.clear();
  }

  // Returns PlayerState with data at given tick
  __getHydratedStateAtTick(tick: number): PlayerState {
    const dto = this.history.get(tick);
    if (dto) {
      this.cursorState.load(dto);
      this.cursorState.currentTick = tick;
      return this.cursorState;
    }

    // Fallback: if we don't have the exact tick, try to find the closest past tick
    let closestTick = -1;
    for (const key of this.history.keys()) {
      if (key <= tick && key > closestTick) {
        closestTick = key;
      }
    }

    if (closestTick !== -1) {
      this.cursorState.load(this.history.get(closestTick)!);
      this.cursorState.currentTick = closestTick;
      return this.cursorState;
    }

    // Ultimate fallback: return active state
    return this.activeState;
  }

  tick(
    currentTick: number,
    allManagers: PlayerStateManager[],
    gameArea: GameArea,
    gameClock: GameClock
  ) {
    if (currentTick != this.activeState.currentTick + 1) {
      console.warn(
        `[PlayerStateManager] Tick mismatch for ${this.id}: Expected ${this.activeState.currentTick + 1}, got ${currentTick}`
      );
      // Usually happens on initial load / desync snap before clock correctly aligns.
      // We force-snap the internal tracker to allow progression.
      this.activeState.currentTick = currentTick - 1;
    }
    // For a normal tick, we evaluate against the active states of other players
    const otherActiveStates = allManagers.map((m) => m.activeState);

    this.activeState.update(
      currentTick,
      otherActiveStates,
      gameArea,
      gameClock
    );

    this.saveState(currentTick);
  }

  reconcileTurn(
    turnPoint: PlayerPoint,
    gameClock: GameClock,
    gameArea: GameArea,
    allManagers: PlayerStateManager[]
  ) {
    // - set cursorstate : load dto from history at turnpoint tick
    const pastDto = this.history.get(turnPoint.tick);
    if (!pastDto) {
      console.warn(
        `[PlayerStateManager] No history found at turnPoint.tick ${turnPoint.tick} for player ${this.id}. Using active state.`
      );
      this.cursorState.load(this.activeState.serialize());
    } else {
      this.cursorState.load(pastDto);
    }

    this.cursorState.currentTick = turnPoint.tick;

    // Apply the turn point data directly to cursorState
    this.cursorState.x = turnPoint.coordinates.x;
    this.cursorState.y = turnPoint.coordinates.y;
    this.cursorState.direction = turnPoint.direction;
    this.cursorState.velocity = [...turnPoint.velocity];
    this.cursorState.speedMult = turnPoint.speed;
    this.cursorState.targetSpeedMult = turnPoint.speed;

    try {
      this.cursorState.trail.insertTurn(turnPoint);
    } catch (e) {
      console.warn(
        `[PlayerStateManager] Failed to fill turn for ${this.id}: ${e}`
      );
    }

    const targetTick = this.activeState.currentTick;

    // - update cursorstate tick by tick, until activestate tick, or until cursorstate dies
    // (by passing all states of at tick we're simulating)
    for (let simTick = turnPoint.tick + 1; simTick <= targetTick; simTick++) {
      if (!this.cursorState.isRunning || this.cursorState.rubber <= 0) {
        break;
      }

      const otherStates = allManagers
        .filter((m) => m.id !== this.id)
        .map((m) => {
          try {
            return m.__getHydratedStateAtTick(simTick);
          } catch (e) {
            // Fallback to active state if history doesn't exist
            return m.activeState;
          }
        });

      try {
        this.cursorState.update(simTick, otherStates, gameArea, gameClock);
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
    this.saveState(this.activeState.currentTick);
  }

  fastForwardFromPastState(
    pastDto: PlayerStateDTO,
    serverTick: number,
    gameClock: GameClock,
    gameArea: GameArea,
    allManagers: PlayerStateManager[]
  ) {
    // - set cursorstate : load dto from history at pastDto tick
    this.cursorState.load(pastDto);
    this.cursorState.currentTick = serverTick;

    const targetTick = this.activeState.currentTick;

    // - update cursorstate tick by tick, until activestate tick, or until cursorstate dies
    // (by passing all states of at tick we're simulating)
    for (let simTick = serverTick + 1; simTick <= targetTick; simTick++) {
      if (!this.cursorState.isRunning || this.cursorState.rubber <= 0) {
        break;
      }

      const otherStates = allManagers
        .filter((m) => m.id !== this.id)
        .map((m) => {
          try {
            return m.__getHydratedStateAtTick(simTick);
          } catch (e) {
            return m.activeState;
          }
        });

      try {
        this.cursorState.update(simTick, otherStates, gameArea, gameClock);
      } catch (e) {
        console.warn(
          `[PlayerStateManager] Error updating cursorState for ${this.id} at tick ${simTick}: ${e}`
        );
      }

      this.history.set(simTick, this.cursorState.serialize());
    }

    // - make activestate match cursorstate and saveState
    this.activeState.load(this.cursorState.serialize());
    this.activeState.currentTick = this.cursorState.currentTick;
    this.saveState(this.activeState.currentTick);
  }
}
