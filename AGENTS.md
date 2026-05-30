## Tech Stack
- **Phaser 3** + **SolidJS** + **TypeScript** + **Vite** + **geckos.io** (Frontend)
- **Bun** + **Express** + **geckos.io** (Backend)

## Navigating this project

You're either working for the client (src/client/*), or the server (src/server/*). Both share common classes (src/shared/*). Limit the scope of your access to the side you are working on. If you are working for the client, do not read files from the server. If you are working for the server, do not read files from the client. If you need cross information, you must ask the user for permission.

## Documentation

Always read the relevant .md files in ./docs about netcode, game rules, ecs...

## Developing

The project is currently in prototyping phase and needs to move forward. Feel free to consider big architecture changes. Never try to keep backwards compatibility.

## Coding guidelines

Prefer high-level and meaningful system and function names. Always leave a little comment for functions you create with the intended usage. 

## Simulation mental model

- Tick is "next to process": The simulation tick counter points to the tick that has NOT run yet. Inputs and events queued for this tick will be consumed in the next `tick → tick+1` transition. This is why it's safe to add inputs for the current value of `room.tick`.

- Fixed timestep with rollback: Each frame, the clock accumulates real time and determines how many fixed ticks to simulate. After all ticks run, the world state is snapshotted into a ring buffer. When a late input arrives (network delay or queued keypress), the simulation rewinds to the input's tick, replays from there forward using the stored snapshots, and then continues normally.

- Inputs are queued : Inputs are stored indexed by tick and player. During simulation, each tick pulls up any queued input for that player. No input = no turn; queued input = turn gets applied. Both client (prediction) and server (authority) use the same buffer mechanics.

- System execution order is linear: ECS systems run in array order each tick. A system that creates entities must run before a system that reads them. A system that sends network state runs last so it captures the fully computed tick.

- Events are same-tick, non-consuming: Events fire for the current tick, are visible to ALL systems in that tick's iteration, and are not removed after being read.

- Client must mirror two IDs: The local player has both a string ID (represents the human) and an entity ID (tied to simulation engine). 

- Replay overwrites, doesn't append: When replaying a tick that already has a snapshot, the new state replaces the old one. The history for a tick is always the most recent simulation result for that tick.


<!-- CODEGRAPH_START -->
## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question | Tool |
|---|---|
| "Where is X defined?" / "Find symbol named X" | `codegraph_search` |
| "What calls function Y?" | `codegraph_callers` |
| "What does Y call?" | `codegraph_callees` |
| "How does X reach/become Y? / trace the flow from X to Y" | `codegraph_trace` (one call = the whole path, incl. callback/React/JSX dynamic hops) |
| "What would break if I changed Z?" | `codegraph_impact` |
| "Show me Y's signature / source / docstring" | `codegraph_node` |
| "Give me focused context for a task/area" | `codegraph_context` |
| "See several related symbols' source at once" | `codegraph_explore` |
| "What files exist under path/" | `codegraph_files` |
| "Is the index healthy?" | `codegraph_status` |

### Rules of thumb

- **Answer directly — don't delegate exploration.** For "how does X work" / architecture questions, answer with 2-3 codegraph calls: `codegraph_context` first, then ONE `codegraph_explore` for the source of the symbols it surfaces. For a specific **flow** ("how does X reach Y") start with `codegraph_trace` from→to — one call returns the whole path with dynamic hops bridged — then ONE `codegraph_explore` for the bodies; don't rebuild the path with `codegraph_search` + `codegraph_callers`. Codegraph IS the pre-built index, so spawning a separate file-reading sub-task/agent — or running a grep + read loop — repeats work codegraph already did and costs more for the same answer.
- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want context — `codegraph_context` is one call.
- **Don't loop `codegraph_node` over many symbols** — one `codegraph_explore` call returns several symbols' source grouped in a single capped call, while each separate node/Read call re-reads the whole context and costs far more.
- **Index lag**: the file watcher debounces ~500ms behind writes; don't re-query immediately after editing a file in the same turn.

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: *"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"*
<!-- CODEGRAPH_END -->
