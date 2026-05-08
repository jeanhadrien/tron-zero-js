# Menu Scene Specification

## Overview

A **SolidJS overlay menu** that sits on top of the Phaser game canvas. On first page load, the menu covers the canvas (opaque) showing a server browser. The user picks a server and clicks "Join" to connect. During gameplay, pressing `Escape` toggles the menu overlay. Switching servers auto-disconnects from the current one.

```
┌─────────────────────────────────┐
│  App                            │
│  ┌───────────────────────────┐  │
│  │ PhaserGame (canvas)       │  │
│  │ ┌───────────────────────┐ │  │
│  │ │ GameScene             │ │  │
│  │ │ (empty arena / game)  │ │  │
│  │ └───────────────────────┘ │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ MenuScreen (SolidJS,      │  │
│  │ position:absolute overlay)│  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

---

## Data Model

### Server config (`public/servers.json`)

```json
[
  { "name": "Local Dev", "host": "localhost", "port": 3000 }
]
```

Fetched by the client at runtime. Defines the static list of known servers.

### Server status (HTTP `GET /api/status`)

```json
{
  "name": "Local Dev",
  "playerCount": 3,
  "maxPlayers": 10
}
```

### Types (`src/client/types/ServerInfo.ts`)

```ts
export interface ServerInfo {
  name: string;
  host: string;
  port: number;
}

export interface ServerStatus {
  name: string;
  playerCount: number;
  maxPlayers: number;
}

export interface ServerEntry {
  info: ServerInfo;
  status: ServerStatus | null;
  ping: number | null;
  connected: boolean;
}
```

**Ping** is measured client-side by timing the HTTP `GET /api/status` fetch.

---

## Server Changes (`src/server/`)

### 1. `GET /api/status` endpoint (`main.ts`)

Add an Express route returning live server metadata:

- **Request**: `GET /api/status`
- **Response 200**: `{ "name": "string", "playerCount": number, "maxPlayers": number }`

Configuration:
- `SERVER_NAME` env var (default `"Unnamed Server"`) — the server's display name.
- `MAX_PLAYERS` env var (default `10`) — maximum connected players.

The route needs access to `gameRoom` to read `gameRoom.getState().players.size` for the live player count.

### 2. Max players enforcement (`network/NetworkServer.ts`)

In the `onConnection` handler, before creating a player:
- Check `gameRoom.getState().players.size >= maxPlayers`.
- If full: emit a `'server_full'` event on the new channel, then close the channel.
- The client shows a "Server full" message on the rejected entry.

---

## Client Changes (`src/client/`)

### 1. Types file `src/client/types/ServerInfo.ts` (new)

Defines `ServerInfo`, `ServerStatus`, `ServerEntry` as specified in Data Model above.

### 2. `public/servers.json` (new)

Static server list file. Fetched by the menu on mount.

### 3. `NetworkClient.ts` — host/port parameterization + disconnect

- `connect(host: string, port: number)` — replaces the current `connect()` which hardcodes `window.location.hostname` and port 3000.
- `disconnect()` — closes the geckos.io channel, cleans up event listeners, stops ping interval.
- Expose `isConnected(): boolean` for GameScene to query.

### 4. `GameScene.ts` — delayed connect + disconnect/reset

- **Remove** the `setupSocket()` call from `create()`. The scene boots into an empty arena state (only the grid is rendered).
- Add a `connect(host: string, port: number)` method:
  - Calls `this.networkClient.connect(host, port)`.
  - On success: emit `'game-connected'` on EventBus.
  - On failure: emit `'connection-failed'` with `{ error: string }`.
- Add a `disconnect()` method:
  - Calls `this.networkClient.disconnect()`.
  - Resets all game state: remove all player renderers, clear trails, reset `gameRoom` (or re-create it).
  - Restore empty-arena rendering.
  - Emit `'game-disconnected'` on EventBus.
- Listen on EventBus for `'join-server'` and `'disconnect'` events.

### 5. `MenuScreen.tsx` (new) — main menu component

#### Layout

```
┌──────────────────────────────────┐
│  TITLE                           │
│                                  │
│  ┌────────────────────────────┐  │
│  │ Server Name    Players Ping│  │
│  │ ────────────────────────── │  │
│  │ Local Dev      3/10   12ms│  │  ← clickable rows
│  │ EU West         0/10   45ms│  │
│  │ ...                       │  │
│  └────────────────────────────┘  │
│                                  │
│  [ Refresh ]                     │
│                                  │
│  Direct Connect: [_host:port_] [Connect]  │
│                                  │
│  [ Disconnect ]  (visible when connected)│
└──────────────────────────────────┘
```

#### States

- **Initial**: Opaque overlay covering the canvas. Shows server list + direct connect input.
- **Connected (game running)**: Semi-transparent overlay (toggled by Escape). Highlights the currently connected server. Same list, plus a "Disconnect" button visible at the bottom.
- **Connecting**: The clicked server row shows a spinner/loading indicator. Other rows remain interactive for cancelling (clicking another server switches the join target).
- **Connection error**: The failed server row shows an error message (e.g. "Connection refused", "Server full").

#### Server list behavior

- On mount, fetches `public/servers.json`.
- For each server, immediately fires `GET http://<host>:<port>/api/status` to populate player count and measure ping.
- **Auto-refresh**: polls `/api/status` for every server every **5 seconds** while the menu is visible.
- **Manual refresh**: a "Refresh" button re-fetches all statuses immediately.
- **Offline servers**: shown greyed out with "Offline" label instead of player count/ping.

#### Direct connect input

- Single text input accepting `host` or `host:port` (default port 3000 if omitted).
- "Connect" button or `Enter` key immediately triggers a join. No pre-flight status fetch — name and player count become available after connecting (via the server's `init_state` or a follow-up event).
- The connection result (success/failure) is shown inline next to the input field.

#### Join flow

1. User clicks "Join" on a server row (or hits Enter in direct connect).
2. Menu emits `join-server` on EventBus with `{ host, port }`.
3. The target row shows "Connecting…" spinner.
4. GameScene receives `join-server`, calls `NetworkClient.connect(host, port)`.
5. WebRTC channel establishes → GameScene emits `'game-connected'`.
6. Menu marks that server as connected, hides the overlay (or goes semi-transparent if toggled by Escape).
7. If connection fails → GameScene emits `'connection-failed'`. Menu shows the error on the target row.

#### Disconnect flow

1. User clicks "Disconnect" → emits `'disconnect'` on EventBus.
2. GameScene calls `NetworkClient.disconnect()` and resets to empty arena.
3. GameScene emits `'game-disconnected'`.
4. Menu clears the "connected" highlight, becomes opaque, ready for the next join.

#### Switch-server flow

1. User clicks "Join" on a different server while already connected.
2. Menu emits `'disconnect'`, waits for `'game-disconnected'`, then emits `'join-server'` for the new server.
3. From the user's perspective: a seamless single-click switch.

#### Props / Signals

- `visible: Accessor<boolean>` — controls the overlay's mount/style visibility.
- `setVisible: Setter<boolean>` — toggled by Escape key.
- Communicates with GameScene exclusively via EventBus (no direct coupling).

#### CSS

- `src/client/components/MenuScreen.css` (new).
- Overlay: `position: absolute; top: 0; left: 0; width: 100%; height: 100%`.
- Initial state: opaque dark background.
- Connected state: semi-transparent background (rgba).
- Server rows: hover highlight, active/connected highlight.
- Transitions for fade in/out on Escape toggle.

### 6. `App.tsx` — wiring

- Render `<MenuScreen>` inside the container div, absolutely positioned over `<PhaserGame>`.
- Add a `menuVisible` signal (starts `true` on page load).
- On mount, add a `keydown` listener for `Escape` to toggle `menuVisible`.
- When menuVisible is `false`, menu renders with `display: none` or `opacity: 0; pointer-events: none`.
- Listen to EventBus for `'game-connected'` (auto-hide menu, set menuVisible to `false`) and `'game-disconnected'` (auto-show menu, set menuVisible to `true`).
- On cleanup, remove the Escape listener.

### 7. `PhaserGame.tsx` — minor changes

- Ensure Phaser game instance is created only once (singleton pattern). `StartGame()` should return the existing instance if already created, or be replaced by a mount-once approach.
- The Phaser canvas should always be rendered behind the menu overlay, even when no server is connected (empty arena state).

---

## EventBus Contract

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `join-server` | Menu → GameScene | `{ host: string, port: number }` | Request game connection |
| `disconnect` | Menu → GameScene | *(none)* | Request disconnect from current server |
| `game-connected` | GameScene → App/Menu | *(none)* | Game successfully connected to a server |
| `game-disconnected` | GameScene → App/Menu | *(none)* | Game disconnected, arena reset to empty |
| `connection-failed` | GameScene → Menu | `{ error: string }` | WebRTC connection attempt failed |

All events use the singleton `EventBus` (`src/client/game/EventBus.ts`).

---

## Implementation Order

1. **Server `/api/status` endpoint** + `SERVER_NAME` / `MAX_PLAYERS` env vars (`src/server/main.ts`)
2. **Server max players enforcement** (`src/server/network/NetworkServer.ts`)
3. **`public/servers.json`** + `src/client/types/ServerInfo.ts` (data foundation)
4. **`NetworkClient` host/port parameterization + disconnect** method (`src/client/game/network/NetworkClient.ts`)
5. **`GameScene` delayed connect + disconnect/reset** (`src/client/game/scenes/GameScene.ts`)
6. **`MenuScreen.tsx` + `MenuScreen.css`** (the bulk of the work)
7. **`App.tsx` wiring** + Escape key listener + overlay layout
8. **Polish**: connecting spinner, error states, offline server display, CSS transitions
