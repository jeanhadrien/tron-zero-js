import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { Logger } from '@tron0/shared/Logger';
import { registerRoom, removeRoom, getRoom, getAllRooms, evictStale } from './roomStore';
import type { RegisterPayload, HeartbeatPayload } from '@tron0/shared/interfaces/Room';

const HEARTBEAT_INTERVAL = 30_000; // servers should heartbeat every 30s
const EVICT_GRACE = 10_000; // extra grace period
const EVICT_SCAN_MS = 10_000; // scan interval

const logger = new Logger('ServerManager');

const app = express();
app.use(cors());
app.use(express.json());

// Register a new game room
app.post('/api/rooms', (req, res) => {
  const body = req.body as RegisterPayload;

  if (!body.host || !body.port || !body.displayName || body.maxPlayers == null) {
    logger.warn('Register missing fields', body);
    res.status(400).json({ error: 'Missing fields: host, port, displayName, maxPlayers' });
    return;
  }

  const id = randomUUID();
  const entry = registerRoom(body, id);
  logger.info(`Room registered — id=${id} name="${body.displayName}" host=${body.host}:${body.port}`);
  res.json(entry);
});

// Heartbeat from a game room
app.post('/api/rooms/:id/heartbeat', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) {
    logger.warn(`Heartbeat for unknown room — id=${req.params.id}`);
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  const body = req.body as HeartbeatPayload;
  if (body.playerCount != null) {
    room.playerCount = body.playerCount;
  }
  room.lastHeartbeat = Date.now();
  res.json({ ok: true });
});

// Graceful unregister on server shutdown
app.delete('/api/rooms/:id', (req, res) => {
  const existed = removeRoom(req.params.id);
  logger.info(`Room unregistered — id=${req.params.id} existed=${existed}`);
  res.json({ ok: true, existed });
});

// Client server browser endpoint
app.get('/api/rooms', (_req, res) => {
  const rooms = getAllRooms();
  logger.debug(`Listed ${rooms.length} room(s)`);
  res.json(rooms);
});

// Periodic eviction of stale rooms
setInterval(() => {
  const removed = evictStale(HEARTBEAT_INTERVAL + EVICT_GRACE);
  if (removed > 0) {
    logger.warn(`Evicted ${removed} stale room(s)`);
  }
}, EVICT_SCAN_MS);

export default app;
