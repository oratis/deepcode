// MCP client subsystem entry — stdio + Streamable HTTP + SSE transports, with
// static + headersHelper auth. (Full OAuth + Elicitation + `mcp serve` → later.)
// Spec: docs/DEVELOPMENT_PLAN.md §3.3

export {
  connectMcpServer,
  connectAllMcpServers,
  closeAllMcpServers,
  pickTransportKind,
  parseHelperOutput,
  type McpClientHandle,
  type McpToolMeta,
  type McpTransportKind,
  type ConnectAllResult,
} from './client.js';
