import './telemetry';
import express from 'express';
import { createServer } from 'http';
import geckos from '@geckos.io/server';
import path from 'path';
import { trace } from '@opentelemetry/api';
import { GameEventBus } from '../shared/GameEventBus';
import { ECSGameAreaSystem } from '../shared/systems/ECSGameArea';
import GameClock from '../shared/GameClock';
import { Logger } from '../shared/Logger';
import { ECSGameRoom } from '../shared/ECSGameRoom';
import PlayerSystem from '../shared/systems/ECSPlayerSystem';
import BotSystem from './BotSystem';
import { ServerNetworkSystem } from './systems/ServerNetworkSystem';
import { ChatSystem } from './systems/ChatSystem';

const logger = new Logger('Server');
const tracer = trace.getTracer('tron-zero-server');

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
const areaSystem = new ECSGameAreaSystem();
const botSystem = new BotSystem();
const networkServerSystem = new ServerNetworkSystem(io);
const chatSystem = new ChatSystem(io);

const ecsRoom = new ECSGameRoom(new GameEventBus(), gameClock, [
  areaSystem,
  playerSystem,
  botSystem,
  networkServerSystem,
  chatSystem,
]);

botSystem.setInputBuffer(ecsRoom.playerInputBuffer);

// new NetworkServer(io, ecsRoom, gameClock);

const TICK_RATE = 1000 / 60;
let lastTime = performance.now();

setInterval(() => {
  const now = performance.now();
  const delta = now - lastTime;
  lastTime = now;

  ecsRoom.updateFixed(delta);
}, TICK_RATE);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  const span = tracer.startSpan('game.start');
  span.setAttribute('port', PORT);
  logger.info(`Server listening on port ${PORT}`);
  span.end();
});
