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
import BotController from './BotController';
import { PlayerPoint } from '../shared/PlayerPoint';

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

const bot1 = gameRoom.createPlayerWithForcedId('bot1');
const bot2 = gameRoom.createPlayerWithForcedId('bot2');
const bot3 = gameRoom.createPlayerWithForcedId('bot3');
const bot4 = gameRoom.createPlayerWithForcedId('bot4');
const bot5 = gameRoom.createPlayerWithForcedId('bot5');
const botCtrl1 = new BotController();
const botCtrl2 = new BotController();
const botCtrl3 = new BotController();
const botCtrl4 = new BotController();
const botCtrl5 = new BotController();

// When a player connects, do stuff and bind event callbacks
io.onConnection((channel) => {
  const playerId = channel.id!;
  console.log(`Player connected: ${playerId}`);

  const localPlayer = gameRoom.createPlayerWithForcedId(playerId);

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

  // When client sends a turn, update local state
  channel.on('client_turn', (data: any) => {
    const [turnPointDTO] = data;
    const turn = PlayerPoint.fromDto(turnPointDTO);
    localPlayer.trail.fillTurn(turn);
    gameRoom.playerEventBus.emit('player_turn', localPlayer, turn);
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
  const allPlayer = gameRoom.getAllPlayers();
  for (const p of allPlayer) {
    if (p.isRunning == false) {
      gameRoom.spawnPlayer(p);
    }
  }

  botCtrl1.update(bot1, allPlayer, gameArea);
  botCtrl2.update(bot2, allPlayer, gameArea);
  botCtrl3.update(bot3, allPlayer, gameArea);
  botCtrl4.update(bot4, allPlayer, gameArea);
  botCtrl5.update(bot5, allPlayer, gameArea);
}, TICK_RATE);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
