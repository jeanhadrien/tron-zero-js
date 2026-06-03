import { ClientChannel } from '@geckos.io/client';
import { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import { SimulationWorkerManager } from '../workers/SimulationWorkerManager';

const MAX_INPUTS_PER_FLUSH = 16;
const RETENTION_TICKS = 15;

/**
 * Owns input creation, tick/alpha stamping, local prediction dispatch,
 * and redundant server re‑transmission to survive UDP packet loss.
 *
 * GameScene calls turn()/break() on key events and endFrame() once per
 * render frame.  The manager sends every queued input to the simulation
 * worker immediately (once), then re‑emits the full sliding window to
 * the server every frame so that lost packets are covered by the next
 * datagram.
 */
export class InputManager {
  private _pendingInputCount = 0;
  private _buffer: PlayerInput[] = [];
  private _sentTick: number = 0;

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
    this._buffer.push(input);
    this._worker.sendPlayerInput(input, 'local');
    this._pendingInputCount++;
  }

  /** Queue a break toggle — no alpha because break is per‑tick boolean. */
  break(): void {
    const input: PlayerInput = {
      tick: this._getTick() + this._pendingInputCount,
      playerId: this._playerId,
      break: true,
    };
    this._buffer.push(input);
    this._worker.sendPlayerInput(input, 'local');
    this._pendingInputCount++;
  }

  /** Call once per render frame — resets the pending counter and re‑sends the full buffer. */
  endFrame(): void {
    this._pendingInputCount = 0;
    this._flushToServer();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /** Trim stale inputs and emit the sliding window to the server. */
  private _flushToServer(): void {
    const cutoff = this._getTick() - RETENTION_TICKS;

    // Trim inputs older than the retention window
    this._buffer = this._buffer.filter((i) => i.tick > cutoff);

    // Safety cap — keep most recent N inputs
    if (this._buffer.length > MAX_INPUTS_PER_FLUSH) {
      this._buffer = this._buffer.slice(-MAX_INPUTS_PER_FLUSH);
    }

    if (this._buffer.length === 0) return;

    this._channel.emit('client_turn', this._buffer.map((i) => ({
      tick: i.tick,
      turn: i.turn,
      alpha: i.alpha,
      break: i.break,
    })));
  }
}
