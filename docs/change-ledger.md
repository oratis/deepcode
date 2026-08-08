# Change ledger

The ledger records what the agent changed, why, and how to undo it.

```bash
deepcode ledger list                 # recent records
deepcode ledger show <id>            # one record in full
deepcode ledger export --out audit.md
```

## Why it exists separately from sessions

Sessions already store the message stream, and snapshots already capture file
state before and after each mutation. Neither answers the question people
actually ask after a run: **what did it change, and how do I undo that one
thing?** A message log means reading a conversation to find out; snapshots are
addressable but carry no intent.

The ledger is the index over both — it pairs each mutation with the request that
motivated it and the checkpoint that reverses it.

## Two timelines

| File               | Contents                                                      |
| ------------------ | ------------------------------------------------------------- |
| `changes.jsonl`    | Workspace mutations — `Write`, `Edit`, `NotebookEdit`, `Bash` |
| `governance.jsonl` | Contract edits, plugin installs, trust grants, rollbacks      |

Kept apart rather than as one file with a type column. Governance events are
rare and high-impact; interleaved with thousands of edits, nobody would ever see
them again.

## Where it is stored

```
~/.deepcode/projects/<project-key>/ledger/{changes,governance}.jsonl
```

**Not in your repository.** Appending to a tracked file on every edit would turn
`git status` into noise during exactly the activity you're reviewing. If you do
want it committed, `deepcode ledger export --out <path>` writes a Markdown
digest wherever you like.

## Record shape

```jsonc
{
  "id": "chg-lz4k2p-01",
  "timestamp": "2026-08-08T09:12:33.417Z",
  "actor": "agent",
  "threadId": "thread-lz4k1x-a3f9",
  "turnId": "turn-lz4k2m-77c1",
  "tool": "Edit",
  "intent": "fix the expired-token branch in auth.ts",
  "paths": ["src/auth.ts"],
  "summary": "edited src/auth.ts",
  "rollbackHint": { "kind": "snapshot", "ref": "7" },
}
```

`intent` is the request that drove the turn. `paths` are workspace-relative, so
records stay readable after the repo moves. `rollbackHint` points at the
snapshot or git checkpoint already taken for that specific call — and is
**absent when no checkpoint exists**, rather than guessing at one.

## What is not recorded

- **Reads.** A ledger answering "what changed" has nothing to say about a read,
  and the traffic would bury the mutations.
- **Failed or blocked calls.** A ledger of things that did not happen is worse
  than no ledger.
- **File contents.** Only paths and summaries, so the ledger never becomes a
  second copy of your secrets.

`Bash` **is** recorded, with no paths — a shell command's effects can't be
declared ahead of time, but "the agent ran this" is exactly what an audit needs.
The pre-Bash git checkpoint is what makes it reversible.

## Failure behaviour

Ledger writes never fail a tool call. If the disk is full or the path is
unwritable, the edit still succeeds and the record is dropped. An audit trail
that can cost you a completed edit is worse than one with a gap.

Corrupt lines are skipped on read. Unlike a session, nothing is reconstructed
from these records, so the readable ones stay useful on their own.

## Retention

Newest 5000 records per file, nothing older than 90 days; trimmed automatically
as records accumulate. A log that only grows is one somebody eventually deletes
wholesale — which loses the recent records too.

## It is not an authority

The ledger records decisions; it never influences one. Nothing in the permission
path reads it. (Selfware draws the same line: memory must not become protocol
authority.)
