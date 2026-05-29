---
name: update-config
description: Modify settings.json / hooks / permissions safely + explain trade-offs.
---

# update-config

Edit DeepCode's `settings.json` files safely. Always show a diff first.

## When to invoke

- User says "change settings", "add a hook", "set the model to X", "lower
  the effort tier".
- User asks for a setting they describe but can't name (e.g. "make it
  more cautious" → bump permissions to ask-on-write).

## The three layers

| Layer   | Path                                                | Precedence (highest = last applied) |
| ------- | --------------------------------------------------- | ----------------------------------- |
| User    | `~/.deepcode/settings.json`                         | lowest                              |
| Project | `<cwd>/.deepcode/settings.json`                     | middle                              |
| Local   | `<cwd>/.deepcode/settings.local.json` (git-ignored) | highest                             |

When the user says "for this project", write to project-scoped. When
they say "everywhere", user-scoped. When secret-y (API keys, work-only
overrides), local.

## Process

1. **Read** the existing file (or note that it doesn't exist).
2. **Compute the merged diff** the user will see after the change.
3. **Explain trade-offs** — what they're trading off by enabling/disabling.
   E.g. `bypassPermissions` mode: "faster, but the agent can write
   anywhere without asking — only do this in a sandbox/worktree."
4. **Show a clear diff** and ask `[y]es / [n]o / [e]dit`.
5. **Write** with `JSON.stringify(obj, null, 2)` (matches existing style).

## Common requests

| User asks                          | Setting                                  |
| ---------------------------------- | ---------------------------------------- | ------------------------ |
| "Don't ask me about reads"         | `permissions.allow: ["Read"]`            |
| "Stop running tests for me"        | `permissions.deny: ["Bash(npm test:*)"]` |
| "Use deepseek-reasoner by default" | `model: "deepseek-reasoner"`             |
| "Lower the effort"                 | `effortLevel: "low"`                     |
| "Turn off the sandbox"             | `sandbox.enabled: false`                 |
| "Disable plugin X"                 | `disabledPlugins: ["X"]`                 |
| "Add a hook to lint after edits"   | `hooks.PostToolUse: [{ matcher: "Edit    | Write", hooks: [...] }]` |

## Refuse

Don't:

- Delete `permissions.deny` rules without explicit confirmation.
- Write `apiKeyHelper` that points at a script you didn't author.
- Enable `bypassPermissions` as a default — it has to be a deliberate user act.
