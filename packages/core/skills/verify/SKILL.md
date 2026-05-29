---
name: verify
description: Run the app + tests + confirm the change actually works (not just unit-tests-green).
---

# verify

Don't declare a task complete just because unit tests pass. Actually run the
code path the user asked about and confirm the observable behavior.

## When to invoke

- After making code changes that affect a runtime path.
- Before announcing "done" / opening a PR / asking the user to test.
- When tests are absent or thin, but the change is non-trivial.

## What "verify" means concretely

| Change type               | Verify by                                                              |
| ------------------------- | ---------------------------------------------------------------------- |
| New CLI flag / subcommand | Run the binary with the flag; confirm exit code + stdout.              |
| Bug fix in a function     | Add (or run) a test that reproduces the bug + passes after the fix.    |
| Refactor of internal API  | Run the full test suite + grep for remaining old-name callers.         |
| Schema migration          | Apply forward + backward on a fresh DB; confirm `\d` matches.          |
| HTTP endpoint added       | `curl localhost:<port>/<path>` and inspect the response.               |
| Background task / cron    | Trigger the entry point manually; check the log file or queue.         |
| UI change                 | Take a screenshot via `mcp__computer-use__screenshot` OR ask the user. |

## Anti-patterns

- "Tests pass, so it's done." — only when the test actually covers the
  user's reported behavior.
- "It compiled." — type-check is necessary, not sufficient.
- "It works on my machine." — note the assumption; flag for the user to
  verify on theirs.

## What to report back

A concise paragraph naming **what you ran**, **what you observed**, and
whether the observation matches the user's intent. If you can't fully
verify (e.g. requires production data), say so explicitly and propose
the minimum the user has to do.
