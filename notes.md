# Simulation mental model

## Tick is "next to process"

The simulation tick counter points to the tick that has NOT run yet. Inputs and events queued for this tick will be consumed in the next `tick → tick+1` transition. This is why it's safe to add inputs for the current value of `room.tick`.

## Fixed timestep with rollback

Each frame, the clock accumulates real time and determines how many fixed ticks to simulate. After all ticks run, the world state is snapshotted into a ring buffer. When a late input arrives (network delay or queued keypress), the simulation rewinds to the input's tick, replays from there forward using the stored snapshots, and then continues normally.

## Input is queued by (tick, playerId)

Inputs are stored in a tick-keyed ring buffer, indexed by tick and player ID. During simulation, each tick pulls up any queued input for that player. No input = no turn; queued input = turn gets applied. Both client (prediction) and server (authority) use the same buffer mechanics.

## System execution order is linear

ECS systems run in array order each tick. A system that creates entities must run before a system that reads them. A system that sends network state runs last so it captures the fully computed tick.

## Events are same-tick, non-consuming

Events fire for the current tick, are visible to ALL systems in that tick's iteration, and are not removed after being read. This means a single event can drive both entity creation (in a gameplay system) and network sync (in a network system) within the same tick.

## Client must mirror two IDs

The local player has both a string ID (persistent across respawns) and an entity ID (ephemeral, changes on respawn). Both must be stored client-side when the initial state arrives. Missing either one silently breaks all input.

## Renderer splits local vs remote

Local player renders directly from live ECS state (zero delay). Remote players render from delay-compensated snapshots that carry their own trail data — this avoids mixing past positions (from the snapshot lookup) with current trail arrays (from live ECS), which produces garbled trails.

## Replay overwrites, doesn't append

When replaying a tick that already has a snapshot, the new state replaces the old one. The history for a tick is always the most recent simulation result for that tick.
