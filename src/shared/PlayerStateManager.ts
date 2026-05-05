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
  knownTurns: PlayerPoint[] = [];
  previousState: PlayerStateDTO | null = null;
  correctionTarget: { x: number; y: number } | null = null;

  constructor(activeState: PlayerState) {
    this.id = activeState.id;
    this.activeState = activeState;
    this.previousState = activeState.serialize();
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
    this.knownTurns = this.knownTurns.filter(
      (t) => t.tick >= oldestAllowedTick
    );
  }

  resetFromPlayerStateDTO(state: PlayerStateDTO) {
    this.activeState.load(state);
    this.previousState = state;
    this.history.clear();
    this.knownTurns = [];
    this.correctionTarget = null;
  }

  applyServerCorrection(correctedState: PlayerStateDTO) {
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
  __getHistoryStateAtTick(tick: number): PlayerState {
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
    this.previousState = this.activeState.serialize();

    // For a normal tick, we evaluate against the active states of other players
    const otherActiveStates = allManagers.map((m) => m.activeState);

    const knownTurn = this.knownTurns.find((t) => t.tick === currentTick);
    if (knownTurn) {
      this.activeState.x = knownTurn.coordinates.x;
      this.activeState.y = knownTurn.coordinates.y;
      this.activeState.direction = knownTurn.direction;
      this.activeState.velocity = [...knownTurn.velocity];
      this.activeState.speedMult = knownTurn.speedMult;
      try {
        this.activeState.trail.insertTurn(knownTurn);
      } catch (e) {
        console.warn(
          `[PlayerStateManager] Failed to fill turn for ${this.id}: ${e}`
        );
      }
    }

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

    let added = false;
    let earliestPastTick = Infinity;

    for (const turn of turnPoints) {
      if (!this.knownTurns.some((t) => t.tick === turn.tick)) {
        this.knownTurns.push(turn);
        added = true;
        if (turn.tick <= this.activeState.currentTick) {
          earliestPastTick = Math.min(earliestPastTick, turn.tick);
        }
      }
    }

    if (!added || earliestPastTick === Infinity) return;

    // We have at least one new past turn, meaning we need to rewind and replay.
    this.knownTurns.sort((a, b) => a.tick - b.tick);

    // We rewind to the earliest new past turn
    const startTick = earliestPastTick;

    // - set cursorstate : load dto from history at earliest turn point tick
    const pastDto = this.history.get(startTick);
    if (!pastDto) {
      console.warn(
        `[PlayerStateManager] No history found at turn.tick ${startTick} for player ${this.id}. Using active state.`
      );
      this.cursorState.load(this.activeState.serialize());
      this.cursorState.currentTick = startTick;
    } else {
      this.cursorState.load(pastDto);
      this.cursorState.currentTick = startTick;
    }

    // - update cursorstate tick by tick, until activestate tick, or until cursorstate dies
    // Apply turns at exactly their specific ticks before advancing
    for (
      let simTick = startTick;
      simTick <= this.activeState.currentTick;
      simTick++
    ) {
      if (!this.cursorState.isRunning || this.cursorState.rubber <= 0) {
        break;
      }

      const knownTurn = this.knownTurns.find((t) => t.tick === simTick);
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
            return m.__getHistoryStateAtTick(simTick);
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
    this.previousState = this.activeState.serialize();
    this.correctionTarget = null;
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

      const knownTurn = this.knownTurns.find((t) => t.tick === simTick);
      if (knownTurn) {
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
            return m.__getHistoryStateAtTick(simTick);
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
    this.previousState = this.activeState.serialize();
    this.correctionTarget = null;
    this.saveState(this.activeState.currentTick);
  }
}
