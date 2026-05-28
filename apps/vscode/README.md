# @deepcode/vscode — DeepCode VS Code extension (v1.1)

DeepSeek-powered coding agent inside VS Code. Same agent loop as the CLI
and Mac client — Claude-Code parity.

## Current state — v1.1 skeleton

- `package.json` — extension manifest with 3 commands, configuration,
  activity bar + chat view, default keybinding (`Cmd/Ctrl+Shift+D`).
- `src/extension.ts` — activate / deactivate + Chat webview + 3 command
  stubs. Uses lazy `require('vscode')` so the package type-checks without
  `@types/vscode` installed.

## Activate the extension toolchain

```bash
pnpm add -D --filter @deepcode/vscode @vscode/vsce @types/vscode
```

Then:

| Command                                       | Result                                              |
| --------------------------------------------- | --------------------------------------------------- |
| `pnpm --filter @deepcode/vscode build`        | Compile `src/extension.ts` → `dist/extension.cjs`    |
| `pnpm --filter @deepcode/vscode package`      | Produce a `.vsix` file (vsce)                        |
| Press F5 in VS Code with this folder open    | Launch Extension Development Host                    |

## Architecture

- The extension runs in the VS Code **extension host** (Node process).
- Talks directly to `@deepcode/core` — no IPC layer needed (the extension
  host IS a Node runtime).
- Long-running agent loops dispatch to a child process to avoid blocking
  the host (TODO in v1.1-rest).

## Commands

| ID                   | Default keybinding         | What it does                                |
| -------------------- | -------------------------- | ------------------------------------------- |
| `deepcode.openPanel` | `Cmd/Ctrl+Shift+D`         | Reveal the DeepCode chat view               |
| `deepcode.run`       | (palette)                  | Run agent on the selected text              |
| `deepcode.review`    | (palette)                  | Run `code-review` skill on current diff     |

## Settings

| Key                | Type     | Default                | Notes                                     |
| ------------------ | -------- | ---------------------- | ----------------------------------------- |
| `deepcode.apiKey`  | string   | `""`                   | Falls back to `~/.deepcode/credentials.json` |
| `deepcode.model`   | enum     | `"deepseek-chat"`      | Standard alias + concrete model names      |
| `deepcode.effort`  | enum     | `"medium"`             | low / medium / high / xhigh / max         |

## Roadmap

- Real `runAgent` invocation in `deepcode.run` (instead of the info popup)
- Real diff fetch via `vscode.git` API for `deepcode.review`
- File panel showing live edits as the agent works
- Inline tool-approval prompts via QuickPick
- Custom commands via skills (mirror CLI's `/skills` dir)
- LSP-style command palette integration (see `@deepcode/lsp`)
