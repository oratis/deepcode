// MCP subsystem entry — client (stdio + Streamable HTTP + SSE transports, with
// static + headersHelper auth) + server (`mcp serve` exposes our tools over
// stdio). (Full OAuth + Elicitation → later.)
// Spec: docs/DEVELOPMENT_PLAN.md §3.3
export { connectMcpServer, connectAllMcpServers, closeAllMcpServers, pickTransportKind, parseHelperOutput, readMcpResource, parseResourceRefs, expandMcpResourceRefs, getMcpPrompt, mcpPromptCommands, resolveMcpPromptInvocation, } from './client.js';
export { buildMcpServer, buildMcpGate, serveMcpOverStdio, mcpServableTools, MCP_SERVE_EXCLUDE, } from './serve.js';
export { McpAuthStore, DeepCodeOAuthProvider, createMcpOAuthProvider, startLoopbackReceiver, mcpAuthPath, openBrowser, } from './oauth.js';
//# sourceMappingURL=index.js.map