# @tron0/client

Phaser + SolidJS browser client (Vite).

## Environment variables

The client uses **Vite's env file convention**. Files live in this directory (`packages/client/`), not the repo root.

| File | When it's loaded | Purpose |
|------|------------------|---------|
| `.env.development` | `bun run dev` (`vite` → mode `development`) | Local dev defaults |
| `.env.production` | `bun run build` (`vite build` → mode `production`) | Production build defaults |
| `.env.local` | Either mode (gitignored) | Personal overrides — optional |

Vite picks the mode from the **CLI command**, not from the config filename:

```json
"dev": "vite --config vite/config.dev.mjs",      // mode: development
"build": "vite build --config vite/config.prod.mjs"  // mode: production
```

`config.dev.mjs` / `config.prod.mjs` only control bundler options (port, minify, etc.).

### Load order

Later files override earlier ones:

1. `.env`
2. `.env.local`
3. `.env.[mode]` (`.env.development` or `.env.production`)
4. `.env.[mode].local`

Shell/CI env vars (e.g. `VITE_MANAGER_URL=...` in GitHub Actions) override file values.

### `VITE_` prefix

Only variables prefixed with `VITE_` are exposed to browser code via `import.meta.env`:

```ts
// packages/client/api/serverBrowser.ts
const MANAGER_URL = import.meta.env.VITE_MANAGER_URL || 'http://localhost:3001';
```

At build time, Vite replaces `import.meta.env.VITE_*` with string literals in the bundle. The fallback (`|| 'http://localhost:3001'`) only runs if the var was missing during the build.


### CI / deploy

GitHub Actions runs `bun run build` with mode `production`, so `.env.production` applies. The deploy workflow can override via the `VITE_MANAGER_URL` repository variable.

See [docs/release-and-deploy.md](../../docs/release-and-deploy.md) for the full release and Pages deploy flow.

