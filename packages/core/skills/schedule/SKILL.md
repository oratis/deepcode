---
name: schedule
description: Schedule a one-off or cron task via DeepCode's daemon.
---

# schedule

Schedule background work via the `launchd` LaunchAgent (macOS) or its
Linux equivalent. Two common shapes: one-shot (run at time T) or
recurring (cron expression).

## When to invoke

- User says "remind me at 5pm", "every day at 9am do X", "in 2 hours run Y".
- User wants automation that survives the current session.

## Storage

Tasks live in `~/.deepcode/scheduled-tasks.json`:

```json
[
  {
    "id": "task-abc",
    "type": "oneshot",
    "runAt": "2026-05-28T17:00:00Z",
    "command": "deepcode -p 'check the build status' -o json"
  },
  {
    "id": "task-def",
    "type": "cron",
    "schedule": "0 9 * * *",
    "command": "deepcode -p 'morning standup' -o text"
  }
]
```

The `launchd` LaunchAgent (`dev.deepcode.scheduler`) fires every minute,
reads this file, and dispatches due tasks.

## Process

1. **Parse user intent** — extract type (oneshot/cron) and schedule.
2. **Build the command** — usually `deepcode -p "<prompt>"` with the
   user's task description.
3. **Append to the JSON** — generate a fresh ID, write atomically.
4. **Confirm** — show the user when it'll run + what it'll do.

## Cron syntax

Standard 5-field cron: `min hour day-of-month month day-of-week`.
Examples:
- `0 9 * * 1-5` — 9am weekdays
- `*/15 * * * *` — every 15 min
- `0 0 1 * *` — first of the month

## Anti-patterns

- Don't schedule destructive tasks without `--mode dontAsk` AND a clear
  user confirmation in the same turn.
- Don't accept "every second" or sub-minute schedules — launchd's
  granularity is the StartInterval (default 60s).
