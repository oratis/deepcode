# @deepcode/lsp — LSP bridge (v1.1)

Exposes DeepCode's app-server protocol as Language-Server-Protocol commands, so
any LSP-capable editor (Neovim, Emacs lsp-mode, Sublime, JetBrains via
LSP plugin) can drive DeepCode via `workspace/executeCommand`.

## Custom commands

| Command                     | Args                                            | Returns                   |
| --------------------------- | ----------------------------------------------- | ------------------------- |
| `deepcode.runAgent`         | `{ prompt, threadId?, model?, effort?, mode? }` | `{ threadId, turnId }`    |
| `deepcode.abort`            | `{ turnId }`                                    | `{ aborted }`             |
| `deepcode.readThread`       | `{ threadId }`                                  | protocol thread snapshot  |
| `deepcode.resumeThread`     | `{ threadId }`                                  | resumed protocol snapshot |
| `deepcode.respondApproval`  | `{ turnId, requestId, decision }`               | `{ accepted }`            |
| `deepcode.respondUserInput` | `{ turnId, requestId, answer }`                 | `{ accepted }`            |
| `deepcode.listSkills`       | none                                            | `{ skills: SkillRow[] }`  |

Lifecycle, structured tool, usage, approval, and user-input events are sent unchanged as
`deepcode/protocolEvent` notifications:

```json
{
  "jsonrpc": "2.0",
  "method": "deepcode/protocolEvent",
  "params": {
    "type": "item.delta",
    "threadId": "thread-...",
    "turnId": "turn-...",
    "itemId": "item-...",
    "delta": "hello"
  }
}
```

The schema is the same provider-neutral `@deepcode/protocol` contract used by desktop and the
app-server. A `turn.completed`, `turn.interrupted`, or `turn.failed` event is the terminal signal.

## Install & run

```bash
pnpm install
pnpm --filter @deepcode/lsp build
# After publish:
npx deepcode-lsp
# Or run from source:
node apps/lsp/dist/server.js
```

## Editor configuration

### Neovim (with nvim-lspconfig)

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.deepcode then
  configs.deepcode = {
    default_config = {
      cmd = { 'deepcode-lsp' },
      filetypes = { '*' },
      root_dir = lspconfig.util.find_git_ancestor,
      single_file_support = true,
    },
  }
end
lspconfig.deepcode.setup({})

-- Bind a key to run the agent on the visual selection:
vim.api.nvim_create_user_command('DeepCodeRun', function(opts)
  vim.lsp.buf.execute_command({
    command = 'deepcode.runAgent',
    arguments = { { prompt = opts.args } },
  })
end, { nargs = 1 })
```

### Emacs (lsp-mode)

```elisp
(with-eval-after-load 'lsp-mode
  (lsp-register-client
   (make-lsp-client
    :new-connection (lsp-stdio-connection "deepcode-lsp")
    :activation-fn (lambda (&rest _) t)
    :server-id 'deepcode-lsp)))
```

### Sublime Text (LSP package)

In `Preferences → Package Settings → LSP → Settings`:

```json
{
  "clients": {
    "deepcode": {
      "enabled": true,
      "command": ["deepcode-lsp"],
      "selector": "source"
    }
  }
}
```

## Architecture

- Pure stdio LSP server. Framing: `Content-Length: N\r\n\r\n<body>`.
- Notifications (no `id`) silently dropped if unknown.
- Requests (with `id`) errored with `-32603` if unknown method.
- One app-server child owns runtime, credentials, tools, canonical sessions, and active turns.
- LSP uses the shared protocol client for initialize, correlation, disconnects, and event fan-out;
  it never constructs a provider or reads credential secrets.
- Events that beat the `turn/start` response are buffered by turn id, so fast turns remain ordered.

## Current scope

The bridge covers thread start/read/resume, turn start/interrupt, structured events, approvals, and
AskUserQuestion. Multi-client attachment and shared-daemon authentication remain intentionally out
of scope for protocol v1.
