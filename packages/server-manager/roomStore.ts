import type { RoomEntry, RegisterPayload } from '@tron0/shared/interfaces/Room';

// JSON-friendly (plain object), ready for persistence layer later
const rooms = new Map<string, RoomEntry>();

export function registerRoom(payload: RegisterPayload, id: string): RoomEntry {
  // Evict any existing room with the same host:port to prevent duplicates on restart
  for (const [existingId, room] of rooms) {
    if (room.host === payload.host && room.port === payload.port) {
      rooms.delete(existingId);
      break;
    }
  }

  const entry: RoomEntry = {
    id,
    host: payload.host,
    port: payload.port,
    secure: payload.secure,
    displayName: payload.displayName,
    maxPlayers: payload.maxPlayers,
    playerCount: 0,
    lastHeartbeat: Date.now(),
  };
  rooms.set(id, entry);
  return entry;
}

export function removeRoom(id: string): boolean {
  return rooms.delete(id);
}

export function getRoom(id: string): RoomEntry | undefined {
  return rooms.get(id);
}

export function getAllRooms(): RoomEntry[] {
  return Array.from(rooms.values());
}

// Evict rooms that haven't heartbeated within the given timeout
export function evictStale(maxAgeMs: number): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, room] of rooms) {
    if (now - room.lastHeartbeat > maxAgeMs) {
      rooms.delete(id);
      removed++;
    }
  }
  return removed;
}

