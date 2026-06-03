/**
 * Message protocol between main thread and simulation Worker.
 * All types are serializable via structured clone (no functions, no DOM nodes).
 * ArrayBuffers marked as Transferable are sent via postMessage transfer list.
 */

import type { PlayerInput } from './interfaces/PlayerInput';
import type { GameEvent } from './interfaces/GameEvent';

// ── Main → Worker ────────────────────────────────────────────────────────────

export type MainToWorkerMessage =
  | InitSimMessage
  | InitStateMessage
  | SyncStateMessage
  | PongMessage
  | PlayerInputRelayMessage
  | DeltaTimeMessage
  | RespawnMessage
  | ChatRelayMessage;

/** Prime the Worker with simulation parameters and the local player identity. */
export interface InitSimMessage {
  type: 'init_sim';
  referenceTickTimeMs: number;
  snapshotGapTicks: number;
  snapshotPeriodX: number;
  minSnapshotCoverageMs: number;
  sessionToken: string;
}

/** Forward MSG_INIT_STATE from server — full world snapshot. */
export interface InitStateMessage {
  type: 'init_state';
  tick: number;
  /** Transferable — ownership moves to Worker. */
  snapshot: ArrayBuffer;
}

/** Forward MSG_SYNC_STATE from server — authoritative diff. */
export interface SyncStateMessage {
  type: 'sync_state';
  tick: number;
  /** Transferable — SoA diff payload. */
  data: ArrayBuffer;
  /** Transferable — observer diff payload. */
  struct: ArrayBuffer;
}

/** Ping round-trip measurement for clock synchronisation. */
export interface PongMessage {
  type: 'pong';
  rttMs: number;
  serverTick: number;
}

/** A player input — either local (keyboard) or server-authoritative. */
export interface PlayerInputRelayMessage {
  type: 'player_input';
  input: PlayerInput;
  /** 'local' for client-side prediction, 'server' for authoritative. */
  source: 'local' | 'server';
}

/** Advance the simulation clock by a time delta. */
export interface DeltaTimeMessage {
  type: 'delta_time';
  deltaMs: number;
}

/** Trigger a respawn for the local player at a specific simulation tick. */
export interface RespawnMessage {
  type: 'respawn';
  tick: number;
}

/** Chat message received from server — relay to UI via main thread. */
export interface ChatRelayMessage {
  type: 'chat_message';
  message: { type: 'history'; messages: unknown[] } | { type: 'message'; message: unknown };
}

// ── Worker → Main ────────────────────────────────────────────────────────────

export type WorkerToMainMessage =
  | RenderStatesMessage
  | SimReadyMessage;

/** Per-player render data captured after a simulation tick. */
export interface PlayerRenderDatum {
  eid: number;
  tick: number;
  x: number;
  y: number;
  direction: number;
  color: number;
  speedMult: number;
  rubber: number;
  isAlive: boolean;
  playerId: string;
  pingInTicks: number;
  tickTimeMs: number;
  vx: number;
  vy: number;
  trailXs: number[];
  trailYs: number[];
}

/** One tick's output: player states + events fired. */
export interface TickRenderOutput {
  tick: number;
  players: PlayerRenderDatum[];
  events: GameEvent[];
}

/** Batched render output from one or more simulation ticks. */
export interface RenderStatesMessage {
  type: 'render_states';
  localPlayerEid: number;
  currentTick: number;
  ticks: TickRenderOutput[];
  /** Simulation alpha (accumulator / tickTimeMs) at flush time, for extrapolation. */
  alpha: number;
  /** Current tick duration (may differ from reference due to clock sync). */
  tickTimeMs: number;
}

/** Worker confirms initialisation is complete. */
export interface SimReadyMessage {
  type: 'sim_ready';
  tick: number;
  leadTicks: number;
  localPlayerEid: number;
}
