import './telemetry';
import express from 'express';
import { createServer } from 'http';
import geckos from '@geckos.io/server';
import path from 'path';
import { trace } from '@opentelemetry/api';
import GameRoom from '../shared/GameRoom';
import { GameEventBus } from '../shared/GameEventBus';
import GameArea, { ECSGameAreaSystem } from '../shared/GameArea';
import GameClock from '../shared/GameClock';
import { NetworkServer } from './network/NetworkServer';
import { GameServer } from './game/GameServer';
import { Logger } from '../shared/Logger';
import ECSGameRoom from '../shared/ECSGameRoom';
import PlayerSystem from '../shared/ECSPlayerSystem';
import PlayerSystem from '../shared/ECSPlayerSystem';

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

// const gameBus = new GameEventBus();
// const gameArea = new GameArea();
// const gameClock = new GameClock();
// const gameRoom = new GameRoom(gameBus, gameArea, gameClock);

// const networkServer = new NetworkServer(io, gameRoom, gameClock);
// const gameServer = new GameServer(gameRoom, gameArea, gameClock);
// gameServer.start();

//////

const TICK_RATE = 1000 / 60;
let lastTime = performance.now();

const playerSystem = new PlayerSystem();
const areaSystem = new ECSGameAreaSystem();
const ecsgameRoom = new ECSGameRoom(new GameEventBus(), new GameClock(), [areaSystem, playerSystem]);

PlayerSystem.createPlayer(ecsgameRoom.world, 'z');
PlayerSystem.spawnPlayer(ecsgameRoom.world, 'z');

setInterval(() => {
  const now = performance.now();
  const delta = now - lastTime;
  lastTime = now;

  ecsgameRoom.updateFixed(delta);
}, TICK_RATE);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  const span = tracer.startSpan('game.start');
  span.setAttribute('port', PORT);
  logger.info(`Server listening on port ${PORT}`);
  span.end();
});
