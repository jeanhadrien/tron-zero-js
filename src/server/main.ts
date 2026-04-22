import 'jsdom-global/register';
import express from 'express';
import { createServer } from 'http';
import geckos, { ServerChannel } from '@geckos.io/server';
import * as Phaser from 'phaser';
import GameRoom from './GameRoom';
import path from 'path';
import { GameEventBus } from '../shared/GameEventBus';

const app = express();
const httpServer = createServer(app);
const io = geckos({
    cors: { allowAuthorization: true, origin: '*' }
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
        noAudio: true
    }
});

const bus = new GameEventBus();
const playerChannels = new Map<string, ServerChannel>();
const gameRoom = new GameRoom(bus);


// When a player connects, do stuff and bind event callbacks
io.onConnection((channel) => {
    const playerId = channel.id!;

    console.log(`Player connected: ${playerId}`);

    gameRoom.addPlayer(playerId, currentTick);

    // Send initial state to the new player
    channel.emit('init_state', { tick: currentTick, state: gameRoom.getState() }, { reliable: true });

    // Notify others
    channel.broadcast.emit('player_joined', { tick: currentTick, id: playerId, state: gameRoom.getPlayerState(playerId), }, { reliable: true });

    channel.on('turn', (data: any) => {
        gameRoom.handleTurn(playerId, data.direction, data.sequenceNumber);
    });

    channel.on('ping', (clientTime: any) => {
        channel.emit('pong', clientTime);
    });

    channel.on('respawn', () => {
        bus.emit('respawn');
        console.log(`Player respawned: ${playerId}`);
        gameRoom.respawnPlayer(playerId);
    });

    channel.onDisconnect(() => {
        console.log(`Player disconnected: ${playerId}`);
        gameRoom.removePlayer(playerId);
        io.emit('player_left', { id: playerId }, { reliable: true });
    });
});

bus.on("player_turn2", (player, turnPoint) => {
    console.log(player.id)
    io.emit("player_turn2", [
        player.id,
        turnPoint.coordinates.x,
        turnPoint.coordinates.y,
        turnPoint.direction,
        turnPoint.velocity,
        turnPoint.speed,
        currentTick
    ]);
});

bus.on("new_player", (channel) => {
    return;
})


// Fixed update loop at 60 FPS (approx 16.66ms)
const TICK_RATE = 1000 / 60;
let lastTime = performance.now();
let accumulator = 0;
let currentTick = 0;

setInterval(() => {
    const now = performance.now();
    let delta = now - lastTime;

    // Prevent spiral of death if the server hangs
    if (delta > 250) {
        delta = 250;
    }

    lastTime = now;
    accumulator += delta;

    let updated = false;
    let eventsForTick: any[] = [];
    while (accumulator >= TICK_RATE) {
        accumulator -= TICK_RATE;
        currentTick++;
        const evs = gameRoom.update(now, TICK_RATE, currentTick);
        eventsForTick = eventsForTick.concat(evs);
        updated = true;
    }

    // Broadcast the sync state to all connected channels only if we ticked
    if (updated) {
        // Debug first player position
        const p = Array.from(gameRoom.players.values())[0];
        if (p && currentTick % 60 === 0) console.log(`Server Tick ${currentTick}, Player Y: ${p.y}`);

        // Periodic full sync to correct drift (every 3 seconds)
        if (currentTick % 180 === 0) {
            io.emit('sync_state', { tick: currentTick, state: gameRoom.getState() });
        }

        if (eventsForTick.length > 0) {
            for (const ev of eventsForTick) {
                if (ev.type === 'turn') {
                    io.emit('player_turned', ev);
                } else if (ev.type === 'death') {
                    io.emit('player_died', ev);
                }
            }
        }
    }
}, TICK_RATE);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
