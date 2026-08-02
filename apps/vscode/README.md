# DeepCode VS Code extension

DeepSeek-powered coding agent inside VS Code, backed by the same provider-neutral app-server
protocol and canonical threads as the desktop client.

## Current state

- Six commands, an activity-bar chat view, model/effort settings, and a default
  `Cmd/Ctrl+Shift+D` keybinding.
- Canonical thread reuse, structured text/tool events, real interrupt plumbing, approval via
  warning actions, and AskUserQuestion via QuickPick/InputBox.
- A real extension bundle plus a dedicated app-server child bundle; the extension host never reads
  credentials or constructs a provider/runtime.

## Activate the extension toolchain

```bash
pnpm add -D --filter deepcode @vscode/vsce
```

Then:

| Command                                   | Result                                           |
| ----------------------------------------- | ------------------------------------------------ |
| `pnpm --filter deepcode build`            | Bundle extension + app-server child into `dist/` |
| `pnpm --filter deepcode package`          | Produce a `.vsix` file (vsce)                    |
| Press F5 in VS Code with this folder open | Launch Extension Development Host                |

## Architecture

- The extension runs in the VS Code **extension host** (Node process).
- A single owned app-server child contains credentials, provider, RuntimeHost, tools, permissions,
  and canonical session storage.
- The extension uses the shared `ProtocolClient`; model deltas, tool lifecycle, usage, approval,
  questions, and terminal state use the same ids/schema as desktop and LSP.
- Closing the extension closes child stdin, allowing active turns to interrupt and persist before
  the process exits.

## Commands

| ID                                | Default keybinding | What it does                                             |
| --------------------------------- | ------------------ | -------------------------------------------------------- |
| `deepcode.openPanel`              | `Cmd/Ctrl+Shift+D` | Reveal the DeepCode chat view                            |
| `deepcode.run`                    | (palette)          | Run agent on the selected text                           |
| `deepcode.review`                 | (palette)          | Run `code-review` skill on current diff                  |
| `deepcode.applyReviewFinding`     | (API/context)      | Apply one canonical finding through a normal agent turn  |
| `deepcode.applyAllReviewFindings` | (palette)          | Apply the latest review batch through one canonical turn |
| `deepcode.showDiagnostics`        | (palette)          | Show value-free config sources, trust gates, and issues  |

## Settings

| Key               | Type | Default           | Notes                                            |
| ----------------- | ---- | ----------------- | ------------------------------------------------ |
| `deepcode.model`  | enum | `"deepseek-chat"` | Explicit VS Code value overrides shared settings |
| `deepcode.effort` | enum | `"medium"`        | Explicit value overrides shared settings         |

Credentials stay in the shared DeepCode credential store and are resolved only by the child.
Manifest defaults are not sent as turn overrides; without a user/workspace value, the app-server's
trusted `settings.json` model and effort remain authoritative.

## Roadmap

- Inline review comments, context actions, and per-finding revert controls
- File panel showing live edits as the agent works
- Inline webview approval cards (host-native warning actions work today)
- Custom commands via skills (mirror CLI's `/skills` dir)
- VS Code Extension Host integration tests in addition to the protocol-runtime unit gate
