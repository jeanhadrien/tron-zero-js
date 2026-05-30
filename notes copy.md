# Simulation / Tick / Rollback Notes

## Tick lifecycle (`ECSGameRoom`)

```
GameClock.tick  ──incremented by──►  clock.update(delta)
                                  │
ECSGameRoom.tick                  ──incremented by──►  room.update()  (at end)
```

- `GameClock.update(delta)` **increments `clock.tick` first**, then `room.update()` uses `room.tick` (the old value) to process, then increments `room.tick`.
- After `updateFixed()` returns: `clock.tick === room.tick`.
- `room.tick` represents the **next** unprocessed tick. When reading it externally, the simulation has NOT happened yet for that tick. This means it's safe to add events or inputs for `room.tick`.

### `ECSGameRoom.updateFixed(delta)` flow

1. Check for pending resimulations (`pendingResimTick`). If present and `this.tick > pendingResimTick`, call `replayFrom(pendingResimTick)`.
2. `GameClock.update(delta)` → returns `ticksToProcess` (number of fixed ticks to run).
3. For each tick: call `this.update()` → runs all systems with `getInput(tick)` and `getEvents(tick)` → `this.tick += 1` → records world snapshot.

### `ECSGameRoom.update()` (single tick)

```
input  = (playerId) => playerInputBuffer.get(this.tick, playerId)
events = () => gameEventBuffer.get(this.tick)

for each system: sys.update(input, events)

this.tick += 1
```

**Critical**: `getInput` and `getEvents` can be called multiple times across different systems — they return the same data for the current tick without consuming it.

### System execution order matters

Systems run in the order they're passed to the `ECSGameRoom` constructor array. For example, the server runs:
```
areaSystem → playerSystem → botSystem → networkServerSystem → chatSystem
```

- `playerSystem` processes `PlayerJoined`/`PlayerSpawn` → creates the entity
- `networkServerSystem` then reads the same events → sends INIT_STATE with the now-existing player

## Input pipeline

### Client side

```
keypress → GameScene.keydown handler
  → guard: humanEid >= 0  (must be set from networkClient.clientPlayerEid)
  → targetTick = room.tick + _pendingTurnCount
  → networkClient.sendInput({ tick, turn })
  → guard: room.localPlayerId  (set after INIT_STATE)
  → room.addInput(playerInput)      ← local prediction
  → channel.emit('client_turn', []) ← server relay
```

- `_pendingTurnCount` is reset to 0 AFTER `updateFixed()` in `GameScene.update()`.
- Multiple keypresses between frames increment `_pendingTurnCount`, targeting future ticks.

### Server side

```
channel.on('client_turn', ...) → onClientTurn(channel)
  → room.addInput({ tick, turn, playerId: channel.id })
  → playerInputBuffer.record(tick, playerId, input)
  → looks up eid via PlayerSystem.getPlayerEidByStringId()
  → sets PingInTicks[eid]
  → if tick <= this.tick: schedules resimulation via pendingResimTick
```

## Rollback / Resimulation

### Trigger: `pendingResimTick`

Set by:
- `addInput()` when `input.tick <= this.tick` (late input)
- `addEvent()` when `event.tick < this.tick`
- `addNetworkDiffPayload()` when `diff.tick - 1 < this.tick` (server correction)

### `replayFrom(pastTick)`

1. Load world snapshot at `pastTick` from `worldBuffer`
2. `resetWorld()`, clear `dirtyEntities`
3. `snapshotDeserialize(snapshot)`
4. Set `this.tick = pastTick`
5. Loop from `pastTick` to `currentTick`:
   - Apply any `networkDiffTickRingBuffer` diffs at this tick (server corrections)
   - Call `this.update()` → systems see replayed inputs from `playerInputBuffer.get(tick, playerId)`
   - Record new state in `worldBuffer`
6. Set `replaying = false`

**Key detail**: During replay, `ServerNetworkSystem.update()` skips sending state to clients (`if (this.room.replaying) return`).

### `PlayerInputTickRingBuffer` (extends `TickRingBuffer<PlayerInput>`)

- Capacity: 128 ticks
- `record(tick, playerId, input)`: stores in circular buffer at `tick % capacity`, keyed by `playerId`
- `get(tick, playerId)`: returns input or null. Only succeeds if tick is within the window (`tick > newestTick - capacity && tick <= newestTick`)
- `isInWindow` check means old ticks beyond capacity are silently dropped

## Player lifecycle

### Server events

1. `onConnection` → adds `PlayerJoined(tick=room.tick)` and `PlayerSpawn(tick=room.tick)` events
2. Next tick: `PlayerSystem.update()` → `createPlayer()` (entity + components, `IsAlive=0`), then `spawnPlayer()` (`IsAlive=1`, position, initial trail point)
3. Same tick: `ServerNetworkSystem.update()` → reads `PlayerJoined` event → sends INIT_STATE (full world snapshot)

### Client initialization

1. `requestInitState()` → resets accumulator, emits `request_init`
2. Server receives `request_init` → `ServerNetworkSystem.onConnection` already has the event queued → next tick sends INIT_STATE
3. Client `onInitState(tick, snapshot)`:
   - `room.initFromSnapshot(tick, snapshot)` → deserializes world, sets `room.tick = tick`
   - `room.gameClock.tick = tick` (sync)
   - `room.localPlayerEid = getPlayerEidByStringId(room, channel.id)`
   - `room.localPlayerId = channel.id`

### Client `GameScene`

- `humanEid` starts at `-1`. In `update()`, it reads `networkClient.clientPlayerEid`.
- **Must set `clientPlayerEid` in `onInitState()`** or `humanEid` stays invalid forever, blocking all input.

## Critical components/fields to know

| Symbol | Location | Meaning |
|---|---|---|
| `room.tick` | `ECSGameRoom` | Next unprocessed tick |
| `gameClock.tick` | `GameClock` | Incremented by `clock.update()` first |
| `pendingResimTick` | `ECSGameRoom` | Earliest tick needing resimulation |
| `replaying` | `ECSGameRoom` | True during `replayFrom()` |
| `localPlayerEid` | `ECSGameRoom` | Entity ID of local human player |
| `localPlayerId` | `ECSGameRoom` | String ID (channel.id) of local player |
| `clientPlayerEid` | `ClientNetworkSystem` | **Must mirror `room.localPlayerEid`** |
| `PingInTicks[eid]` | BitECS component | Measured delay in ticks, used by renderer for delay compensation |
| `TrailPoints.xs/ys/dirs[eid]` | BitECS component | Trail point arrays |
| `Direction[eid]` | BitECS component | Current direction in radians |

## Client-side renderer architecture (post-refactor)

### `PlayerRenderSystem`

- **Local player** (`eid === localPlayerEid`): reads directly from current ECS components (`Position`, `Direction`, `Color`, `TrailPoints`) — zero delay, no snapshot lookup.
- **Remote players**: uses `_lookup(eid, tick - PingInTicks[eid])` to find a past snapshot from the history buffer. Trail data is drawn from the snapshot's own arrays (copied in `update()`), NOT from current ECS components.

### History buffer (`Map<eid, PlayerStateSnapshot[]>`)

- `update()`: snapshots the current state for each alive player at current tick. Trail arrays are shallow-copied. Replay-safe: if last entry has same tick, overwrite instead of append.
- Respawn detection: if `TrailPoints.xs.length === 1`, clear history (fresh spawn).
- `PlayerSpawn`/`PlayerLeft` events clean up history and name texts.
- Max age: `MAX_SNAPSHOT_AGE = 60` ticks.

## Gotchas

- `GameClock.update()` increments `gameClock.tick` INSIDE the while loop, NOT after. So after one tick was processed, `gameClock.tick` has already advanced by 1.
- `initFromSnapshot(snapshot)` calls `resetWorld()` which wipes all entities, then `snapshotDeserialize()` recreates them with potentially different entity IDs. External references to old eids are invalidated.
- `PlayerSystem.getPlayerEidByStringId()` **throws** if the player is not found — not `return -1`.
- `TickRingBuffer.get()` returns `null` if the tick is outside the window (beyond capacity or not yet recorded). No error, just `null`.
- During replay, `worldBuffer.record()` overwrites old snapshots at the same tick — no conflict since the world is being corrected.
