/// <reference lib="webworker" />
import GameClock from '@tron0/shared/GameClock';
import { GameArenaSystem } from '@tron0/shared/systems/GameArenaSystem';
import PlayerSystem from '@tron0/shared/systems/PlayerSystem';
import { ClientSimSession } from '../ClientSimSession';
import type { MainToWorkerMessage, RenderStatesMessage, SimReadyMessage } from './WorkerProtocol';

let session: ClientSimSession | null = null;

function postRenderBatch(batch: ReturnType<ClientSimSession['frame']>): void {
  if (batch.renderBatch.length === 0) return;

  const msg: RenderStatesMessage = {
    type: 'render_states',
    localPlayerEid: batch.localPlayerEid,
    currentTick: batch.currentTick,
    leadTicks: batch.leadTicks,
    ticks: batch.renderBatch,
    alpha: batch.alpha,
    tickTimeMs: batch.tickTimeMs,
    owd: batch.owd,
    tickError: batch.tickError,
    scale: batch.scale,
  };
  self.postMessage(msg);
}

self.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init_sim': {
      const clock = new GameClock(msg.referenceTickTimeMs);
      const systems = [new GameArenaSystem(), new PlayerSystem()];

      session = new ClientSimSession(clock, systems, {
        minSnapshotCoverageMs: msg.minSnapshotCoverageMs,
        snapshotPeriodX: msg.snapshotPeriodX,
        sessionToken: msg.sessionToken,
      });
      break;
    }

    case 'init_state': {
      if (!session) break;

      const ready = session.loadSnapshot(msg.tick, msg.snapshot);
      postRenderBatch({
        renderBatch: ready.renderBatch,
        currentTick: ready.tick,
        localPlayerEid: ready.localPlayerEid,
        leadTicks: ready.leadTicks,
        alpha: session.clock.getAlpha(),
        tickTimeMs: session.clock.tickTimeMs,
        owd: 0,
        tickError: 0,
        scale: 1,
      });

      const simReady: SimReadyMessage = {
        type: 'sim_ready',
        tick: ready.tick,
        leadTicks: ready.leadTicks,
        localPlayerEid: ready.localPlayerEid,
      };
      self.postMessage(simReady);
      break;
    }

    case 'sync_state_batch': {
      session?.onSyncBatch(msg.diffs, msg.serverTick);
      break;
    }

    case 'pong': {
      session?.onPong(msg.rttMs, msg.serverTick);
      break;
    }

    case 'player_input': {
      session?.onLocalInput(msg.input);
      break;
    }

    case 'delta_time': {
      if (!session) break;
      postRenderBatch(session.frame(msg.deltaMs));
      break;
    }

    case 'respawn': {
      session?.onRespawn();
      break;
    }

    default:
      break;
  }
};
