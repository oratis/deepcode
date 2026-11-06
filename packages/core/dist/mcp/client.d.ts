import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from '../config/types.js';
import type { ToolHandler } from '../types.js';
export interface McpToolMeta {
    /** Original tool name as exposed by the MCP server. */
    serverToolName: string;
    /** Server name (key in settings.mcpServers). */
    serverName: string;
}
export type McpTransportKind = 'stdio' | 'http' | 'sse';
/** A resource a server exposes (from resources/list). */
export interface McpResourceMeta {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
}
/** A parameterized resource a server exposes (from resources/templates/list). */
export interface McpResourceTemplateMeta {
    /** RFC 6570 URI template, e.g. `file:///{path}`. */
    uriTemplate: string;
    name: string;
    description?: string;
    mimeType?: string;
}
/** A prompt a server exposes (from prompts/list). */
export interface McpPromptMeta {
    name: string;
    description?: string;
    arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}
/**
 * A server-initiated request for structured input (elicitation/create, form
 * mode). The host answers by collecting the fields described by `requestedSchema`.
 */
export interface McpElicitRequest {
    server: string;
    message: string;
    /** JSON Schema (object) describing the fields the server wants. */
    requestedSchema: Record<string, unknown>;
}
export type McpElicitResult = {
    action: 'accept';
    content: Record<string, unknown>;
} | {
    action: 'decline';
} | {
    action: 'cancel';
};
/** Host callback that answers a server's elicitation request. */
export type McpElicitHandler = (req: McpElicitRequest) => Promise<McpElicitResult>;
export interface ConnectMcpOpts {
    /**
     * Handler for server-initiated elicitation (structured input) requests. When
     * provided, the client advertises the `elicitation` capability and routes
     * `elicitation/create` requests here. Omit in non-interactive hosts so
     * servers know not to elicit.
     */
    elicit?: McpElicitHandler;
    /** Override $HOME for OAuth token storage (tests). */
    home?: string;
    /** Direct DeepCode data directory for OAuth token storage. */
    directory?: string;
    /** Diagnostics sink for the OAuth flow (browser-open prompt, etc.). */
    log?: (msg: string) => void;
}
export interface McpClientHandle {
    serverName: string;
    client: Client;
    transport: Transport;
    /** Which transport this connection uses. */
    transportKind: McpTransportKind;
    tools: ToolHandler[];
    /** Resources the server advertised (empty if it has no `resources` capability). */
    resources: McpResourceMeta[];
    /** Parameterized resource templates the server advertised. */
    resourceTemplates: McpResourceTemplateMeta[];
    /** Prompts the server advertised (empty if it has no `prompts` capability). */
    prompts: McpPromptMeta[];
    close(): Promise<void>;
}
/**
 * Decide the transport for a server config:
 *   - explicit `transport` wins;
 *   - else `command` → stdio, `url` → http (Streamable HTTP, the modern default);
 *   - else null (caller errors).
 */
export declare function pickTransportKind(config: McpServerConfig): McpTransportKind | null;
/**
 * Parse a headersHelper's stdout into HTTP headers. Accepts either a JSON object
 * (`{"Authorization":"Bearer x"}`) or `Key: Value` lines.
 */
export declare function parseHelperOutput(stdout: string): Record<string, string>;
/** Max characters of MCP tool output fed back to the model (keeps a runaway
 *  server response from blowing the context window). */
export declare const MCP_OUTPUT_CAP = 50000;
/** Truncate over-long MCP output with a visible notice. Exported for testing. */
export declare function capMcpOutput(text: string, cap?: number): string;
/**
 * Connect to one MCP server (stdio / http / sse). Returns a handle containing
 * the registered tools (qualified as `mcp__<server>__<tool>`).
 * Caller is responsible for calling `handle.close()` on shutdown.
 */
export declare function connectMcpServer(serverName: string, config: McpServerConfig, opts?: ConnectMcpOpts): Promise<McpClientHandle>;
/**
 * Fetch an MCP prompt and flatten its messages to a single prompt string. Each
 * message's text content is concatenated (non-text content is skipped).
 */
export declare function getMcpPrompt(handle: McpClientHandle, name: string, args?: Record<string, string>): Promise<string>;
/** A server prompt surfaced as a `/mcp__<server>__<prompt>` slash command. */
export interface McpPromptCommand {
    /** Slash command name, e.g. `/mcp__github__open_pr`. */
    command: string;
    server: string;
    prompt: string;
    description?: string;
    arguments: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}
/** Build the `/mcp__server__prompt` command list across all connected servers. */
export declare function mcpPromptCommands(handles: McpClientHandle[]): McpPromptCommand[];
/**
 * Resolve a `/mcp__server__prompt …` REPL line: find the matching prompt and
 * parse its arguments. Args accept `key=value` tokens; bare tokens map
 * positionally onto the prompt's declared argument names. Returns null if the
 * line isn't an MCP-prompt invocation.
 */
export declare function resolveMcpPromptInvocation(line: string, handles: McpClientHandle[]): {
    handle: McpClientHandle;
    prompt: string;
    args: Record<string, string>;
} | null;
/**
 * Read an MCP resource by URI and flatten its contents to text. Binary blobs are
 * rendered as a `[binary …]` placeholder (the model can't use raw base64).
 */
export declare function readMcpResource(handle: McpClientHandle, uri: string): Promise<string>;
/** A parsed `@server:scheme://path` resource reference found in user text. */
export interface ResourceRef {
    /** The full matched token, e.g. `@files:file:///etc/hosts`. */
    raw: string;
    server: string;
    uri: string;
}
/** Find all `@server:scheme://path` references in `text` (deduped by raw token). */
export declare function parseResourceRefs(text: string): ResourceRef[];
export interface ExpandResourcesResult {
    /** Original text with resolved resource contents appended as tagged blocks. */
    text: string;
    resolved: ResourceRef[];
    errors: Array<{
        ref: ResourceRef;
        error: string;
    }>;
}
/**
 * Expand `@server:scheme://path` references by reading each resource and
 * appending its content as a `<mcp-resource>` block after the user's text. The
 * original tokens are left in place so the model sees what was referenced.
 */
export declare function expandMcpResourceRefs(text: string, handles: McpClientHandle[]): Promise<ExpandResourcesResult>;
/**
 * Connect to many MCP servers — used at session start by the CLI.
 * Failures are individual (one bad server doesn't kill the rest).
 */
export interface ConnectAllResult {
    handles: McpClientHandle[];
    errors: Array<{
        serverName: string;
        error: string;
    }>;
}
export declare function connectAllMcpServers(servers: Record<string, McpServerConfig>, opts?: {
    enabledOnly?: string[];
    disabled?: string[];
    elicit?: McpElicitHandler;
    home?: string;
    directory?: string;
    log?: (msg: string) => void;
}): Promise<ConnectAllResult>;
export declare function closeAllMcpServers(handles: McpClientHandle[]): Promise<void>;
//# sourceMappingURL=client.d.ts.map