# Project Overview
This project is a Tron-like top-down 2D game client built with **Phaser 3** and **SolidJS**. It uses **Vite** as the build tool.

## Tech Stack
-   **Framework**: Phaser 3.90.0
-   **UI Library**: SolidJS 1.9.5
-   **Language**: TypeScript
-   **Build Tool**: Vite

## Project Structure
-   **Entry Point**: `src/index.tsx` (mounts `src/App.tsx`)
-   **Game Logic**: `src/game/`
    -   `main.ts`: Phaser game configuration (Canvas, Arcade physics).
    -   `scenes/GameScene.ts`: The main game scene. Manages the game loop, state (start/over), and input handling.
    -   `gameobjects/`: Custom game objects.
        -   `Player.ts`: Handles player movement, trail generation, and collision logic.
        -   `PlayerManager.ts`: Manages player instances (`humanPlayer`, `aiPlayer`).
        -   `DebugHud.ts`: Debugging visualization.
    -   `EventBus.ts`: Event emitter for game events (e.g., "game-over", "game-start").
-   **UI Integration**: `src/App.tsx` wraps the Phaser game instance using a SolidJS component.

## Game Mechanics
-   **Movement**: Players move in straight lines and can turn 90 degrees (left/right).
-   **Trails**: Players leave a trail behind them (`trailLines`).
-   **Collision/Interaction**:
    -   **Rubber Mechanic**: Rubber depletes when the player is hitting an obstacle. 
    -   **Boundaries**: Hitting the canvas edge triggers "game-over".
    -   **Trails**: Logic exists to detect proximity to trails.
-   **Controls**: Keyboard inputs (Q, S, D, Arrow Keys) mapped to left/right turns. Spacebar restarts the game.
-   **Graphics**:
    -   Player: Represented by a triangle (`driverGraphics`).
    -   Trail: Drawn as lines (`trailGraphics`).
    -   Background: A static grid (`drawGridOnce`).

## Notes
-   Physics FPS is set to 240 in `main.ts`.
-   Game loop logic manually handles some collision/proximity checks in `Player.ts` rather than relying solely on Arcade Physics colliders.
