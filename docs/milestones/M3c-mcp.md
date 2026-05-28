# M3c · MCP Client (stdio)

> **Status**: ✅ stdio transport shipped + wired into REPL  
> **Branch**: `feat/m3c-mcp-client`

## Shipped

- `packages/core/src/mcp/client.ts` — `connectMcpServer(name, config)` + `connectAllMcpServers(servers)` + `closeAllMcpServers(handles)`.
- Uses official `@modelcontextprotocol/sdk@^1.29.0` for protocol details.
- Tools are exposed with **`mcp__<server>__<tool>` qualified name**, registered into the same `ToolRegistry` that powers the 6 P0 tools. The agent loop sees them identically.
- Tool results unwrap MCP's `content[].text` array into a single string for the `tool_result` block.
- Individual server failures are isolated — one bad config doesn't kill others.
- `/mcp` slash command lists connected servers + tool count + errors.
- CLI REPL now auto-connects MCP servers from `settings.mcpServers` on startup, honoring `enabledMcpjsonServers` / `disabledMcpjsonServers`.
- Graceful shutdown closes all connections.

## Tests (6 new)

`packages/core/src/mcp/client.test.ts` spawns tiny in-disk MCP server scripts that import the SDK via absolute path (so /tmp doesn't need node_modules):

1. lists tools and qualifies names
2. calls a remote tool, returns its text output
3. `connectAllMcpServers` continues on individual failures
4. respects `disabled` list
5. respects `enabledOnly` list  
6. rejects server config missing `command`

## NOT in this PR (M3c-ext, next)

- HTTP transport
- SSE transport
- OAuth (2.0 client credentials + dynamic flows)
- `headersHelper` (dynamic auth via shell)
- Elicitation hooks (server-requested user input)
- `deepcode mcp serve` (reverse-expose DeepCode as MCP server)
- `_meta["anthropic/maxResultSizeChars"]` per-tool output caps
- MCP resource references in composer (`@server:proto://path`)
- `mcp__server__prompt` slash commands

## Verified

- `pnpm typecheck` → green
- `pnpm test` → 264 passed / 0 failed / 7 skipped (was 258)
- CLI builds: `node apps/cli/dist/cli.js --help` still works
