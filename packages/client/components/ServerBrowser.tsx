import { createSignal, onMount, onCleanup, Show, For } from 'solid-js';
import { fetchGameRooms, GameRoomInfo } from '../api/serverBrowser';
import { EventBus } from '../game/EventBus';

const ServerBrowser = () => {
  const [rooms, setRooms] = createSignal<GameRoomInfo[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  let intervalId: number | undefined;

  const loadRooms = async () => {
    try {
      setError(null);
      setLoading(true);
      const list = await fetchGameRooms();
      setRooms(list);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch servers');
      setRooms([]);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadRooms();
    intervalId = window.setInterval(loadRooms, 5000);
  });

  onCleanup(() => {
    if (intervalId !== undefined) {
      clearInterval(intervalId);
    }
  });

  const handleConnect = (room: GameRoomInfo) => {
    EventBus.emit('connect-to-server', { host: room.host, port: room.port });
  };

  return (
    <div>
      <Show when={loading() && rooms().length === 0}>
        <div style={{ 'text-align': 'center', padding: '24px', color: '#888' }}>Loading servers...</div>
      </Show>
      <Show when={error()}>
        <div style={{ 'text-align': 'center', padding: '24px', color: '#f44' }}>Error: {error()}</div>
      </Show>
      <Show when={!loading() && rooms().length === 0 && !error()}>
        <div style={{ 'text-align': 'center', padding: '24px', color: '#888' }}>No servers found</div>
      </Show>
      <For each={rooms()}>
        {(room) => (
          <div class="server-row">
            <span class="server-name">{room.displayName}</span>
            <span class="server-players">{room.playerCount}/{room.maxPlayers}</span>
            <button class="server-connect-btn" onClick={() => handleConnect(room)}>Connect</button>
          </div>
        )}
      </For>
    </div>
  );
};

export default ServerBrowser;
