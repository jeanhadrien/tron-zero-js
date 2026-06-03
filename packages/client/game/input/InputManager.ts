import { ClientChannel } from '@geckos.io/client';
import { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import { SimulationWorkerManager } from '../workers/SimulationWorkerManager';

/**
 * Owns input creation, tick/alpha stamping, and dispatch to both
 * the server (via geckos channel) and the local simulation worker.
 *
 * GameScene calls turn()/break() on key events; the manager handles
 * everything else — no PlayerInput objects or network calls leak out.
 */
export class InputManager {
  private _pendingInputCount = 0;

  constructor(
    private _channel: ClientChannel,
    private _worker: SimulationWorkerManager,
    private _getTick: () => number,
    private _getAlpha: () => number,
    private _playerId: string,
  ) {}

  /** Queue a turn with current tick + alpha for timing precision. */
  turn(direction: 'left' | 'right'): void {
    const input: PlayerInput = {
      tick: this._getTick() + this._pendingInputCount,
      playerId: this._playerId,
      turn: direction,
      alpha: this._getAlpha(),
    };
    this._dispatch(input);
    this._pendingInputCount++;
  }

  /** Queue a break toggle — no alpha because break is a per‑tick boolean. */
  break(): void {
    const input: PlayerInput = {
      tick: this._getTick() + this._pendingInputCount,
      playerId: this._playerId,
      break: true,
    };
    this._dispatch(input);
    this._pendingInputCount++;
  }

  /** Call once per frame to reset the pending input counter. */
  endFrame(): void {
    this._pendingInputCount = 0;
  }

  private _dispatch(input: PlayerInput): void {
    this._channel.emit('client_turn', [{
      tick: input.tick,
      turn: input.turn,
      alpha: input.alpha,
      break: input.break,
    }]);
    this._worker.sendPlayerInput(input, 'local');
  }
}
