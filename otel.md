# OpenTelemetry Instrumentation Plan — Tron Zero

## Transport Decision

Both server and browser use **HTTP/protobuf** to `localhost:4318`.
The collector must have the HTTP receiver configured:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
```

gRPC (`:4317`) was dropped in favor of HTTP/protobuf because:
- Browsers cannot use gRPC (no `HTTP/2` client support)
- Bun is not an officially supported OTEL runtime — `@grpc/grpc-js` has known compatibility gaps with Bun's `http2` implementation
- A single transport protocol for both sides is simpler to maintain

---

## Packages to Install

```
@opentelemetry/api
@opentelemetry/api-logs
@opentelemetry/sdk-logs
@opentelemetry/sdk-trace-base
@opentelemetry/sdk-trace-web
@opentelemetry/exporter-trace-otlp-proto
@opentelemetry/exporter-logs-otlp-proto
@opentelemetry/context-zone
@opentelemetry/resources
@opentelemetry/semantic-conventions
```

Install command:
```sh
bun add @opentelemetry/api @opentelemetry/api-logs @opentelemetry/sdk-logs @opentelemetry/sdk-trace-base @opentelemetry/sdk-trace-web @opentelemetry/exporter-trace-otlp-proto @opentelemetry/exporter-logs-otlp-proto @opentelemetry/context-zone @opentelemetry/resources @opentelemetry/semantic-conventions
```

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/shared/otel/Logger.ts` | OTEL-aware Logger replacement |
| `src/server/telemetry.ts` | Server bootstrap: `TracerProvider` + `LoggerProvider` + OTLP exporters |
| `src/client/telemetry.ts` | Client bootstrap: `WebTracerProvider` + `LoggerProvider` + OTLP exporters |

### Modified Files

| File | Change |
|------|--------|
| `src/shared/Logger.ts` | Redirect `Logger` to re-export from `otel/Logger.ts` |
| `src/server/main.ts` | Import `./telemetry.ts` before any game code |
| `src/server/game/GameServer.ts` | Add `game.tick` span |
| `src/server/network/NetworkServer.ts` | Add `player.connect`, `player.disconnect`, `player.turn.process`, `state.sync` spans |
| `src/client/game/main.ts` | Import `../telemetry.ts`, add `game.init` span |
| `src/client/game/network/NetworkClient.ts` | Add `init_state`, `sync_state`, `player.turn.receive`, `player.turn.send` spans |
| `src/client/game/scenes/GameScene.ts` | Add `game.scene.create` span |
| `package.json` | Add OTEL dependencies |

---

## Logger Design

The current `Logger` class (`src/shared/Logger.ts`) is replaced with an OTEL-aware implementation that:
- Emits structured log records via `@opentelemetry/api-logs`
- Still writes to `console` (for local dev visibility)
- Preserves the same API: `new Logger(tag)`, `.debug()`, `.info()`, `.log()`, `.warn()`, `.error()`
- Respects `LogLevel`/`setLevel()` for console output only (OTEL emission always happens)

```ts
// Usage — identical to current API
const logger = new Logger('NET', { 'player.id': playerId });
logger.info('Player connected');
logger.warn('Desync detected', { 'drift_ticks': drift });
logger.error('Connection failed', error);
```

Each log call generates an OTEL `LogRecord` with:
- `severityNumber`: mapped from `LogLevel`
- `body`: first string argument (or `""` if args are objects)
- `attributes`: merged `{ tag, ...constructorAttributes, ...callAttributes }`

---

## Spans — What Gets Traced

### Server

| Span Name | File | Trigger | Attributes |
|-----------|------|---------|------------|
| `game.tick` | `GameServer.ts` | Each game loop iteration | `tick`, `player_count`, `bot_count`, `duration_ms` |
| `player.connect` | `NetworkServer.ts` | WebRTC `onConnection` | `player.id` |
| `player.disconnect` | `NetworkServer.ts` | WebRTC `onDisconnect` | `player.id` |
| `player.turn.process` | `NetworkServer.ts` | `reconcileTurns()` | `player.id`, `tick`, `turn_count` |
| `state.sync` | `NetworkServer.ts` | `sync_state` broadcast | `player.id`, `tick`, `player_count` |
| `game.start` | `main.ts` | Server startup | `port` |

### Client

| Span Name | File | Trigger | Attributes |
|-----------|------|---------|------------|
| `game.init` | `main.ts` | Phaser game creation | |
| `webrtc.connect` | `NetworkClient.ts` | `geckos()` call | `hostname` |
| `init_state` | `NetworkClient.ts` | Initial state received + loaded | `tick`, `player_count` |
| `sync_state` | `NetworkClient.ts` | Sync received + desync resolution | `tick`, `drift_ticks` |
| `player.turn.receive` | `NetworkClient.ts` | Remote player turn received | `player.id`, `tick` |
| `player.turn.send` | `NetworkClient.ts` | Turn sent to server | `tick`, `buffer_size` |
| `game.scene.create` | `GameScene.ts` | Phaser scene `create()` | |

---

## Execution Order

1. Install OTEL packages: `bun add ...`
2. Create `src/shared/otel/Logger.ts` — OTEL-aware Logger
3. Update `src/shared/Logger.ts` — re-export from `otel/Logger.ts`
4. Create `src/server/telemetry.ts` — server bootstrap
5. Create `src/client/telemetry.ts` — client bootstrap
6. Modify `src/server/main.ts` — import telemetry first
7. Modify `src/server/game/GameServer.ts` — add `game.tick` span
8. Modify `src/server/network/NetworkServer.ts` — add event spans
9. Modify `src/client/game/main.ts` — import telemetry, add `game.init` span
10. Modify `src/client/game/network/NetworkClient.ts` — add event spans
11. Modify `src/client/game/scenes/GameScene.ts` — add `game.scene.create` span

---

## Testing

After implementation, verify with your collector:

```sh
# Start collector (if not running)
# Start the game
bun run dev

# Check collector logs for received spans/logs
# Or tail the OTLP HTTP endpoint:
curl -s http://localhost:4318/v1/traces | jq
```

Verify spans appear with these tags:
- `tron-zero-server` (service name for server spans)
- `tron-zero-client` (service name for client spans)
- Logs with `tron-zero` logger name

---

## Production Considerations (Future)

- Add `OTEL_ENABLED` env var to skip initialization and use no-op providers
- Add `OTEL_SERVICE_NAME` env var for custom service naming
- Add metrics (`player_count` gauge, `rtt_ms` histogram, `tick_rate` counter) when ready
- Consider sampling rate for game tick spans (60/sec may be too much at scale)
