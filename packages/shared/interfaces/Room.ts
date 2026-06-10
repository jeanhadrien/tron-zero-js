export interface RoomEntry {
  id: string;           // manager-generated UUID
  host: string;
  port: number;
  secure?: boolean;     // use https:// for geckos signaling (required when client is on HTTPS)
  displayName: string;
  playerCount: number;  // updated via heartbeat
  maxPlayers: number;   // set at register
  lastHeartbeat: number; // Date.now()
}

// POST /api/rooms
export interface RegisterPayload {
  host: string;
  port: number;
  secure?: boolean;
  displayName: string;
  maxPlayers: number;
}

// POST /api/rooms/:id/heartbeat
export interface HeartbeatPayload {
  playerCount: number;
}
