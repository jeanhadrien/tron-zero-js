import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import GameClock from '@tron0/shared/GameClock';
import type { System } from '@tron0/shared/interfaces/System';

/**
 * Server-side simulation layer wrapping an ECSGameRoom with a
 * batch-mode tick loop (server simulates all pending ticks each frame).
 * Symmetric with ClientSimulation — both own an ECSGameRoom, each
 * adding its own simulation strategy.
 */
export class ServerSimulation {
  readonly room: ECSGameRoom;
  readonly clock: GameClock;

  constructor(clock: GameClock, systems: System[]) {
    this.clock = clock;
    this.room = new ECSGameRoom(clock, systems);
  }

  /** Process all accumulated ticks in one batch (server's fixed timestep loop). */
  updateFixed(deltaTime: number): void {
    const ticksToProcess = this.clock.update(deltaTime);
    for (let i = 0; i < ticksToProcess; i++) {
      this.room.update();
    }
  }
}
