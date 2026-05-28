# @deepcode/lsp — LSP bridge (v1.1)

Exposes DeepCode's agent loop as Language-Server-Protocol commands, so
any LSP-capable editor (Neovim, Emacs lsp-mode, Sublime, JetBrains via
LSP plugin) can drive DeepCode via `workspace/executeCommand`.

## Custom commands

| Command                | Args                     | Returns                                |
| ---------------------- | ------------------------ | -------------------------------------- |
| `deepcode.runAgent`    | `{ prompt: string }`     | `{ turnId: string }` + streams events  |
| `deepcode.abort`       | `{ turnId: string }`     | `{ aborted: boolean }`                 |
| `deepcode.listSkills`  | none                     | `{ skills: SkillRow[] }`               |

Streamed events are sent as `deepcode/agentEvent` notifications:

```json
{ "jsonrpc": "2.0", "method": "deepcode/agentEvent",
  "params": { "turnId": "lsp-...", "kind": "text_delta", "text": "..." } }
```

The `kind` field mirrors the AgentStreamEvent union from
`@deepcode/core/src/ipc/protocol.ts` (started / text_delta / tool_use /
tool_result / usage / turn_complete / turn_done / error).

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
- Agent loop runs in-process; long turns spawn a child to keep the LSP
  loop responsive (TODO in v1.1-rest).

## Skeleton vs ready-to-ship

This release ships the protocol skeleton (3 commands, 4 LSP boilerplate
handlers, stream events). The actual `runAgent` invocation emits a
placeholder event to confirm the channel — wiring to the real
`@deepcode/core` agent loop lands with the v1.1 release.
