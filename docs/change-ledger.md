# Change ledger

The ledger records what the agent changed, why, and how to undo it.

```bash
deepcode ledger list                 # recent records
deepcode ledger show <id>            # one record in full
deepcode ledger export --out audit.md
deepcode ledger rollback <id>        # undo one recorded change
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
  "derivedFrom": ["schema.json"],
  "rollbackHint": { "kind": "snapshot", "ref": "7" },
}
```

`intent` is the request that drove the turn. `paths` are workspace-relative, so
records stay readable after the repo moves. `rollbackHint` points at the
snapshot or git checkpoint already taken for that specific call — and is
**absent when no checkpoint exists**, rather than guessing at one.

## Provenance — what a change came from

`derivedFrom` lists the files the turn **read** before making the change. It
answers the third question, after "what changed" and "how do I undo it": _what
was this derived from_ — which is what you ask when a generated file is wrong and
you need to know which input to fix, or when something turns up in a commit and
you need to know what the turn had open.

```bash
deepcode ledger show chg-lz4k2p-01
#   paths    : src/client.ts
#   from     : config/gen.yaml, schema.json
```

It is **observed, not declared**. These are the reads the turn actually
performed, so a tool that ignored its inputs shows nothing rather than a
plausible list. Consequences worth knowing:

- **Only `Read` counts.** `Grep` and `Glob` take a search _root_ and return many
  paths; calling the root an input would claim a derivation the turn did not
  make, and listing every hit would drown the real inputs in whatever the search
  swept up. Narrow and true beats wide and approximate.
- **A failed read is not an input.** It gave the turn nothing, and crediting it
  would send someone to fix a file that was never opened.
- **The file being written is excluded.** `Edit` reads its own target by
  construction, and including it would make every edit look self-derived.
- The field is **absent**, not empty, when there is nothing to say. A field that
  is always present is a field that stops being read.

Provenance is a derivation record, not a dependency graph: it says what this one
turn read, not what the file transitively depends on.

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

## Rolling back

`deepcode ledger rollback <id>` undoes one recorded change. It never applies
silently — every rollback goes through four steps:

1. **Explain** — where the change came from, how the states were compared, what
   will physically happen, and how to get back afterwards.
2. **Preview** — the file that will be restored or deleted.
3. **Confirm** — accept, reject, or defer. Anything other than an explicit yes
   is a no; a mistyped answer must not overwrite your files.
4. **Apply** — and record the rollback itself on the governance timeline. An
   audit trail with an unlogged undo is not an audit trail.

### Conflicts are surfaced, not silently resolved

Undoing an _old_ change is not the same operation as undoing the last one. The
plan warns before you decide when:

- later changes to the same file in that session would be discarded along with
  it (a `post-` capture of the same call doesn't count — otherwise every
  single-edit rollback would warn about itself);
- the file was modified outside DeepCode since the last snapshot;
- the record is a `Bash` checkpoint, which restores **every** tracked file that
  command touched.

### When it isn't possible

Snapshots and ledger records age out on different schedules, so a record can
outlive the checkpoint it points at. You get a reason — "snapshot 7 is no longer
available", "this record has no rollback point" — rather than a stack trace.
These are expected states of an audit log, not errors.

## It is not an authority

The ledger records decisions; it never influences one. Nothing in the permission
path reads it. (Selfware draws the same line: memory must not become protocol
authority.)
