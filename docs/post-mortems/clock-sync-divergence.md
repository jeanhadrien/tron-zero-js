# Clock Sync Divergence Bug

## Summary

The reciprocal formula `scale = 1 / (1 + GAIN * tickError)` used in client clock synchronization has a singularity at `tickError = -1/GAIN`. Beyond this point, the raw scale becomes negative, the clamp misinterprets it, and the correction direction **flips** — the client speeds up when it should slow down. This creates a positive feedback loop that causes the client-server tick gap to grow unboundedly until the simulation crashes.

## Mechanics

### Target

The client aims to run ahead of the server by ping ticks + 1 buffer tick:

```
targetClientTick = serverTick + pingTicks + 1
tickError = targetClientTick - actualClientTick
```

- `tickError > 0` → client is **behind** → reduce `tickTimeMs` → speed up
- `tickError < 0` → client is **ahead** → increase `tickTimeMs` → slow down

### The broken formula

```
rawScale = 1 / (1 + GAIN * tickError)
scale = clamp(rawScale, MIN_SCALE, MAX_SCALE)
tickTimeMs = referenceTickTimeMs * scale
```

With `GAIN = 0.5`, the singularity is at `tickError = -2`:

| tickError | rawScale | clamped | tickTimeMs | Actual effect | Intended effect |
|-----------|----------|---------|------------|---------------|-----------------|
| +5 (behind) | 0.286 | 0.75 | 12.5ms | speed up | speed up ✓ |
| +1 (behind) | 0.667 | 0.75 | 12.5ms | speed up | speed up ✓ |
| 0 (on target) | 1.0 | 1.0 | 16.67ms | neutral | neutral ✓ |
| -1 (ahead) | 2.0 | 1.25 | 20.83ms | slow down | slow down ✓ |
| **-2** (ahead) | **∞** | 1.25 | 20.83ms | slow down | slow down — edge |
| **-3** (ahead) | **-2** | **0.75** | **12.5ms** | **speed up** | slow down ✗ |

When `tickError < -1/GAIN`, the denominator goes negative and `rawScale < 0`. `Math.max(MIN_SCALE, ...)` floors it to MIN_SCALE — the same value used for being behind — because `Math.max` has no concept of sign.

### Divergence loop

1. Client overshoots target by 3+ ticks (replay jump, network jitter)
2. Formula produces `scale = MIN_SCALE` → client speeds up
3. Client pulls further ahead → tickError grows more negative
4. Formula stays at `MIN_SCALE` → client keeps accelerating
5. Gap grows monotonically: 4 → 5 → 15 → 20 → 49 → crash

With `GAIN = 0.1`, the singularity moves to `tickError = -10`, giving more headroom but not fixing the root cause — a large enough overshoot still triggers the flip.

## Fix

Replaced with a linear P-controller that preserves sign unconditionally:

```typescript
const correction = GAIN * tickError;  // signed: + behind, - ahead
const clamped = Math.max(-MAX_SLOWDOWN, Math.min(MAX_SPEEDUP, correction));
const scale = 1 - clamped;            // behind → scale<1 (faster) | ahead → scale>1 (slower)
this.room.gameClock.tickTimeMs = this.room.gameClock.referenceTickTimeMs * scale;
```

- `tickError > 0` → `correction > 0` → `scale < 1` → speed up
- `tickError < 0` → `correction < 0` → `scale > 1` → slow down
- No singularity, no sign flip, large errors saturate at the clamp boundary
- `GAIN = 0.1`, `MAX_SPEEDUP = 0.25`, `MAX_SLOWDOWN = 0.25`

## Root cause

The reciprocal form `1/(1+kx)` is a valid transfer function for proportional control (bounded, smooth near zero) but it is **only stable for `kx > -1`**. In a clock-sync system, where `tickError` can swing negative by tens of ticks, the formula operates outside its stable domain. A linear P-controller with hard saturation avoids this entirely.
