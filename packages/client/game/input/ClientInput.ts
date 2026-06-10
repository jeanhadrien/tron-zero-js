import { ClientChannel } from '@geckos.io/client';
import { Logger } from '@tron0/shared/Logger';
import { EventBus } from '../managers/EventBus';
import { SimulationWorkerManager } from '../workers/SimulationWorkerManager';
import { TurnCommand } from '../simulation/PlayerCommand';
import {
  controlSettings,
  isAllowedBindingKey,
  normalizeBindingKey,
  type ControlSettings,
} from '../../settings/ControlSettings';

const logger = new Logger('ClientInput');

const MAX_INPUTS_PER_FLUSH = 16;
const RETENTION_TICKS = 15;

interface BufferedInput {
  tick: number;
  turn?: 'left' | 'right';
  alpha?: number;
}

interface DispatchWire {
  channel: ClientChannel;
  worker: SimulationWorkerManager;
  getTick: () => number;
  getAlpha: () => number;
  playerId: string;
}

export type GamePhase = 'idle' | 'stabilizing' | 'playing';

/**
 * Single owner for all client keyboard input: capture, gating, tick stamping,
 * local prediction dispatch, and redundant server re-transmission.
 */
export class ClientInput {
  private _pressedKeys = new Set<string>();
  private _leftKeys = new Set<string>();
  private _rightKeys = new Set<string>();
  private _buffer: BufferedInput[] = [];
  private _nextTurnTick = -1;

  private _dispatch: DispatchWire | null = null;
  private _phase: GamePhase = 'idle';
  private _menuOpen = false;
  private _canTurn = false;
  private _canRespawn = false;
  private _controlsListening = false;

  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onKeyUp: (e: KeyboardEvent) => void;
  private _onBlur: () => void;
  private _onVisibility: () => void;
  private _onControlsChanged: (settings: ControlSettings) => void;
  private _onControlsListenActive: (active: boolean) => void;

  constructor(private _onRespawn: () => void) {
    this._applyBindings(controlSettings.getSettings());

    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onKeyUp = (e) => this._handleKeyUp(e);
    this._onBlur = () => this.reset();
    this._onVisibility = () => {
      if (document.hidden) this.reset();
    };
    this._onControlsChanged = (settings) => this._applyBindings(settings);
    this._onControlsListenActive = (active) => {
      this._controlsListening = active;
    };

    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVisibility);
    EventBus.on('controls-changed', this._onControlsChanged);
    EventBus.on('controls-listen-active', this._onControlsListenActive);
  }

  /** Attach network/worker dispatch used for turns and server flush. */
  wire(dispatch: DispatchWire): void {
    this._dispatch = dispatch;
  }

  setGamePhase(phase: GamePhase): void {
    this._phase = phase;
  }

  setMenuOpen(open: boolean): void {
    this._menuOpen = open;
    if (open) this.reset();
  }

  setCanTurn(can: boolean): void {
    this._canTurn = can;
  }

  setCanRespawn(can: boolean): void {
    this._canRespawn = can;
  }

  /** Clear pressed-key state — call on game-start, menu open, tab blur. */
  reset(): void {
    this._pressedKeys.clear();
  }

  /** Call once per render frame to re-emit the sliding input window to the server. */
  endFrame(): void {
    this._flushToServer();
  }

  destroy(): void {
    window.removeEventListener('keydown', this._onKeyDown, true);
    window.removeEventListener('keyup', this._onKeyUp, true);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onVisibility);
    EventBus.off('controls-changed', this._onControlsChanged);
    EventBus.off('controls-listen-active', this._onControlsListenActive);
    this.reset();
    this._buffer = [];
    this._dispatch = null;
  }

  private _applyBindings(settings: ControlSettings): void {
    this._leftKeys = new Set(settings.left);
    this._rightKeys = new Set(settings.right);
  }

  private _pressId(e: KeyboardEvent): string {
    const binding = normalizeBindingKey(e.key);
    if (isAllowedBindingKey(binding)) return binding;
    return e.code;
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    if (e.repeat || this._controlsListening) return;

    const code = e.code;

    if (code === 'Escape') {
      if (!this._isUiTyping()) {
        EventBus.emit('input:menu-toggle');
      }
      return;
    }

    if (code === 'Enter') {
      if (this._isChatFocused()) {
        e.preventDefault();
        EventBus.emit('input:chat-send');
      }
      return;
    }

    const pressId = this._pressId(e);
    if (this._pressedKeys.has(pressId)) return;
    this._pressedKeys.add(pressId);

    if (code === 'Space') {
      if (
        this._phase === 'playing' &&
        this._canRespawn &&
        !this._menuOpen &&
        !this._isUiTyping()
      ) {
        e.preventDefault();
        this._onRespawn();
      }
      return;
    }

    if (this._phase !== 'playing' || this._menuOpen || this._isUiTyping()) return;

    const binding = normalizeBindingKey(e.key);
    if (this._leftKeys.has(binding)) {
      e.preventDefault();
      this._queueTurn('left');
      return;
    }

    if (this._rightKeys.has(binding)) {
      e.preventDefault();
      this._queueTurn('right');
    }
  }

  private _handleKeyUp(e: KeyboardEvent): void {
    this._pressedKeys.delete(this._pressId(e));
  }

  private _queueTurn(direction: 'left' | 'right'): void {
    if (!this._canTurn || !this._dispatch) {
      if (!this._canTurn) logger.warn('Turn ignored — local player not ready');
      return;
    }

    const base = this._dispatch.getTick();
    if (this._nextTurnTick < base) this._nextTurnTick = base;
    const tick = this._nextTurnTick++;
    const alpha = this._dispatch.getAlpha();

    const input: BufferedInput = { tick, turn: direction, alpha };
    this._buffer.push(input);
    this._dispatch.worker.sendPlayerInput(
      TurnCommand(tick, this._dispatch.playerId, direction, alpha)
    );
  }

  private _flushToServer(): void {
    if (!this._dispatch) return;

    const cutoff = this._dispatch.getTick() - RETENTION_TICKS;
    this._buffer = this._buffer.filter((i) => i.tick > cutoff);

    if (this._buffer.length > MAX_INPUTS_PER_FLUSH) {
      this._buffer = this._buffer.slice(-MAX_INPUTS_PER_FLUSH);
    }

    if (this._buffer.length === 0) return;

    this._dispatch.channel.emit(
      'client_turn',
      this._buffer.map((i) => ({
        tick: i.tick,
        turn: i.turn,
        alpha: i.alpha,
        break: false,
      }))
    );
  }

  private _isUiTyping(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  private _isChatFocused(): boolean {
    return document.activeElement?.getAttribute('data-input-role') === 'chat';
  }
}