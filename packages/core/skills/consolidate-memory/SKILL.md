---
name: consolidate-memory
description: Walk ~/.deepcode/memory/, merge duplicates, prune the index.
---

# consolidate-memory

DeepCode's `#` command appends snippets to the user's persistent memory.
Over time these accumulate duplicates and stale entries; this skill cleans
them up.

## When to invoke

- User says "consolidate my memory", "clean up notes", "dedupe memory".
- User notices the same hint surfacing twice in successive sessions.

## Process

1. **Read all files** under `~/.deepcode/memory/` (one MD per topic).
2. **Group by similarity** — entries on the same topic / same fact.
3. **Merge duplicates** — keep the most recent, clearest phrasing.
4. **Prune stale** — if an entry references a removed file/dir or an
   outdated CLI flag, suggest deletion (don't auto-delete).
5. **Update the index** — `~/.deepcode/memory/MEMORY.md` should still
   reference every remaining file. Drop dead links.

## Anti-patterns

- Don't auto-delete anything — always show the proposed delete list and
  wait for user approval.
- Don't merge entries that LOOK similar but encode different decisions
  (e.g. "use pnpm" + "use yarn" — they aren't duplicates, they're a
  conflict to flag).

## Output

A single proposed-changes block with each action: KEEP / MERGE → / DELETE / EDIT,
and a final summary `N files; M consolidated; K to delete`. Then ask the
user to approve before writing.
