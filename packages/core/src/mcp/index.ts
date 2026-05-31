// MCP subsystem entry — client (stdio + Streamable HTTP + SSE transports, with
// static + headersHelper auth) + server (`mcp serve` exposes our tools over
// stdio). (Full OAuth + Elicitation → later.)
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

export {
  buildMcpServer,
  serveMcpOverStdio,
  mcpServableTools,
  MCP_SERVE_EXCLUDE,
  type BuildMcpServerOpts,
  type ServeMcpStdioOpts,
} from './serve.js';
