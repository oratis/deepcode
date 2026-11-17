# DeepCode VS Code extension

DeepSeek-powered coding agent inside VS Code, backed by the same provider-neutral app-server
protocol and canonical threads as the desktop client.

## Current state

- Seven commands, an activity-bar chat view, model/effort settings, and a default
  `Cmd/Ctrl+Shift+D` keybinding.
- Canonical thread reuse, a multiline composer with Send/Stop controls, structured text/tool
  cards, approval via warning actions, and AskUserQuestion via QuickPick/InputBox.
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
| `deepcode.revertReviewAction`     | (palette)          | Conflict-safely revert the latest applied review action  |
| `deepcode.showDiagnostics`        | (palette)          | Show value-free config sources, trust gates, and issues  |

## Settings

| Key               | Type | Default           | Notes                                            |
| ----------------- | ---- | ----------------- | ------------------------------------------------ |
| `deepcode.model`  | enum | `"deepseek-chat"` | Explicit VS Code value overrides shared settings |
| `deepcode.effort` | enum | `"medium"`        | Explicit value overrides shared settings         |

Credentials stay in the shared DeepCode credential store and are resolved only by the child.
Manifest defaults are not sent as turn overrides; without a user/workspace value, the app-server's
trusted `settings.json` model and effort remain authoritative.

## Chat panel

The panel separates your messages, assistant responses, tool activity, and turn status. Expand a
tool card to inspect its input and result. Results longer than 24,000 characters retain their first
16,000 and last 8,000 characters, with the omitted middle explicitly marked. Tool output is
rendered as plain text; it cannot run scripts or load
remote content in the webview.

Press Enter to send, or Shift+Enter for a new line. Input-method composition does not send a
message. You can draft the next message while a turn runs; Send becomes available after the
backend reports a terminal state. The draft and current panel transcript survive hiding and
recreating the view within the same extension session. This is not a new session storage format
or a history browser, and reloading the extension does not restore the panel transcript.

Stop changes the status to **Cancelling**. An interrupt acknowledgement alone does not mark the
turn interrupted; the panel waits for the backend's terminal event. If Stop fails, the panel
explains that work may still be running and lets you retry Stop. A tool without a reported result
at turn end is labelled **Result unknown**, so an interrupted write is never shown as successful.
Review the workspace before retrying such a tool.

A confirmed backend disconnect changes the status to **Disconnected**, releases the panel's
waiting state, and marks unfinished tool results as unknown. This does not claim that the lost
turn completed or that every side effect stopped. A new Send reconnects and asks the backend to
resume the canonical thread; the previous request is never replayed automatically. Ordinary Stop
errors, including request timeouts, do not count as confirmed disconnects and keep Send blocked
while the turn may still be running. If the backend emits invalid protocol data, the extension
closes its owned connection before enabling reconnection. A failed cleanup is reported and blocks
opening a second connection. Tool cards use both the turn ID and call ID, so a provider reusing a
call ID in a later turn cannot overwrite an earlier result.

Approval and input requests appear in the timeline and status bar; respond in VS Code's native
notification or input picker. These controls still call the app-server's existing approval
policy. The panel never supplies credentials or grants permission itself.

Scrolling up keeps your reading position while new output arrives. Use **Jump to latest** to
resume following the stream. The interface follows VS Code's theme and focus colours and exposes
keyboard-operable tool disclosures and a screen-reader status region.

To check the actual webview HTML in a browser, use Node 22 and the existing desktop workspace's
Playwright dependency:

```bash
PLAYWRIGHT_CHANNEL=chrome node --experimental-strip-types apps/vscode/scripts/check-chat-ui.mjs
```

Omit `PLAYWRIGHT_CHANNEL` to use Playwright's installed Chromium. Screenshots go to
`/tmp/deepcode-ui-evidence` by default; set `UI_EVIDENCE_DIR` to change the location. The check uses
a mocked VS Code message bridge and no provider requests. It covers keyboard submission, Stop
states, tool disclosure, plain-text rendering of hostile HTML, and a narrow sidebar; it does not
replace an Extension Host integration test.

## Roadmap

- Inline review comments and editor-context actions
- File panel showing live edits as the agent works
- Inline webview approval cards (host-native warning actions work today)
- Custom commands via skills (mirror CLI's `/skills` dir)
- VS Code Extension Host integration tests in addition to the protocol-runtime unit gate
