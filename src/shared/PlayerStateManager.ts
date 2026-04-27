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

  reconcileTurns(
    turnPoints: PlayerPoint[],
    gameClock: GameClock,
    gameArea: GameArea,
    allManagers: PlayerStateManager[]
  ) {
    if (!turnPoints || turnPoints.length === 0) return;

    // Sort turns chronologically
    const sortedTurns = [...turnPoints].sort((a, b) => a.tick - b.tick);

    // We rewind to the earliest turn
    const firstTurn = sortedTurns[0];

    // - set cursorstate : load dto from history at earliest turn point tick
    const pastDto = this.history.get(firstTurn.tick);
    if (!pastDto) {
      console.warn(
        `[PlayerStateManager] No history found at turn.tick ${firstTurn.tick} for player ${this.id}. Using active state.`
      );
      this.cursorState.load(this.activeState.serialize());
      this.cursorState.currentTick = firstTurn.tick;
    } else {
      this.cursorState.load(pastDto);
      this.cursorState.currentTick = firstTurn.tick;
    }

    let currentTurnIndex = 0;

    // - update cursorstate tick by tick, until activestate tick, or until cursorstate dies
    // Apply turns at exactly their specific ticks before advancing
    for (
      let simTick = firstTurn.tick;
      simTick <= this.activeState.currentTick;
      simTick++
    ) {
      if (!this.cursorState.isRunning || this.cursorState.rubber <= 0) {
        break;
      }

      let appliedTurnThisTick = false;

      // Check if there are any turns to apply exactly at this simTick
      while (
        currentTurnIndex < sortedTurns.length &&
        sortedTurns[currentTurnIndex].tick === simTick
      ) {
        const currentTurn = sortedTurns[currentTurnIndex];

        // Apply the turn point data directly to cursorState
        this.cursorState.x = currentTurn.coordinates.x;
        this.cursorState.y = currentTurn.coordinates.y;
        this.cursorState.direction = currentTurn.direction;
        this.cursorState.velocity = [...currentTurn.velocity];
        this.cursorState.speedMult = currentTurn.speedMult;
        this.cursorState.currentTick = simTick;

        try {
          this.cursorState.trail.insertTurn(currentTurn);
        } catch (e) {
          console.warn(
            `[PlayerStateManager] Failed to fill turn for ${this.id}: ${e}`
          );
        }

        appliedTurnThisTick = true;
        currentTurnIndex++;
      }

      // Only step forward simulation if we didn't just forcefully apply a turn's state
      // (The turn point already contains the result of the simulation for this tick)
      if (!appliedTurnThisTick) {
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
