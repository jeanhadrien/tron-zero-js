---
name: core-game-mechanics
description: Understand core game mechanics
license: MIT
compatibility: opencode
---

# Game Mechanics Design Document

This document outlines the core game mechanics. These should be respected at all times.

## 1. Core Entity: The Player (Lightcycle)

Each player controls a continuous-moving lightcycle.

- **Base Speed:** Players move forward at a constant base speed.

## 2. Movement & Turning

- **Continuous Movement:** Players cannot stop moving completely unless they hit an obstacle. The physical position is updated each tick based on the current direction and speed multiplier.
- **Turning:**
  - Players can only turn in fixed degree increments (left/right)
  - Only one turn is executed per tick update.
  - When a player turns, a new turn coordinate is recorded and added to their trail.

## 3. Trails & Obstacles

- **Trail Generation:** As players move, they leave behind turn points. The trail consists of the lines between all the points and the current state position (active trail).
- **Collision Lines:** The collidable environment is constructed dynamically each tick. It consists of:
  - The outer boundaries of the game area.
  - All player trails including player's own trail.

## 4. Detection & Sensors

Each player is equipped with three forward-looking "sensor" lines to detect the distance to the nearest obstacle (walls or trails).

- **Front Sensor:** Looks straight ahead in the current direction.
- **Left Sensor:** Looks to the left.
- **Right Sensor:** Looks to the right.
- The length of these sensors scales with the player's current speed to ensure they don't miss collisions at high velocities.

## 5. Speed Mechanics: Acceleration & Deceleration

The game encourages risky play by rewarding players who ride close to existing trails.

- **Sliding (Acceleration):** If the Left or Right sensor detects an obstacle within a very short distance, the player is considered "sliding". While sliding, the player's target speed multiplier increases exponentially.
- **Deceleration:** If a player is in open space (not sliding) and their target speed multiplier is greater than the baseline, it decays back down to the baseline over time.
- **Inertia:** The player's actual speed multiplier smoothly interpolates towards the target speed multiplier, meaning acceleration and deceleration have a slight ramp-up/ramp-down.

## 6. Collision & The "Rubber" System

Directly hitting a wall or trail does not instantly kill the player. Instead, the game uses a "Rubber" system.

- **Getting Stuck:** If the Front sensor detects an obstacle within a critical distance, the player is "stuck".
- **Speed Drop:** The player's speed drops aggressively in proportion to how close they are to the wall, practically halting them before they cross the line.
- **Rubber Consumption:** While stuck, the player's "Rubber" meter rapidly depletes. The closer the player is pushed against the wall, the faster rubber is consumed.
- **Death:** If the Rubber meter reaches zero, the player dies and the lightcycle is disabled.
- **Rubber Regeneration:** If the player manages to turn away from the wall before dying, the Rubber meter slowly regenerates back to its maximum over time.
