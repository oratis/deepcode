---
name: loop
description: Run a command on a recurring interval (poll CI etc.).
---

# loop

Drive a polling loop where the agent re-checks state at an interval —
useful for "wait until CI is green", "poll deploy status", "tail a log".

## When to invoke

- User says "watch", "poll", "every N seconds check X", "wait until Y".
- Long-running observation with a clear termination condition.

## Pattern

Use `ScheduleWakeup` (or the loop primitive in the host) with a sensible
delay:

| Watching               | Delay     | Why                                |
| ---------------------- | --------- | ---------------------------------- |
| CI run                 | 60-270 s  | Status changes minute-scale        |
| Deploy queue           | 60-180 s  | Same                               |
| Local file change      | 5-30 s    | Use fs.watch instead when possible |
| Cron / external timer  | 20-30 min | Don't burn cache for nothing       |
| "Idle tick, no signal" | 20-30 min | Default; cap notification noise    |

## Cache-aware delays

Anthropic-style prompt caches expire after ~5 min. Pick either:

- **Under 5 min**: cache stays warm (60-270 s).
- **Long fallback**: 20+ min (one cache miss buys a long wait).

Avoid 5-15 min windows — they pay the miss without amortizing.

## Termination

ALWAYS have a clear stop condition. Loop should exit when:

- The watched condition is met.
- The user issues an interrupt / says stop.
- A timeout cap is exceeded (refuse to infinite-loop).

## Output per tick

Just enough to confirm progress: `[14:32] CI status: in_progress (8/12 jobs)`.
Don't dump full logs each tick.

## Anti-patterns

- Polling every second (burns API budget; rarely needed).
- Infinite loop without a max-iterations cap.
- Polling instead of using the harness's notification mechanism — if the
  runtime can wake you on the event, use that instead.
