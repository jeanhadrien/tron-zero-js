import 'jsdom-global/register';
import express from 'express';
import { createServer } from 'http';
import geckos, { ServerChannel } from '@geckos.io/server';
import * as Phaser from 'phaser';
import path from 'path';
import GameRoom from '../shared/GameRoom';
import PlayerState from '../shared/PlayerState';
import { GameEventBus } from '../shared/GameEventBus';
import GameArea from '../shared/GameArea';
import GameClock from '../shared/GameClock';

const app = express();
const httpServer = createServer(app);
const io = geckos({
  cors: { allowAuthorization: true, origin: '*' },
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

const playerChannels = new Map<string, ServerChannel>();
const gameBus = new GameEventBus();
const gameArea = new GameArea();
const gameClock = new GameClock();
const gameRoom = new GameRoom(gameBus, gameArea, gameClock);

// When a player connects, do stuff and bind event callbacks
io.onConnection((channel) => {
  const playerId = channel.id!;
  console.log(`Player connected: ${playerId}`);

  gameRoom.createPlayerWithForcedId(playerId);

  channel.on('ping', (clientTime: any) => {
    channel.emit('pong', clientTime);
  });

  channel.emit('init_state', [gameClock.tick, gameRoom.getState()], {
    reliable: true,
  });

  channel.broadcast.emit(
    'player_joined',
    {
      tick: gameClock.tick,
      id: playerId,
      state: gameRoom.getPlayer(playerId).serialize(),
    },
    { reliable: true }
  );

  channel.on('client_turn', (data: any) => {
    gameRoom.handleTurn(playerId, data.direction, data.sequenceNumber);
  });

  channel.onDisconnect(() => {
    console.log(`Player disconnected: ${playerId}`);
    gameRoom.removePlayerById(playerId);
    io.emit('player_left', { id: playerId }, { reliable: true });
  });
});

gameRoom.playerEventBus.on('player_turn', (player, turnPoint) => {
  // todo: get player channel and broadcas
  io.emit('player_turn', [player.id, turnPoint.serialize()], {
    reliable: true,
  });
});

gameRoom.playerEventBus.on('player_spawn', (player) => {
  io.emit('player_spawn', [player.id, player.serialize()], {
    reliable: true,
  });
});

gameRoom.playerEventBus.on('player_death', (player) => {
  io.emit('player_death', [player.id, player.serialize()], {
    reliable: true,
  });
});

gameRoom.bus.on('game_add_player', (player) => {
  io.emit('game_add_player', [player.id, player.serialize()], {
    reliable: true,
  });
});

gameRoom.bus.on('game_remove_player', (player) => {
  io.emit('game_remove_player', [player.id], {
    reliable: true,
  });
});

// Fixed update loop at 60 FPS (approx 16.66ms)
const TICK_RATE = 1000 / 60;
let lastTime = performance.now();

setInterval(() => {
  const now = performance.now();
  const delta = now - lastTime;
  lastTime = now;
  gameRoom.update(delta);
  const p = Array.from(gameRoom.players.values())[0];
  if (p && gameClock.tick % 60 === 0)
    if (gameClock.tick % 180 === 0) {
      // Periodic full sync to correct drift (every 3 seconds)
      io.emit('sync_state', {
        tick: gameClock.tick,
        state: gameRoom.getState(),
      });
    }
}, TICK_RATE);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
