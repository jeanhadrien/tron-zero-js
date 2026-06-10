/// <reference lib="webworker" />
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
import { ClientSimulation } from '../ClientSimulation';
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

let clientSim: ClientSimulation;
let clock: GameClock;
let clockSync: ClockSyncManager;
let pendingOutputs: TickRenderOutput[] = [];
let sessionToken: string;
let _lastAppliedServerTick = -1;
let _lastTrailLengths: Map<number, number> = new Map();

// ── Render capture ───────────────────────────────────────────────────────────

function captureRenderState(tick: number): TickRenderOutput {
  const players: PlayerRenderDatum[] = [];

  for (const eid of query(clientSim.room.world, [Player])) {
    const trailLen = (TrailPointsXs.data[eid] ?? []).length;
    const prevLen = _lastTrailLengths.get(eid) ?? -1;
    if (prevLen >= 0 && Math.abs(trailLen - prevLen) > 3) {
      console.warn(
        `[SimWkr] trail snap: eid=${eid} tick=${tick} trailLen ${prevLen}→${trailLen} ` +
          `(Δ=${trailLen - prevLen}) isAlive=${IsAlive[eid] === 1} isReplaying=${clientSim.reconciler.isReplaying}`
      );
    }
    _lastTrailLengths.set(eid, trailLen);

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
    localPlayerEid: clientSim.localPlayerEid ?? -1,
    currentTick: clientSim.room.tick,
    leadTicks: clockSync.getLeadTicks(),
    ticks: pendingOutputs,
    alpha: clock.getAlpha(),
    tickTimeMs: clock.tickTimeMs,
    owd: clockSync.smoothedOWD,
    tickError: clockSync.lastTickError,
    scale: clockSync.lastScale,
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

      clientSim = new ClientSimulation(clock, systems, {
        minSnapshotCoverageMs: msg.minSnapshotCoverageMs,
        snapshotPeriodX: msg.snapshotPeriodX,
      });

      clockSync = new ClockSyncManager();
      clockSync.attach(clientSim.room, () => clientSim.reconciler.isReplaying);

      break;
    }

    case 'init_state': {
      clock?.resetAccumulator();

      const leadTicks = clockSync.getLeadTicks();
      clientSim.initFromSnapshot(msg.tick, msg.snapshot);

      const eid = PlayerSystem.getPlayerEidByStringId(clientSim.room, sessionToken);
      clientSim.wirePlayer(eid, sessionToken, (tick: number) => {
        pendingOutputs.push(captureRenderState(tick));
      });

      // Simulate forward to reach the target lead — actual tick advancement, not a counter lie.
      // The +1 extra reference tick guards against floating-point slop in consumeTicks.
      clock.accumulatorTimeMs = leadTicks * clock.referenceTickTimeMs + clock.referenceTickTimeMs;
      for (let i = 0; i < leadTicks; i++) {
        clientSim.processNextTick();
      }
      clock.resetAccumulator();

      console.warn(
        `[ClockSync] init_state: msg.tick=${msg.tick} leadTicks=${leadTicks} ` +
          `room.tick=${clientSim.room.tick} owd=${clockSync.smoothedOWD.toFixed(1)}ms`
      );

      flushOutput();

      const ready: SimReadyMessage = {
        type: 'sim_ready',
        tick: clientSim.room.tick,
        leadTicks,
        localPlayerEid: clientSim.localPlayerEid ?? -1,
      };
      self.postMessage(ready);
      break;
    }

    case 'sync_state_batch': {
      if (msg.serverTick <= _lastAppliedServerTick) break;
      const aheadBy = msg.serverTick - clientSim.room.tick;
      if (aheadBy > 0) {
        console.warn(
          `[ClockSync] SERVER AHEAD: serverTick=${msg.serverTick} > clientTick=${clientSim.room.tick} ` +
            `(client behind by ${aheadBy} ticks)`
        );
      }
      const diffTicks = msg.diffs.map((d) => d.tick).join(',');
      console.warn(
        `[SimWkr] sync_batch: serverTick=${msg.serverTick} clientTick=${clientSim.room.tick} ` +
          `aheadBy=${aheadBy} diffs=[${diffTicks}] isReplaying=${clientSim.reconciler.isReplaying}`
      );
      clientSim.reconciler.addNetworkDiffBatch(msg.diffs, msg.serverTick, clientSim.room.tick);
      clockSync.recordServerTick(msg.serverTick);
      _lastAppliedServerTick = msg.serverTick;
      clientSim.reconcilePending();
      break;
    }

    case 'pong': {
      clockSync.recordPing(msg.rttMs, msg.serverTick);
      break;
    }

    case 'player_input': {
      if (msg.source === 'server') {
        clientSim.room.addInput(msg.input);
      } else {
        clientSim.reconciler.addLocalInput(msg.input);
      }
      break;
    }

    case 'delta_time': {
      if (!clockSync) break;

      clockSync.adjustClock();

      const leadTicks = clockSync.getLeadTicks();
      const owdTicks = clockSync.smoothedOWD / clock.referenceTickTimeMs;
      clientSim.snapshotGapTicks = leadTicks + Math.ceil(owdTicks);

      clock.addDelta(msg.deltaMs);

      for (let i = 0; i < 3; i++) {
        if (!clientSim.processNextTick()) break;
      }

      flushOutput();
      break;
    }

    case 'respawn': {
      const eid = clientSim.localPlayerEid;
      if (eid >= 0 && IsAlive[eid] !== 1) {
        const tick = clientSim.room.tick;
        clientSim.room.gameEventBuffer.record(tick, {
          tick,
          type: GameEventType.PlayerSpawn,
          playerId: clientSim.localPlayerId,
        });
      }
      break;
    }

    default:
      break;
  }
};

