# Client OTEL CORS Block

## Summary

The browser blocks OTLP telemetry requests from the client (port 8081) to the SigNoz OTEL Collector (port 4318) because the collector does not return `Access-Control-Allow-Origin` headers on the CORS preflight. Same-port `localhost` origins are still cross-origin when the port differs — the browser treats `localhost:8081` → `localhost:4318` as a cross-origin fetch.

## Mechanics

### Request flow before the fix

```
Browser tab (origin: http://localhost:8081)
  → fetch('http://localhost:4318/v1/traces')
    → Browser: origin mismatch (different port)
      → Sends OPTIONS preflight with header: Origin: http://localhost:8081
        → OTEL Collector: responds without Access-Control-Allow-Origin
          → Browser: blocks the actual POST — error in console
```

The OTEL Collector's HTTP receiver runs on port 4318 (OTLP/HTTP protocol). By default, it ships with no CORS configuration, which means it rejects all cross-origin requests, including same-host different-port ones.

### Why the server didn't have this problem

The server runs in Node/Bun — no browser, no CORS enforcement. The `@opentelemetry/exporter-logs-otlp-proto` and `@opentelemetry/exporter-trace-otlp-proto` exporters make raw HTTP requests via the runtime, which are never subject to browser security policies.

## Fix

Enabled CORS on the SigNoz OTEL Collector's HTTP receiver by adding a `cors` section to the collector config:

```yaml
receivers:
  otlp:
    protocols:
      http:
        cors:
          allowed_origins:
            - http://localhost:8081
```

The collector now responds to the preflight with `Access-Control-Allow-Origin: http://localhost:8081`, the browser matches it with its own origin, and allows the real POST through.

No changes to the application code were needed — the client `telemetry.ts` continues to use absolute URLs (`http://localhost:4318/v1/traces`, `http://localhost:4318/v1/logs`).

## Alternative considered: Vite proxy

Proxying `/v1/` through Vite's dev server would sidestep CORS entirely (same-origin requests). Rejected because:

- It only works in dev (`vite dev`); production builds are static files with no proxy.
- Would require a matching proxy rule in the production web server (nginx/caddy/Express).
- The collector CORS approach fixes it at the source and works universally — dev, prod, any client.

## Root cause

The OTEL Collector's default configuration assumes server-side SDKs (no browser CORS concerns). When a browser-based SDK (`@opentelemetry/sdk-trace-web` + `OTLPLogExporter`) sends telemetry to the collector's OTLP HTTP endpoint, the browser enforces CORS, and the collector was not configured to respond to it.
