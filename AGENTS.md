## Tech Stack
- **Phaser 3** + **SolidJS** + **TypeScript** + **Vite**

## Local
- **Local Development:** Use `bun` as the package manager.
  - `bun run test` - Runs Vitest tests.
- Do not run use bun run dev or bun run build. Instead, ask the user to test.

## Architecture & Entrypoints
- `src/index.tsx`: SolidJS application root.
- `src/game/main.ts`: Phaser game configuration and instantiation.
- `src/game/EventBus.ts`: Central `Phaser.Events.EventEmitter` used for communication between SolidJS HTML components and Phaser scenes.

## Testing Quirks
- Vitest runs in a `jsdom` environment.
- Phaser tests require headless rendering: `vitest.setup.ts` creates a mock Canvas and polyfills `jsdom-worker`.
- The `phaser` import in tests is aliased to `phaser/dist/phaser.js` to force the pre-built browser version instead of Node source files (`vitest.config.ts`).

## Formatting & Typing
- **Formatter:** Prettier (`.prettierrc`).
- **TypeScript:** Strict mode is enabled, but `strictPropertyInitialization` is explicitly set to `false` in `tsconfig.json`.

## Expected Gameplay & Collision Rules
- **Movement:** Players (as lightcycles) move continuously forward at a base speed.
- **Turning:** Players can turn 90 degrees left or right relative to their current direction.
- **Trails:** Each lightcycle leaves a permanent trail behind it as it moves.
- **Acceleration:** Moving close and parallel to an existing trail accelerates the player. 
- **Decelartion:** When not moving close and parallel to existing trails, the player decelerates to its base speed.
- **Collisions:** Facing into a trail directly slows the player speed near 0. A player cannot go over trails. 
- **Rubber:** Facing into a trail exhausts a player's rubber. When the rubber hits 0, the player dies.
