import { ClientChannel } from '@geckos.io/client';
import { SimulationWorkerManager } from '../workers/SimulationWorkerManager';
import { TurnCommand, BreakCommand } from '../simulation/PlayerCommand';

const MAX_INPUTS_PER_FLUSH = 16;
const RETENTION_TICKS = 15;

interface BufferedInput {
  tick: number;
  turn?: 'left' | 'right';
  break?: boolean;
  alpha?: number;
}

/**
 * Owns input creation, tick/alpha stamping, local prediction dispatch,
 * and redundant server re‑transmission to survive UDP packet loss.
 *
 * Invariants:
 * - turn() always advances the tick slot — turns are sequential, never collapsed.
 * - break() never advances the slot — merges into the current target tick.
 * - Multiple actions at the same tick are merged into a single Entry.
 *
 * GameScene calls turn()/break() on key events and endFrame() once per render
 * frame.  Every input is sent to the simulation worker immediately (once).  The
 * full sliding window is re‑emitted to the server every frame so lost packets
 * are covered by the next datagram.
 */
export class InputManager {
  /** How many turn() calls have been queued this frame. Break does NOT increment this. */
  private _turnSpread = 0;
  private _buffer: BufferedInput[] = [];

  constructor(
    private _channel: ClientChannel,
    private _worker: SimulationWorkerManager,
    private _getTick: () => number,
    private _getAlpha: () => number,
    private _playerId: string,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  /** Queue a turn — always advances to a fresh tick slot. */
  turn(direction: 'left' | 'right'): void {
    const tick = this._getTick() + this._turnSpread;
    const alpha = this._getAlpha();
    this._turnSpread += 1;

    this._upsert(tick, (input) => {
      input.turn = direction;
      input.alpha = alpha;
    });
  }

  /**
   * Queue a break toggle — merges into the current target tick.
   * Multiple calls to break() at the same tick are idempotent (boolean).
   */
  break(): void {
    const tick = this._getTick() + this._turnSpread;

    this._upsert(tick, (input) => {
      input.break = true;
    });
  }

  /** Call once per render frame — resets the turn spread and re‑sends the full buffer. */
  endFrame(): void {
    this._turnSpread = 0;
    this._flushToServer();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Insert or merge an input at the given tick.
   * - If the last buffer entry already has this tick, merge fields into it.
   * - Otherwise push a new entry.
   * Always forwards the (potentially merged) input to the worker.
   */
  private _upsert(tick: number, apply: (input: BufferedInput) => void): void {
    const last = this._buffer[this._buffer.length - 1];

    if (last && last.tick === tick) {
      apply(last);
      if (last.turn) {
        this._worker.sendPlayerInput(TurnCommand(tick, this._playerId, last.turn, last.alpha), 'local');
      } else if (last.break) {
        this._worker.sendPlayerInput(BreakCommand(tick, this._playerId), 'local');
      }
    } else {
      const input: BufferedInput = { tick };
      apply(input);
      this._buffer.push(input);
      if (input.turn) {
        this._worker.sendPlayerInput(TurnCommand(tick, this._playerId, input.turn, input.alpha), 'local');
      } else if (input.break) {
        this._worker.sendPlayerInput(BreakCommand(tick, this._playerId), 'local');
      }
    }
  }

  /** Trim stale inputs and emit the sliding window to the server. */
  private _flushToServer(): void {
    const cutoff = this._getTick() - RETENTION_TICKS;

    this._buffer = this._buffer.filter((i) => i.tick > cutoff);

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
