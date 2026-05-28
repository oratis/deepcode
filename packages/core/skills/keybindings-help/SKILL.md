---
name: keybindings-help
description: Help edit ~/.deepcode/keybindings.json.
---

# keybindings-help

Add or modify entries in `~/.deepcode/keybindings.json`. Explain the
syntax + show what will change.

## When to invoke

- User says "bind X to Y", "add a shortcut", "enable Vim mode".
- User runs `/keybindings` and asks for a tweak.

## File schema

```json
{
  "enabled": true,
  "vim": false,
  "bindings": [
    { "key": "ctrl+shift+t", "action": "/clear" },
    { "key": "esc esc", "action": "/rewind" },
    { "key": "g g", "action": "cursor-buffer-start", "when": "NORMAL" }
  ]
}
```

## Key chord syntax

- Modifiers: `ctrl`, `shift`, `alt`, `meta`.
- Separator: `+` for chord (`ctrl+a`), space for sequence (`g g`).
- The order of modifiers is normalized, so `Shift+Ctrl+A` ≡ `ctrl+shift+a`.

## Action forms

1. **Slash command** — `"/clear"`, `"/mode plan"`, etc.
2. **Literal insertion** — `"insert:hello"` inserts "hello" at cursor.
3. **Built-in action** — `cursor-line-start`, `kill-to-end`, `vim-insert-mode`, etc.

See `DEFAULT_KEYBINDINGS` in `packages/core/src/keybindings/index.ts`
for the full list.

## Vim mode

When `vim: true`, the `when` field constrains a binding to `NORMAL` /
`INSERT` / `VISUAL`. Vim defaults (i, a, v, gg, dd, yy, p, u) ship by
default; user bindings layer on top.

## Process

1. Read current file (or note it doesn't exist).
2. Validate the user's chord (must match `chord-syntax`).
3. Check for collisions with existing bindings — warn the user.
4. Show the diff, ask y/n/e.
5. Write back.
