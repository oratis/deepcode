---
name: code-review
description: Review the current diff for correctness bugs. Cite file:line.
---

# code-review

Read the diff, find correctness problems, and explain each with a precise
`file:line` reference. Style/formatting is out of scope unless the user
explicitly asks — Prettier and the team's own conventions own that.

## When to invoke

- User says "review this", "look this over", "second opinion".
- Right after the user has made a non-trivial change and asks for feedback
  before pushing.
- As part of `/security-review` (see that skill for the security-specific
  checklist).

## Process

1. **Read the diff** — use `Bash` to run `git diff` (or
   `git diff origin/main...HEAD` if the user is on a feature branch).
2. **Read the touched files in full** — diff context is too narrow to
   judge a function. Pull the whole file via `Read`.
3. **Read tests** — confirm new behavior is covered; flag missing tests.
4. **Categorize findings**:
   - **Bug** — code would observably misbehave.
   - **Latent bug** — works today but is fragile / racy / order-dependent.
   - **Suggestion** — cleaner alternative; not a defect.
5. **Cite precisely** — every finding gets `path/to/file.ts:42` so the
   user can jump to it.

## Heuristics for finding bugs

- **Off-by-one**: `i < arr.length` vs `<=`; `slice(start, end)` boundaries.
- **Null-safety**: optional chaining missed (`a.b.c` when `b` can be null).
- **Async**: missed `await`, fire-and-forget promise without `.catch()`.
- **Error handling**: catch blocks that swallow then continue with bad state.
- **State**: mutation that escapes the function via a shared reference.
- **Concurrency**: writes to the same file/key/row without locking.
- **Cleanup**: `try`/`finally` missing for `unlink`, `kill`, `close`.
- **Security**: shell injection, path traversal, secrets in logs.

## What NOT to do

- Don't paraphrase the diff back at the user — they wrote it.
- Don't restate findings in 4 different ways. One bullet, one cite, one fix.
- Don't ask "did you mean X?" — say "this is wrong because X; change to Y".

## Output shape

```
N findings:

  · BUG  src/foo.ts:42  — <description>. <suggested fix>.
  · LATENT  src/bar.ts:88  — <description>. Suggest <fix>.
  · TEST GAP  src/baz.ts:120  — <name> is uncovered. Add a test for the <case> path.

Overall: <one-sentence verdict>.
```
