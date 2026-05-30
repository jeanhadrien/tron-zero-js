import type { RoomEntry, RegisterPayload } from '@tron0/shared/interfaces/Room';

// JSON-friendly (plain object), ready for persistence layer later
const rooms = new Map<string, RoomEntry>();

export function registerRoom(payload: RegisterPayload, id: string): RoomEntry {
  const entry: RoomEntry = {
    id,
    host: payload.host,
    port: payload.port,
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

// JSON-serializable snapshot for potential persistence
export function toJSON(): object {
  return Array.from(rooms.entries());
}
