import 'jsdom-global/register';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as Phaser from 'phaser';
import GameRoom from './GameRoom';
import path from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*'
    }
});

// Serve static assets from 'dist' directory
app.use(express.static(path.join(process.cwd(), 'dist')));

app.get(/^.*$/, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

// Initialize Headless Phaser (forces Phaser's math/geometry to work)
const phaserGame = new Phaser.Game({
    type: Phaser.HEADLESS,
    width: 800,
    height: 600,
    banner: false,
    audio: {
        noAudio: true
    }
});

const gameRoom = new GameRoom();

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    // Join the game
    gameRoom.addPlayer(socket.id);
    
    // Send initial state to the new player
    socket.emit('init_state', { tick: currentTick, state: gameRoom.getState() });
    
    // Notify others
    socket.broadcast.emit('player_joined', { id: socket.id, state: gameRoom.getPlayerState(socket.id) });

    socket.on('turn', (data: { direction: 'left' | 'right', sequenceNumber: number }) => {
        gameRoom.handleTurn(socket.id, data.direction, data.sequenceNumber);
    });

    socket.on('ping', (clientTime: number) => {
        socket.emit('pong', clientTime);
    });

    socket.on('respawn', () => {
        console.log(`Player respawned: ${socket.id}`);
        gameRoom.respawnPlayer(socket.id);
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        gameRoom.removePlayer(socket.id);
        io.emit('player_left', { id: socket.id });
    });
});

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
    while (accumulator >= TICK_RATE) {
        accumulator -= TICK_RATE;
        currentTick++;
        gameRoom.update(now, TICK_RATE, currentTick);
        updated = true;
    }

    // Broadcast the sync state to all connected sockets only if we ticked
    if (updated) {
        // Debug first player position
        const p = Array.from(gameRoom.players.values())[0];
        if (p && currentTick % 60 === 0) console.log(`Server Tick ${currentTick}, Player Y: ${p.y}`);
        
        io.emit('sync_state', { tick: currentTick, state: gameRoom.getState() });
    }
}, TICK_RATE);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
