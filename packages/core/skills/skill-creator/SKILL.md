---
name: skill-creator
description: Help author a new skill — frontmatter + body + best-trigger description.
---

# skill-creator

Bootstrap a new skill markdown file with the right shape. Most of the value
of a skill is in the `description` (it's what drives matching) — spend the
effort there.

## When to invoke

- User says "create a skill for X", "add a skill", "I want a skill that does Y".

## Where the file goes

| Source                                   | Loaded as                         |
| ---------------------------------------- | --------------------------------- |
| `packages/core/skills/<name>/SKILL.md`   | Built-in (ships with the package) |
| `~/.deepcode/skills/<name>/SKILL.md`     | User-global                       |
| `<cwd>/.deepcode/skills/<name>/SKILL.md` | Project-scoped                    |
| Plugin's `skills/<name>/SKILL.md`        | Plugin-contributed                |

For user-authored skills, default to user-global. Suggest project-scoped
only when the skill is specifically about THIS project.

## Frontmatter (required)

```yaml
---
name: kebab-case-name
description: One sentence. Mention the trigger condition + the output shape.
---
```

The `description` is what the matcher sees. Make it concrete:

- ✓ "Look up tests for a specific function name. Returns test file paths."
- ✗ "Help with tests."

## Body sections (recommended)

1. **When to invoke** — user phrasings that should trigger this.
2. **Process / steps** — numbered list.
3. **Heuristics / categories** — what to look for.
4. **Anti-patterns** — what NOT to do.
5. **Output shape** — what the agent's response should look like.

## Tips

- Keep it under 100 lines. Longer skills are harder to load + match.
- Use concrete examples, not generalities.
- Reference other skills by name when relevant (e.g. "see `verify` for
  the test-running checklist").
