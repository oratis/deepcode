# Migrating from Claude Code

DeepCode targets Claude Code parity. If you already use Claude Code,
most of your workflow ports over with renames + a different API key.

## TL;DR — the 5-minute switch

```bash
# 1. Install DeepCode CLI
npm install -g deepcode-cli

# 2. Set your DeepSeek key
mkdir -p ~/.deepcode
cat > ~/.deepcode/credentials.json <<EOF
{ "apiKey": "sk-..." }
EOF
chmod 600 ~/.deepcode/credentials.json

# 3. Convert your existing CLAUDE.md → AGENTS.md
mv ~/CLAUDE.md ~/AGENTS.md  # global one
# Project-scoped:
mv <project>/CLAUDE.md <project>/AGENTS.md  # if you have one

# 4. Convert ~/.claude/ → ~/.deepcode/
mv ~/.claude/settings.json ~/.deepcode/settings.json
mv ~/.claude/skills ~/.deepcode/skills
mv ~/.claude/agents ~/.deepcode/agents
mv ~/.claude/plugins ~/.deepcode/plugins
mv ~/.claude/keybindings.json ~/.deepcode/keybindings.json

# 5. Run
deepcode
```

## Field-by-field mapping

| Claude Code                        | DeepCode                                | Notes                                                         |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| `~/.claude/credentials.json`       | `~/.deepcode/credentials.json`          | Same shape; just rename.                                      |
| `~/.claude/settings.json`          | `~/.deepcode/settings.json`             | Schema mostly identical; see Settings table below.            |
| `<proj>/.claude/settings.json`     | `<proj>/.deepcode/settings.json`        | Same.                                                         |
| `~/.claude/skills/<name>/SKILL.md` | `~/.deepcode/skills/<name>/SKILL.md`    | Same frontmatter format.                                      |
| `~/.claude/agents/*.md`            | `~/.deepcode/agents/*.md`               | Same shape.                                                   |
| `~/.claude/plugins/`               | `~/.deepcode/plugins/`                  | Plugin manifest is identical (plugin.json).                   |
| `CLAUDE.md` (project root)         | `AGENTS.md` (project root)              | Or `DEEPCODE.md`. Both names recognized; AGENTS.md preferred. |
| `claude` CLI                       | `deepcode` CLI                          | Most flags identical (-p, --mode, --model, --effort).         |
| `claude doctor`                    | `deepcode doctor`                       | Same.                                                         |
| `/login`                           | n/a — re-onboard via `deepcode` no-args | We don't have separate login state.                           |

## Settings.json — model field

Claude Code:

```json
{ "model": "claude-sonnet-4-5" }
```

DeepCode:

```json
{ "model": "deepseek-chat" }
```

Valid values: `deepseek-chat` (general/tool-use) · `deepseek-reasoner`
(multi-step reasoning) · `deepseek-v4-flash` · `deepseek-v4-pro`.

## Slash commands

Most commands are identical:

| Command          | Claude Code | DeepCode                    |
| ---------------- | ----------- | --------------------------- |
| `/help`, `/?`    | ✓           | ✓                           |
| `/clear`         | ✓           | ✓                           |
| `/exit`, `/quit` | ✓           | ✓                           |
| `/model`         | ✓           | ✓ (constrained to DeepSeek) |
| `/mode`          | ✓           | ✓                           |
| `/effort`        | ✓           | ✓                           |
| `/cost`          | ✓           | ✓                           |
| `/context`       | ✓           | ✓                           |
| `/init`          | ✓           | ✓                           |
| `/mcp`           | ✓           | ✓                           |
| `/todos`         | ✓           | ✓                           |
| `/plugins`       | ✓           | ✓                           |
| `/keybindings`   | ✓           | ✓                           |
| `/vim`           | ✓           | ✓                           |

See `docs/BEHAVIOR_PARITY.md` for the full comparison.

## Hooks

Identical schema. Copy your `hooks` block from Claude's settings.json
verbatim. DeepCode supports the same 10 event types (PreToolUse,
PostToolUse, Stop, SubagentStop, PreCompact, PostCompact, SessionStart,
SessionEnd, UserPromptSubmit, Notification) and the same 5 handler
types (command, http, mcp_tool, prompt, agent).

## Permission rules

Identical syntax: `Tool(spec)`. The 4 sub-syntaxes (bare, subcommand,
prefix, domain) work the same way:

```jsonc
{
  "permissions": {
    "deny": ["Bash(rm -rf /:*)", "WebFetch(domain:internal.corp)"],
    "ask": ["Bash(npm install:*)"],
    "allow": ["Read", "Bash(git diff:*)"],
  },
}
```

## Sandbox

Claude Code's sandbox subsystem maps directly. `sandbox.filesystem`,
`sandbox.network`, `sandbox.excludedCommands` all work identically.
**Difference**: DeepCode's M3.5-ext adds shell-pipeline analysis — a
pipeline like `git status && rm -rf /` will NOT bypass `excludedCommands`
even if `git` is excluded. (Claude Code allows the bypass.) See
`docs/security-model.md`.

## Plugins

Plugin manifest schema is identical. Plugins authored for Claude Code
should load in DeepCode unmodified. The trust ladder + hash pin work
the same way. **Difference**: DeepCode's M5.2 ships marketplace +
ed25519 signature verification; if you want that, sign your plugins.

## MCP servers

Identical. Copy your `mcpServers` block verbatim. DeepCode uses
`@modelcontextprotocol/sdk` so all standard stdio/http/sse MCP servers
work as-is.

## Sub-agents

`~/.deepcode/agents/<name>.md` — same frontmatter shape as Claude Code's
sub-agents. Both reference systems work.

## Behaviors that DIFFER

1. **Models**: only DeepSeek models. The `/model` picker constrains to
   `deepseek-*`. To use Claude/GPT, keep Claude Code (or use the LSP
   bridge once IDE-provider-routing lands — TBD).
2. **Pricing**: DeepSeek is 10-20× cheaper than Claude for similar
   token counts. `/cost` reflects DeepSeek pricing.
3. **No image input yet**: vision provider abstraction exists but no
   provider configured (v1.1).
4. **`/rewind`**: skeleton only — full rewind UX is in M7 (Mac client).

## Behaviors that are NEW in DeepCode

- `auto` classifier mode (LLM-judged per-tool-call approval)
- Effort-bench (`packages/core/scripts/effort-bench.ts`) for measuring
  cost/latency per tier
- Pipeline-aware sandbox bypass (vs Claude Code's leading-token-only)
- LSP bridge (Neovim / Emacs / Sublime via `deepcode-lsp`)
- VS Code extension (skeleton; ships in v1.1)

## Getting help

- `deepcode doctor` — diagnostic dump
- `deepcode --help` — flag reference
- `~/.deepcode/sessions/<id>.jsonl` — transcript of every session
- File issues at https://github.com/oratis/deepcode/issues
