// MCP client — wraps @modelcontextprotocol/sdk. Supports stdio, Streamable HTTP,
// and HTTP+SSE transports, with static + dynamic (headersHelper) auth headers
// AND OAuth 2.0 (authorization-code + PKCE, browser flow) via `config.oauth`
// (see ./oauth.ts). Tokens persist under ~/.deepcode/mcp-auth/ and auto-refresh.
// Spec: docs/DEVELOPMENT_PLAN.md §3.3

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from '../config/types.js';
import type { ToolDefinition, ToolHandler, ToolResult } from '../types.js';
import { createMcpOAuthProvider, type DeepCodeOAuthProvider } from './oauth.js';

const execFileAsync = promisify(execFile);

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
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
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

export type McpElicitResult =
  | { action: 'accept'; content: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' };

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
export function pickTransportKind(config: McpServerConfig): McpTransportKind | null {
  if (config.transport) return config.transport;
  if (config.command) return 'stdio';
  if (config.url) return 'http';
  return null;
}

/**
 * Parse a headersHelper's stdout into HTTP headers. Accepts either a JSON object
 * (`{"Authorization":"Bearer x"}`) or `Key: Value` lines.
 */
export function parseHelperOutput(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  const trimmed = stdout.trim();
  if (!trimmed) return out;
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = String(v);
      return out;
    }
  } catch {
    /* not JSON — fall through to line parsing */
  }
  for (const line of trimmed.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Merge static `headers` with the dynamic `headersHelper` output (helper wins). */
async function resolveAuthHeaders(config: McpServerConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  if (config.headersHelper) {
    try {
      const { stdout } = await execFileAsync('/bin/sh', ['-c', config.headersHelper], {
        timeout: 10_000,
      });
      Object.assign(headers, parseHelperOutput(stdout));
    } catch (err) {
      throw new Error(`headersHelper failed: ${(err as Error).message}`);
    }
  }
  return headers;
}

async function buildTransport(
  serverName: string,
  config: McpServerConfig,
  kind: McpTransportKind,
  authProvider?: OAuthClientProvider,
): Promise<Transport> {
  if (kind === 'stdio') {
    if (!config.command) {
      throw new Error(`MCP server "${serverName}" (stdio) must specify a command`);
    }
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
    });
  }
  // http / sse
  if (!config.url) {
    throw new Error(`MCP server "${serverName}" (${kind}) must specify a url`);
  }
  const url = new URL(config.url);
  const headers = await resolveAuthHeaders(config);
  const requestInit: RequestInit = Object.keys(headers).length > 0 ? { headers } : {};
  return kind === 'sse'
    ? new SSEClientTransport(url, { requestInit, authProvider })
    : new StreamableHTTPClientTransport(url, { requestInit, authProvider });
}

/** A transport that supports completing an interactive OAuth flow. */
interface FinishableTransport extends Transport {
  finishAuth(code: string): Promise<void>;
}

/** Max characters of MCP tool output fed back to the model (keeps a runaway
 *  server response from blowing the context window). */
export const MCP_OUTPUT_CAP = 50_000;

/** Truncate over-long MCP output with a visible notice. Exported for testing. */
export function capMcpOutput(text: string, cap = MCP_OUTPUT_CAP): string {
  if (text.length <= cap) return text;
  const omitted = text.length - cap;
  return (
    text.slice(0, cap) +
    `\n\n[… ${omitted} characters truncated — MCP output exceeded the ${cap}-char cap]`
  );
}

/**
 * Connect to one MCP server (stdio / http / sse). Returns a handle containing
 * the registered tools (qualified as `mcp__<server>__<tool>`).
 * Caller is responsible for calling `handle.close()` on shutdown.
 */
export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig,
  opts: ConnectMcpOpts = {},
): Promise<McpClientHandle> {
  const kind = pickTransportKind(config);
  if (!kind) {
    throw new Error(
      `MCP server "${serverName}" must specify a command (stdio) or a url (http/sse)`,
    );
  }
  // OAuth (http/sse only): start a loopback receiver + provider so the SDK can
  // run the authorization-code + PKCE flow. Tokens persist + auto-refresh.
  let oauthProvider: DeepCodeOAuthProvider | undefined;
  if (config.oauth && kind !== 'stdio') {
    oauthProvider = await createMcpOAuthProvider(serverName, {
      scopes: config.oauthScopes,
      home: opts.home,
      log: opts.log ?? ((m) => process.stderr.write(`[mcp:${serverName}] ${m}\n`)),
    });
  }
  const transport = await buildTransport(serverName, config, kind, oauthProvider);
  // Advertise elicitation support only when the host gave us a handler — an
  // empty `elicitation: {}` capability means form mode (SDK default).
  const capabilities = opts.elicit ? { elicitation: {} } : {};
  const client = new Client({ name: 'deepcode', version: '0.1.0' }, { capabilities });
  if (opts.elicit) {
    const elicit = opts.elicit;
    // Register before connect so an early server request can't race the handler.
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      const params = req.params as { message?: string; requestedSchema?: Record<string, unknown> };
      return elicit({
        server: serverName,
        message: params.message ?? '',
        requestedSchema: params.requestedSchema ?? { type: 'object', properties: {} },
      });
    });
  }
  try {
    await client.connect(transport);
  } catch (err) {
    // First connect with no/expired token throws UnauthorizedError after opening
    // the browser. Wait for the loopback redirect, finish the exchange, retry.
    if (oauthProvider && err instanceof UnauthorizedError) {
      const code = await oauthProvider.waitForCode();
      await (transport as FinishableTransport).finishAuth(code);
      await client.connect(transport);
    } else {
      oauthProvider?.closeReceiver();
      throw err;
    }
  } finally {
    oauthProvider?.closeReceiver();
  }

  // List the tools the server exposes
  const listed = await client.listTools();
  const tools: ToolHandler[] = listed.tools.map((t) => {
    const qualified = `mcp__${serverName}__${t.name}`;
    const def: ToolDefinition = {
      name: qualified,
      description: t.description ?? `(MCP tool from ${serverName})`,
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    };
    return {
      name: qualified,
      definition: def,
      async execute(input: Record<string, unknown>): Promise<ToolResult> {
        try {
          const result = (await client.callTool({
            name: t.name,
            arguments: input,
          })) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
          // MCP returns { content: [{type:'text', text:'...'}, ...] }
          const textParts =
            (result.content ?? [])
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('\n') || '';
          return {
            content: textParts ? capMcpOutput(textParts) : '(MCP tool returned no text content)',
            isError: result.isError === true,
            data: { serverName, serverToolName: t.name },
          };
        } catch (err) {
          return {
            content: `MCP call failed: ${(err as Error).message}`,
            isError: true,
          };
        }
      },
    };
  });

  // Resources (best-effort, capability-gated). A server without the `resources`
  // capability — or one that errors on resources/list — just yields [].
  let resources: McpResourceMeta[] = [];
  let resourceTemplates: McpResourceTemplateMeta[] = [];
  if (client.getServerCapabilities()?.resources) {
    try {
      const r = await client.listResources();
      resources = (r.resources ?? []).map((res) => ({
        uri: res.uri,
        name: res.name,
        description: res.description,
        mimeType: res.mimeType,
      }));
    } catch {
      /* server advertised resources but list failed — degrade to none */
    }
    try {
      const rt = await client.listResourceTemplates();
      resourceTemplates = (rt.resourceTemplates ?? []).map((t) => ({
        uriTemplate: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType,
      }));
    } catch {
      /* templates are optional even within the resources capability */
    }
  }

  // Prompts (best-effort, capability-gated — same degradation as resources).
  let prompts: McpPromptMeta[] = [];
  if (client.getServerCapabilities()?.prompts) {
    try {
      const p = await client.listPrompts();
      prompts = (p.prompts ?? []).map((pr) => ({
        name: pr.name,
        description: pr.description,
        arguments: pr.arguments,
      }));
    } catch {
      /* server advertised prompts but list failed — degrade to none */
    }
  }

  return {
    serverName,
    client,
    transport,
    transportKind: kind,
    tools,
    resources,
    resourceTemplates,
    prompts,
    async close() {
      await client.close();
    },
  };
}

/**
 * Fetch an MCP prompt and flatten its messages to a single prompt string. Each
 * message's text content is concatenated (non-text content is skipped).
 */
export async function getMcpPrompt(
  handle: McpClientHandle,
  name: string,
  args: Record<string, string> = {},
): Promise<string> {
  const result = await handle.client.getPrompt({ name, arguments: args });
  const parts = (result.messages ?? []).map((m) => {
    const c = m.content;
    if (
      c &&
      typeof c === 'object' &&
      'type' in c &&
      c.type === 'text' &&
      typeof c.text === 'string'
    ) {
      return c.text;
    }
    return '';
  });
  return parts.filter(Boolean).join('\n\n');
}

/** A server prompt surfaced as a `/mcp__<server>__<prompt>` slash command. */
export interface McpPromptCommand {
  /** Slash command name, e.g. `/mcp__github__open_pr`. */
  command: string;
  server: string;
  prompt: string;
  description?: string;
  arguments: Array<{ name: string; description?: string; required?: boolean }>;
}

/** Build the `/mcp__server__prompt` command list across all connected servers. */
export function mcpPromptCommands(handles: McpClientHandle[]): McpPromptCommand[] {
  const out: McpPromptCommand[] = [];
  for (const h of handles) {
    for (const p of h.prompts) {
      out.push({
        command: `/mcp__${h.serverName}__${p.name}`,
        server: h.serverName,
        prompt: p.name,
        description: p.description,
        arguments: p.arguments ?? [],
      });
    }
  }
  return out;
}

/**
 * Resolve a `/mcp__server__prompt …` REPL line: find the matching prompt and
 * parse its arguments. Args accept `key=value` tokens; bare tokens map
 * positionally onto the prompt's declared argument names. Returns null if the
 * line isn't an MCP-prompt invocation.
 */
export function resolveMcpPromptInvocation(
  line: string,
  handles: McpClientHandle[],
): { handle: McpClientHandle; prompt: string; args: Record<string, string> } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/mcp__')) return null;
  const tokens = trimmed.split(/\s+/);
  const command = tokens[0]!; // /mcp__server__prompt
  const rest = command.slice('/mcp__'.length);
  const sep = rest.indexOf('__');
  if (sep === -1) return null;
  const server = rest.slice(0, sep);
  const promptName = rest.slice(sep + 2);
  const handle = handles.find((h) => h.serverName === server);
  if (!handle) return null;
  const meta = handle.prompts.find((p) => p.name === promptName);
  if (!meta) return null;

  const declared = meta.arguments ?? [];
  const args: Record<string, string> = {};
  let positional = 0;
  for (const tok of tokens.slice(1)) {
    const eq = tok.indexOf('=');
    if (eq > 0) {
      args[tok.slice(0, eq)] = tok.slice(eq + 1);
    } else if (declared[positional]) {
      args[declared[positional]!.name] = tok;
      positional++;
    }
  }
  return { handle, prompt: promptName, args };
}

/**
 * Read an MCP resource by URI and flatten its contents to text. Binary blobs are
 * rendered as a `[binary …]` placeholder (the model can't use raw base64).
 */
export async function readMcpResource(handle: McpClientHandle, uri: string): Promise<string> {
  const result = await handle.client.readResource({ uri });
  const parts = (result.contents ?? []).map((c) => {
    if ('text' in c && typeof c.text === 'string') return c.text;
    if ('blob' in c && typeof c.blob === 'string') {
      return `[binary ${c.mimeType ?? 'application/octet-stream'} ${c.uri}]`;
    }
    return '';
  });
  return parts.filter(Boolean).join('\n');
}

/** A parsed `@server:scheme://path` resource reference found in user text. */
export interface ResourceRef {
  /** The full matched token, e.g. `@files:file:///etc/hosts`. */
  raw: string;
  server: string;
  uri: string;
}

// `@<server>:<scheme>://<rest>` — requires `://` so it can't match `@user:pass`
// or an email. Server names are the settings.mcpServers keys (word chars + `-`).
const RESOURCE_REF_RE = /@([A-Za-z0-9_-]+):([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]+)/g;

/** Find all `@server:scheme://path` references in `text` (deduped by raw token). */
export function parseResourceRefs(text: string): ResourceRef[] {
  const out: ResourceRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(RESOURCE_REF_RE)) {
    const raw = m[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push({ raw, server: m[1]!, uri: m[2]! });
  }
  return out;
}

export interface ExpandResourcesResult {
  /** Original text with resolved resource contents appended as tagged blocks. */
  text: string;
  resolved: ResourceRef[];
  errors: Array<{ ref: ResourceRef; error: string }>;
}

/**
 * Expand `@server:scheme://path` references by reading each resource and
 * appending its content as a `<mcp-resource>` block after the user's text. The
 * original tokens are left in place so the model sees what was referenced.
 */
export async function expandMcpResourceRefs(
  text: string,
  handles: McpClientHandle[],
): Promise<ExpandResourcesResult> {
  const refs = parseResourceRefs(text);
  if (refs.length === 0) return { text, resolved: [], errors: [] };

  const byName = new Map(handles.map((h) => [h.serverName, h]));
  const blocks: string[] = [];
  const resolved: ResourceRef[] = [];
  const errors: Array<{ ref: ResourceRef; error: string }> = [];

  for (const ref of refs) {
    const handle = byName.get(ref.server);
    if (!handle) {
      errors.push({ ref, error: `unknown MCP server "${ref.server}"` });
      continue;
    }
    try {
      const content = await readMcpResource(handle, ref.uri);
      blocks.push(
        `<mcp-resource server="${ref.server}" uri="${ref.uri}">\n${content}\n</mcp-resource>`,
      );
      resolved.push(ref);
    } catch (err) {
      errors.push({ ref, error: (err as Error).message });
    }
  }

  const expanded = blocks.length > 0 ? `${text}\n\n${blocks.join('\n\n')}` : text;
  return { text: expanded, resolved, errors };
}

/**
 * Connect to many MCP servers — used at session start by the CLI.
 * Failures are individual (one bad server doesn't kill the rest).
 */
export interface ConnectAllResult {
  handles: McpClientHandle[];
  errors: Array<{ serverName: string; error: string }>;
}

export async function connectAllMcpServers(
  servers: Record<string, McpServerConfig>,
  opts: { enabledOnly?: string[]; disabled?: string[]; elicit?: McpElicitHandler } = {},
): Promise<ConnectAllResult> {
  const handles: McpClientHandle[] = [];
  const errors: Array<{ serverName: string; error: string }> = [];
  const enabled = opts.enabledOnly ? new Set(opts.enabledOnly) : null;
  const disabled = new Set(opts.disabled ?? []);

  for (const [name, cfg] of Object.entries(servers)) {
    if (enabled && !enabled.has(name)) continue;
    if (disabled.has(name)) continue;
    try {
      const handle = await connectMcpServer(name, cfg, { elicit: opts.elicit });
      handles.push(handle);
    } catch (err) {
      errors.push({ serverName: name, error: (err as Error).message });
    }
  }
  return { handles, errors };
}

export async function closeAllMcpServers(handles: McpClientHandle[]): Promise<void> {
  await Promise.allSettled(handles.map((h) => h.close()));
}
