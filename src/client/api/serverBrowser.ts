// Fetched from GET /api/rooms on the server-manager
export interface GameRoomInfo {
  id: string;
  host: string;
  port: number;
  displayName: string;
  playerCount: number;
  maxPlayers: number;
  lastHeartbeat: number;
}

const MANAGER_URL = import.meta.env.VITE_MANAGER_URL || 'http://localhost:3001';

// Fetch the full list of available game rooms from the server-manager
export async function fetchGameRooms(): Promise<GameRoomInfo[]> {
  const res = await fetch(`${MANAGER_URL}/api/rooms`);
  if (!res.ok) throw new Error(`Manager returned ${res.status}`);
  return res.json();
}
