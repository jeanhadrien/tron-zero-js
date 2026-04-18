# Tron Zero

## Architecture

This project uses a split architecture:
- **Vite (Frontend):** Bundles the SolidJS UI and Phaser game client (`src/client`) for the browser. 
- **Bun (Backend):** Fast JS runtime that natively executes the TypeScript backend and Socket.io server (`src/server`). In production, it serves the static files built by Vite.

## Local Development

```bash
bun install
bun run dev
```

`bun run dev` concurrently starts:
1. The **Vite** dev server (frontend) on port `8080` with HMR.
2. The **Bun** backend server on port `3000` in `--watch` mode, automatically restarting on file changes.

## Production Build

```bash
bun run build
```

## Deployment (Google Cloud Run)

```bash
gcloud run deploy tron-zero \
  --source . \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --project <project>
```