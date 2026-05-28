---
name: fewer-permission-prompts
description: Scan transcripts, propose .deepcode/settings.json allow rules.
---

# fewer-permission-prompts

The user keeps hitting the same approval prompt? Auto-generate a focused
`allow` rule from recent transcripts so they stop being asked.

## When to invoke

- User says "stop asking", "auto-approve npm test", "I keep clicking yes".
- User explicitly runs `/fewer-permission-prompts`.

## Process

1. **Scan recent sessions** — `~/.deepcode/sessions/*.jsonl`, last 7 days.
2. **Collect approved tool calls** — every PreToolUse where the user said
   yes. Bin by tool + leading arg (e.g. `Bash(npm test:*)`).
3. **Find recurring bins** — anything approved 3+ times.
4. **Propose rules** matching the existing permission rule syntax:
   - `Bash(npm test:*)` for a subcommand pattern
   - `Bash(npm test *)` for a prefix pattern
   - `Read(<cwd>/**)` for a path glob
5. **Show the user** the proposed additions to `.deepcode/settings.json`
   (project-scoped). Wait for approval before writing.

## Safety

- Never propose `Bash(*)` or `Bash(rm:*)` — those are too broad.
- Never propose rules from `bypassPermissions` mode (the user wasn't
  actually being asked).
- Default to PROJECT-scoped settings (`.deepcode/settings.json`) not user-
  global (`~/.deepcode/settings.json`). Users can override.

## Output

A diff-like preview:

```
.deepcode/settings.json (proposed):

  permissions.allow:
    + "Bash(npm test:*)"      seen 14 times, last 2 days ago
    + "Bash(git diff:*)"      seen 9 times
    + "Read(./src/**)"        seen 47 times

Apply? [y]es / [n]o / [e]dit
```
