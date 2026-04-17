# Multiplayer Implementation Plan

The game currently uses Phaser 3 for rendering, audio, and its math/geometry engine. It also relies on a variable timestep (Phaser's `delta` time) for movement (`x += velocity[0] * delta / 1000`), and `Player.ts` tightly couples physics logic with rendering (Graphics) and Web Audio API calls.

To make this a scalable multiplayer game hosted on GCP with an **Authoritative Server** using **Socket.io**, we need to ensure the server can run the exact same game logic as the client without needing a browser environment. Since "Tron" is extremely sensitive to precise collisions and input timing, we also need to handle latency carefully.

Here is the step-by-step plan:

## Phase 1: Refactor Logic First (Decoupling & Fixed Timestep)
Before introducing networking, we must isolate the game rules so the Node.js server can run them natively without crashing over missing `AudioContext` or Canvas elements.

1. **Extract Pure Logic:** We will split `Player.ts` into two parts. A `PlayerState` (or physics class) will hold pure data (`x`, `y`, `direction`, `speed`, `rubber`, `trailLines`) and pure math methods (raycasting for collisions, movement updates).
2. **Thin Renderer:** The original `Player.ts` will become a visual wrapper that reads the `PlayerState` to update the Phaser Graphics and Engine Sounds every frame.
3. **Fixed Timestep Engine:** We will replace the variable `delta` movement with a strict **Fixed Timestep** loop (e.g., exactly 60 updates per second, 16.66ms per tick). This is critical so the server and client physics engines calculate the exact same outcomes.

## Phase 2: Build the Authoritative Server
1. **Initialize Node Server:** Create a new Express + Socket.io server alongside the Vite project.
2. **Server Game Loop:** The server will import the decoupled `PlayerManager` and `PlayerState` logic, running the exact same fixed timestep loop as the client.
3. **Room Management:** The server will handle new connections, instantiate players, and process disconnections. The human bots logic (`BotController`) can also be moved to the server to populate empty matches.

## Phase 3: State Synchronization & Client Prediction
Because Tron requires pixel-perfect split-second turns, waiting for the server to process a turn will feel incredibly laggy. We must mask the network latency:

1. **Client -> Server:** The client sends input commands (`{ action: 'turn', direction: 'left', tick: 124 }`).
2. **Server -> Client (Tick Broadcast):** The server processes inputs, simulates the physics, and broadcasts the absolute truth (`x`, `y`, `direction`, `rubber`) to all clients every tick.
3. **Client-Side Prediction (Local Player):** The local client instantly applies its own turns so the controls feel responsive. It keeps a history of its inputs. When the server state arrives, it checks if the server agrees. If you died on the server, the client snaps to the server's reality.
4. **Interpolation (Other Players):** The client smoothly glides other players between the incoming server packets to prevent them from "teleporting" or jittering across the screen.

## Phase 4: Deployment to GCP
1. **Dockerization:** We will create a `Dockerfile` that builds the Vite frontend and bundles the Node.js backend. The Express server will serve both the Socket.io endpoints and the static HTML/JS assets.
2. **Google Cloud Run:** We will deploy this container to **Cloud Run**, which scales automatically, handles HTTPS routing, and fully supports persistent WebSocket connections.
