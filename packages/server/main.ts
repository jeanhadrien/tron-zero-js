import './telemetry';
import express from 'express';
import { createServer } from 'http';
import geckos from '@geckos.io/server';
import path from 'path';
import { trace } from '@opentelemetry/api';
import { GameArenaSystem } from '@tron0/shared/systems/GameArenaSystem';
import { SpatialGridSystem } from '@tron0/shared/systems/SpatialGridSystem';
import GameClock from '@tron0/shared/GameClock';
import { Logger } from '@tron0/shared/Logger';
import PlayerSystem from '@tron0/shared/systems/PlayerSystem';
import BotSystem from './systems/ServerBotSystem';
import { ServerNetworkSystem } from './systems/ServerNetworkSystem';
import { ServerChatSystem } from './systems/ServerChatSystem';
import { ServerSimulation } from './ServerSimulation';

const logger = new Logger('Server');
const tracer = trace.getTracer('tron-zero-server');

const MANAGER_URL = process.env.MANAGER_URL || 'http://localhost:3001';
const SERVER_NAME = process.env.SERVER_NAME || 'Unnamed Server';
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '10', 10);

const app = express();
const httpServer = createServer(app);
const io = geckos({
  cors: { allowAuthorization: true, origin: '*' },
  iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }],
  portRange: {
    min: 10000,
    max: 20000,
  },
});
io.addServer(httpServer);

// Serve static assets from 'dist' directory
app.use(express.static(path.join(process.cwd(), 'dist')));

app.get(/^.*$/, (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

const gameClock = new GameClock();

const playerSystem = new PlayerSystem();
const areaSystem = new GameArenaSystem();
const spatialGridSystem = new SpatialGridSystem();
const botSystem = new BotSystem();
const networkServerSystem = new ServerNetworkSystem(io);
const chatSystem = new ServerChatSystem(io, networkServerSystem.channelPlayerIds);

const serverSim = new ServerSimulation(gameClock, [
  areaSystem,
  spatialGridSystem,
  botSystem,
  playerSystem,
  networkServerSystem,
  chatSystem,
]);

botSystem.setInputBuffer(serverSim.room.playerInputBuffer);

let lastTime = performance.now();

setInterval(() => {
  const now = performance.now();
  const delta = now - lastTime;
  lastTime = now;

  serverSim.updateFixed(delta);
}, gameClock.referenceTickTimeMs);

// ---------------------------------------------------------------------------
// Server-manager registration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3000', 10);
let roomId: string | null = null;
let managerHeartbeatInterval: ReturnType<typeof setInterval> | null = null;

async function registerWithManager() {
  logger.info(`Registering with manager at ${MANAGER_URL}`);
  try {
    const host = process.env.ADVERTISED_HOST || '127.0.0.1';
    const res = await fetch(`${MANAGER_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: PORT, displayName: SERVER_NAME, maxPlayers: MAX_PLAYERS }),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error(`Manager register failed: ${res.status} ${text}`);
      return;
    }
    const body = (await res.json()) as { id: string };
    roomId = body.id;
    logger.info(`Registered with manager — roomId=${roomId}`);

    // Fire heartbeat immediately, then every 30s
    const sendHeartbeat = async () => {
      try {
        const res = await fetch(`${MANAGER_URL}/api/rooms/${roomId}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerCount: networkServerSystem.getPlayerCount() + botSystem.getBotCount() }),
        });
        if (!res.ok) {
          if (res.status === 404) {
            logger.warn(`Manager lost our room — re-registering`);
            roomId = null;
            clearInterval(managerHeartbeatInterval!);
            managerHeartbeatInterval = null;
            registerWithManager();
            return;
          }
          logger.warn(`Heartbeat failed: ${res.status}`);
        }
      } catch {
        logger.warn(`Heartbeat — manager unreachable at ${MANAGER_URL}`);
      }
    };

    logger.info(`Starting heartbeat every 30s for roomId=${roomId}`);
    await sendHeartbeat();
    managerHeartbeatInterval = setInterval(sendHeartbeat, 2_000);
  } catch {
    logger.warn(`Could not reach manager at ${MANAGER_URL} — retrying in 5s`);
    setTimeout(registerWithManager, 5000);
  }
}

async function unregisterFromManager() {
  if (managerHeartbeatInterval) {
    clearInterval(managerHeartbeatInterval);
    managerHeartbeatInterval = null;
    logger.debug('Heartbeat interval cleared');
  }
  if (!roomId) {
    logger.debug('No roomId to unregister');
    return;
  }
  try {
    await fetch(`${MANAGER_URL}/api/rooms/${roomId}`, { method: 'DELETE' });
    logger.info(`Unregistered from manager — roomId=${roomId}`);
  } catch {
    logger.warn(`Failed to unregister roomId=${roomId} from ${MANAGER_URL} (best-effort)`);
  }
}

process.on('SIGINT', async () => {
  await unregisterFromManager();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await unregisterFromManager();
  process.exit(0);
});

// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  const span = tracer.startSpan('game.start');
  span.setAttribute('port', PORT);
  logger.info(`Server listening on port ${PORT}`);
  span.end();

  registerWithManager();
});
