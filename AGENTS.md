## Tech Stack
- **Phaser 3** + **SolidJS** + **TypeScript** + **Vite** (Frontend)
- **Bun** + **Express** + **Socket.io** (Backend)

## Local
- **Local Development:** Use `bun` as the package manager and runtime.
  - `bun run dev` - Concurrently runs Vite frontend (port 8080) and Bun backend (port 3000) with hot-reloading/watch.
  - `bun run test` - Runs Vitest tests.
  
## Formatting & Typing
- **Formatter:** Prettier (`.prettierrc`).
- **TypeScript:** Strict mode is enabled (`strictPropertyInitialization: false`). Prefix unused variables with `_` to pass `noUnusedLocals`/`noUnusedParameters` checks.

## Expected Gameplay & Collision Rules
- **Movement:** Players (as lightcycles) move continuously forward at a base speed.
- **Turning:** Players can turn 90 degrees left or right relative to their current direction.
- **Trails:** Each lightcycle leaves a permanent trail behind it as it moves.
- **Acceleration:** Moving close and parallel to an existing trail accelerates the player. 
- **Deceleration:** When not moving close and parallel to existing trails, the player decelerates to its base speed.
- **Collisions:** Facing into a trail directly slows the player speed near 0. A player cannot go over trails. 
- **Rubber:** Facing into a trail exhausts a player's rubber. When the rubber hits 0, the player dies.
