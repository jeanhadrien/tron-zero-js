## Simulation Mental Model

- **Tick is "next to process"**: The tick counter points to the tick that has NOT run yet. Inputs queued for this tick are consumed during the `tick → tick+1` transition. Safe to add inputs for the current tick.

- **Fixed tick rate with rollback**: Clock accumulates real time each frame to determine how many fixed ticks to simulate. Client receives server authoritative state, can trigger replays from past snapshot → reconcile state and continue.

- **Inputs are buffered by (tick, player)**: During simulation, both client (prediction) and server (authority) use the same buffer mechanics.

- **System execution is linear**: ECS systems run in array order each tick.

- **Client mirrors two IDs**: The local player has a string ID (human) and an entity ID (simulation engine).

- **Replay overwrites, not appends**: When replaying for a past tick, the new simulation state replaces the old one.