import express from 'express';
import { createServer } from 'http';
import geckos from '@geckos.io/server';
import * as Phaser from 'phaser';
import path from 'path';
import GameRoom from '../shared/GameRoom';
import { GameEventBus } from '../shared/GameEventBus';
import GameArea from '../shared/GameArea';
import GameClock from '../shared/GameClock';
import { NetworkServer } from './network/NetworkServer';
import { GameServer } from './game/GameServer';

const app = express();
const httpServer = createServer(app);
const io = geckos({
  cors: { allowAuthorization: true, origin: '*' },
  iceServers: [
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  portRange: {
    min: 10000,
    max: 20000
  }
});
io.addServer(httpServer);

// Serve static assets from 'dist' directory
app.use(express.static(path.join(process.cwd(), 'dist')));

app.get(/^.*$/, (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

// Initialize Headless Phaser (forces Phaser's math/geometry to work)
new Phaser.Game({
  type: Phaser.HEADLESS,
  width: 800,
  height: 600,
  banner: false,
  audio: {
    noAudio: true,
  },
});

const gameBus = new GameEventBus();
const gameArea = new GameArea();
const gameClock = new GameClock();
const gameRoom = new GameRoom(gameBus, gameArea, gameClock);

const networkServer = new NetworkServer(io, gameRoom, gameClock);
const gameServer = new GameServer(gameRoom, gameArea, gameClock);

gameServer.start();

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
