import { Logger } from '@tron0/shared/Logger';
import type { NetworkDiffPayload } from '@tron0/shared/interfaces/Network';
import type { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';
import type {
  MainToWorkerMessage,
  RenderStatesMessage,
  SimReadyMessage,
  TickRenderOutput,
  WorkerToMainMessage,
} from '@tron0/shared/WorkerProtocol';

const logger = new Logger('SimWorkerMgr');

/**
 * Owns the simulation Web Worker lifecycle and relays messages between the main
 * thread (network, input, rendering) and the Worker (ECS tick loop).
 *
 * Usage:
 *   const mgr = new SimulationWorkerManager();
 *   mgr.onReady = (tick, leadTicks) => { ... };
 *   mgr.init({ referenceTickTimeMs, sessionToken, ... });
 *   mgr.sendDeltaTime(16);
 *   // In rAF:  mgr.latestOutput  →  PlayerRenderSystem
 */
export class SimulationWorkerManager {
  private worker: Worker | null = null;

  /** Most recent batch of tick outputs from the Worker. */
  latestOutput: TickRenderOutput[] = [];

  /** Set when the Worker confirms initialisation. */
  latestCurrentTick: number = 0;
  localPlayerEid: number = -1;
  latestLeadTicks: number = 0;

  /** Current simulation alpha (accumulator / tickTimeMs), upgraded with elapsed time. */
  private _lastWorkerAlpha: number = 0;
  private _lastWorkerTime: number = 0;
  private _tickTimeMs: number = 16.67;

  /** Fires when the Worker sends sim_ready (after init_state is applied). */
  onReady?: (tick: number, leadTicks: number) => void;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Spawn the Worker and send the init_sim priming message. */
  init(params: {
    referenceTickTimeMs: number;
    snapshotGapTicks: number;
    snapshotPeriodX: number;
    minSnapshotCoverageMs: number;
    sessionToken: string;
  }): void {
    if (this.worker) {
      logger.warn('Worker already initialised');
      return;
    }

    this.worker = new Worker(
      new URL('./simulation.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) =>
      this._onMessage(e.data);

    this.worker.onerror = (e: ErrorEvent) => {
      logger.error('Worker error:', e.message);
    };

    const msg: MainToWorkerMessage = {
      type: 'init_sim',
      referenceTickTimeMs: params.referenceTickTimeMs,
      snapshotGapTicks: params.snapshotGapTicks,
      snapshotPeriodX: params.snapshotPeriodX,
      minSnapshotCoverageMs: params.minSnapshotCoverageMs,
      sessionToken: params.sessionToken,
    };
    this.worker.postMessage(msg);
  }

  /** Terminate the Worker and reset state. */
  destroy(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    this.latestOutput = [];
    this.latestCurrentTick = 0;
    this.localPlayerEid = -1;
  }

  // ── Outgoing (main → worker) ─────────────────────────────────────────────

  sendInitState(tick: number, snapshot: ArrayBuffer): void {
    this._post({ type: 'init_state', tick, snapshot }, [snapshot]);
  }

  sendSyncStateBatch(serverTick: number, diffs: NetworkDiffPayload[]): void {
    const transfers = diffs.flatMap(d => [d.data, d.struct]).filter(b => b.byteLength > 0);
    this._post({ type: 'sync_state_batch', serverTick, diffs }, transfers);
  }

  sendPong(rttMs: number, serverTick: number): void {
    this._post({ type: 'pong', rttMs, serverTick });
  }

  sendPlayerInput(input: PlayerInput, source: 'local' | 'server'): void {
    this._post({ type: 'player_input', input, source });
  }

  sendDeltaTime(deltaMs: number): void {
    this._post({ type: 'delta_time', deltaMs });
  }

  sendRespawn(tick: number): void {
    this._post({ type: 'respawn', tick });
  }

  // ── Incoming (worker → main) ─────────────────────────────────────────────

  private _onMessage(msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case 'render_states':
        this._handleRenderStates(msg);
        break;
      case 'sim_ready':
        this._handleSimReady(msg);
        break;
      default:
        break;
    }
  }

  private _handleRenderStates(msg: RenderStatesMessage): void {
    for (const t of msg.ticks) {
      this.latestOutput.push(t);
    }
    this.latestCurrentTick = msg.currentTick;
    this.localPlayerEid = msg.localPlayerEid;
    this.latestLeadTicks = msg.leadTicks;
    this._lastWorkerAlpha = msg.alpha;
    this._lastWorkerTime = performance.now();
    this._tickTimeMs = msg.tickTimeMs;
  }

  /**
   * Current simulation alpha, upgraded with elapsed time since the last
   * render_states message arrived. Returns a value between 0 and 1 that
   * represents how far we are toward the next simulation tick.
   */
  computeAlpha(): number {
    if (this._lastWorkerTime === 0) return 0;
    const elapsed = performance.now() - this._lastWorkerTime;
    return Math.min(1.0, this._lastWorkerAlpha + elapsed / this._tickTimeMs);
  }

  /** Current tick duration, adjusted by clock sync. */
  get tickTimeMs(): number {
    return this._tickTimeMs;
  }

  private _handleSimReady(msg: SimReadyMessage): void {
    this.localPlayerEid = msg.localPlayerEid;
    this.latestCurrentTick = msg.tick;
    this.onReady?.(msg.tick, msg.leadTicks);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _post(msg: MainToWorkerMessage, transfer?: Transferable[]): void {
    if (!this.worker) {
      logger.warn('Worker not initialised, dropping message:', msg.type);
      return;
    }
    if (transfer) {
      this.worker.postMessage(msg, transfer);
    } else {
      this.worker.postMessage(msg);
    }
  }
}
