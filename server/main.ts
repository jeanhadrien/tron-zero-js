import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as Phaser from 'phaser';
import GameRoom from './GameRoom';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*'
    }
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
    socket.emit('init_state', gameRoom.getState());
    
    // Notify others
    socket.broadcast.emit('player_joined', { id: socket.id, state: gameRoom.getPlayerState(socket.id) });

    socket.on('turn', (data: { direction: 'left' | 'right' }) => {
        gameRoom.handleTurn(socket.id, data.direction);
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        gameRoom.removePlayer(socket.id);
        io.emit('player_left', { id: socket.id });
    });
});

// Fixed update loop at 60 FPS (approx 16.66ms)
const TICK_RATE = 1000 / 60;
let lastTime = Date.now();

setInterval(() => {
    const now = Date.now();
    const delta = now - lastTime;
    lastTime = now;

    gameRoom.update(now, delta);

    // Broadcast the sync state to all connected sockets
    io.emit('sync_state', gameRoom.getState());
}, TICK_RATE);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
