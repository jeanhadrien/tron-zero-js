/// <reference lib="webworker" />

import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import GameClock from '@tron0/shared/GameClock';
import { GameArenaSystem } from '@tron0/shared/systems/GameArenaSystem';
import PlayerSystem, {
  Player,
  Position,
  Direction,
  Color,
  SpeedMult,
  Velocity,
  IsAlive,
  TrailPointsXs,
  TrailPointsYs,
  PlayerId,
  Rubber,
} from '@tron0/shared/systems/PlayerSystem';
import { ClockSyncManager } from '../managers/ClockSyncManager';
import { query } from 'bitecs';
import { GameEventType } from '@tron0/shared/interfaces/GameEvent';
import type {
  MainToWorkerMessage,
  PlayerRenderDatum,
  TickRenderOutput,
  RenderStatesMessage,
  SimReadyMessage,
} from '@tron0/shared/WorkerProtocol';

// ── State ────────────────────────────────────────────────────────────────────

let room: ECSGameRoom;
let clock: GameClock;
let clockSync: ClockSyncManager;
let pendingOutputs: TickRenderOutput[] = [];
let sessionToken: string;

// ── Render capture ───────────────────────────────────────────────────────────

function captureRenderState(tick: number): TickRenderOutput {
  const players: PlayerRenderDatum[] = [];

  for (const eid of query(room.world, [Player])) {
    players.push({
      eid,
      tick,
      x: Position.x[eid] ?? 0,
      y: Position.y[eid] ?? 0,
      direction: Direction[eid] ?? 0,
      color: Color[eid] ?? 0xffffff,
      speedMult: SpeedMult[eid] ?? 1,
      rubber: Rubber[eid] ?? 0,
      isAlive: IsAlive[eid] === 1,
      playerId: PlayerId[eid] ?? '',
      tickTimeMs: clock.tickTimeMs,
      vx: Velocity.vx[eid] ?? 0,
      vy: Velocity.vy[eid] ?? 0,
      trailXs: [...(TrailPointsXs.data[eid] ?? [])],
      trailYs: [...(TrailPointsYs.data[eid] ?? [])],
    });
  }

  return { tick, players, events: [] };
}

function flushOutput(): void {
  if (pendingOutputs.length === 0) return;

  const msg: RenderStatesMessage = {
    type: 'render_states',
    localPlayerEid: room.localPlayerEid ?? -1,
    currentTick: room.tick,
    leadTicks: clockSync.getLeadTicks(),
    ticks: pendingOutputs,
    alpha: clock.getAlpha(),
    tickTimeMs: clock.tickTimeMs,
  };
  self.postMessage(msg);
  pendingOutputs = [];
}

// ── Message handler ──────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init_sim': {
      sessionToken = msg.sessionToken;
      clock = new GameClock(msg.referenceTickTimeMs);

      const systems = [new GameArenaSystem(), new PlayerSystem()];

      room = new ECSGameRoom(clock, systems, {
        minSnapshotCoverageMs: msg.minSnapshotCoverageMs,
        predictLocalInputs: true,
      });
      room.snapshotPeriodX = msg.snapshotPeriodX;

      clockSync = new ClockSyncManager();
      clockSync.attach(room);

      room.onTick = (tick: number) => {
        pendingOutputs.push(captureRenderState(tick));
      };

      break;
    }

    case 'init_state': {
      clock?.resetAccumulator();

      const leadTicks = clockSync.getLeadTicks();
      room.initFromSnapshot(msg.tick, msg.snapshot);
      room.tick = msg.tick + leadTicks;
      room.localPlayerEid = PlayerSystem.getPlayerEidByStringId(room, sessionToken);
      room.localPlayerId = sessionToken;
      clock.tickTimeMs = clock.referenceTickTimeMs;

      const ready: SimReadyMessage = {
        type: 'sim_ready',
        tick: room.tick,
        leadTicks,
        localPlayerEid: room.localPlayerEid ?? -1,
      };
      self.postMessage(ready);
      break;
    }

    case 'sync_state': {
      room.addNetworkDiffPayload({
        tick: msg.tick,
        data: msg.data,
        struct: msg.struct,
      });
      break;
    }

    case 'pong': {
      clockSync.recordPing(msg.rttMs, msg.serverTick);
      break;
    }

    case 'player_input': {
      if (msg.source === 'server') {
        room.serverAddInput(msg.input);
      } else {
        room.clientAddLocalInput(msg.input);
      }
      break;
    }

    case 'delta_time': {
      if (!clockSync) break;

      clockSync.adjustClock();

      // Keep snapshot gap in sync with current ping estimates
      const leadTicks = clockSync.getLeadTicks();
      const owdTicks = clockSync.smoothedOWD / clock.referenceTickTimeMs;
      room.snapshotGapTicks = leadTicks + Math.ceil(owdTicks);

      clock.addDelta(msg.deltaMs);

      for (let i = 0; i < 3; i++) {
        if (!room.processNextTick()) break;
      }

      flushOutput();
      break;
    }

    case 'respawn': {
      // Client-side respawn prediction — spawn instantly at the agreed tick, server confirms later via replay.
      const eid = room.localPlayerEid;
      if (eid >= 0 && IsAlive[eid] !== 1) {
        room.gameEventBuffer.record(msg.tick, {
          tick: msg.tick,
          type: GameEventType.PlayerSpawn,
          playerId: room.localPlayerId,
        });
      }
      break;
    }

    default:
      break;
  }
};
