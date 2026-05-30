import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { registerRoom, removeRoom, getRoom, getAllRooms, evictStale } from './roomStore';
import type { RegisterPayload, HeartbeatPayload } from './types';

const HEARTBEAT_INTERVAL = 30_000;  // servers should heartbeat every 30s
const EVICT_GRACE = 10_000;         // extra grace period
const EVICT_SCAN_MS = 10_000;       // scan interval

const app = express();
app.use(cors());
app.use(express.json());

// Register a new game room
app.post('/api/rooms', (req, res) => {
  const body = req.body as RegisterPayload;

  if (!body.host || !body.port || !body.displayName || body.maxPlayers == null) {
    res.status(400).json({ error: 'Missing fields: host, port, displayName, maxPlayers' });
    return;
  }

  const id = randomUUID();
  const entry = registerRoom(body, id);
  res.json(entry);
});

// Heartbeat from a game room
app.post('/api/rooms/:id/heartbeat', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) {
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
  res.json({ ok: true, existed });
});

// Client server browser endpoint
app.get('/api/rooms', (_req, res) => {
  res.json(getAllRooms());
});

// Periodic eviction of stale rooms
setInterval(() => {
  const removed = evictStale(HEARTBEAT_INTERVAL + EVICT_GRACE);
  if (removed > 0) {
    console.log(`[manager] Evicted ${removed} stale room(s)`);
  }
}, EVICT_SCAN_MS);

export default app;
