// MCP client subsystem entry — stdio transport.
// Spec: docs/DEVELOPMENT_PLAN.md §3.3
// Milestone: M3c (stdio). http/sse/OAuth/headersHelper/Elicitation/serve → M3c-ext.

export {
  connectMcpServer,
  connectAllMcpServers,
  closeAllMcpServers,
  type McpClientHandle,
  type McpToolMeta,
  type ConnectAllResult,
} from './client.js';
