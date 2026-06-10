## Tech Stack
- **Phaser 3** + **SolidJS** + **TypeScript** + **Vite** + **geckos.io** (Frontend)
- **Bun** + **Express** + **geckos.io** (Backend)
- **bitecs** ECS (shared engine, used by both client and server)
- **Bun workspaces** monorepo under `packages/*`

## Project Structure

```
packages/
  shared/         @tron0/shared — ECS room, game logic, types, networking protocol, math utils
  client/         @tron0/client — Phaser + SolidJS frontend (Vite, port 8080)
  server/         @tron0/server — Game server: Express + geckos.io (Bun, port 3000)
  server-manager/ @tron0/server-manager — Lobby/matchmaking server (Bun, port 3001)
```

Entrypoints: `packages/client/index.html` (Vite), `packages/server/index.ts` (Bun), `packages/server-manager/index.ts` (Bun). The `bun run build` script only builds the **client** (Vite); server packages are run directly with Bun, no build step.

The shared package has a **flat file structure** — no `src/` directory. Files live at `packages/shared/*.ts`, `packages/shared/systems/`, `packages/shared/interfaces/`, `packages/shared/utils/`, `packages/shared/otel/`. Imports use bare paths: `@tron0/shared/Logger`, `@tron0/shared/systems/PlayerSystem`.

The server uses **jsdom** to run the ECS simulation in a worker context (Node lacks a DOM). This is why the server package depends on jsdom but the client doesn't.

## Ports & Env

| Port | Service |
|------|---------|
| 8080 | Vite dev server (client) - Defaults to 8081 if 8080 is taken |
| 3000 | Game server (geckos.io signaling + game ticks) |
| 3001 | Server-manager (lobby/matchmaking) |
| 9229 | Game server debug inspector (dev only, `--inspect=localhost:9229`) |

Copy `.env.template` to `.env` before running. Key client-side vars: `VITE_MANAGER_URL`, `VITE_OTEL_ENABLED`, `VITE_LOG_LEVEL`. Key server-side vars: `MANAGER_URL`, `ADVERTISED_HOST`, `SERVER_NAME`, `MAX_PLAYERS`, `PORT`, `MANAGER_PORT`.

## CodeGraph

This project has a CodeGraph index (tree-sitter-parsed knowledge graph). Gotcha: codegraph tools have an extra `codegraph_` prefix, i.e: `codegraph_codegraph_explore`. Avoid re-verifying codegraph results with grep.

## Navigating this project

Limit your scope to the side you are working on (client, server, or server-manager). If you need to read across packages, ask the user first. All shared code comes from `packages/shared/`, imported via `@tron0/shared/*` (resolved via `paths` in each package's `tsconfig.json`). TypeScript references use project references (`tsconfig.json` at root contains a `references` array).

## Documentation and file loading

Use your Read tool to load documentation (@docs/*.md) on a need-to-know basis. Do not preemptively load all references - use lazy loading based on actual need.

- @docs/simulation-loop.md : Tick-based simulation mental model.
- @docs/netcode-design.md : High-level netcode guidelines.
- @docs/core-game-mechanics.md : What the game is about. Use when working with gameplay systems.

bitECS is the ECS library this project uses for simulating the game world.

- @docs/bitecs/intro.md : Intro to the bitECS library (large file)
- @docs/bitecs/serialization.md : Details about serializing world entities and components, snapshotting, etc. (large file)

## Tests

Do not test or try to run tests. To be done later.

## Commands

```sh
bun run dev           # concurrently starts client, server, and server-manager in dev mode
bun run dev:client    # start only the Vite client dev server
bun run dev:server    # start only the game server (--watch + --inspect=localhost:9229)
bun run dev:manager   # start only the server-manager (--watch)
bun run typecheck     # tsc --noEmit across all 4 packages
bun run build         # Vite production build (client only)
bun run server        # start server in production (bun --cwd packages/server start)
```

No `lint` script is wired (eslint is configured but must be run manually). 

## Dependency Hierarchy

```
@tron0/shared  ←  no workspace deps (peer: bitecs, dep: eventemitter3, otel)
@tron0/client  depends on  @tron0/shared (workspace:*)
@tron0/server  depends on  @tron0/shared (workspace:*)
@tron0/server-manager  depends on  @tron0/shared (workspace:*)
```

## Coding Conventions

- Indent: **2 spaces** (prettier `tabWidth: 2` wins over editorconfig's indent_size=4). Use `singleQuote`, `trailingComma: "es5"`, `printWidth: 120`.
- Always leave a short comment on exported functions describing intended usage.
- Prefer high-level, meaningful system and function names.
- The project is in **prototyping phase** — no backwards compatibility required. Refactor freely, but state changes to the user.

## Deployment

- **Client + server-manager:** `docs/release-and-deploy.md` (release-please → GitHub Pages + Cloud Run on release)
- **Game server:** `DEPLOYMENT.md` — requires **UDP** (WebRTC data channels), deploy to **GCE VM** with firewall rules opening TCP:3000 and UDP:10000-20000. STUN servers are configured in both client and server ICE settings for NAT traversal.

