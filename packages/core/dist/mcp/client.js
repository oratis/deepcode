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
import { UnauthorizedError, } from '@modelcontextprotocol/sdk/client/auth.js';
import { createMcpOAuthProvider } from './oauth.js';
const execFileAsync = promisify(execFile);
/**
 * Decide the transport for a server config:
 *   - explicit `transport` wins;
 *   - else `command` → stdio, `url` → http (Streamable HTTP, the modern default);
 *   - else null (caller errors).
 */
export function pickTransportKind(config) {
    if (config.transport)
        return config.transport;
    if (config.command)
        return 'stdio';
    if (config.url)
        return 'http';
    return null;
}
/**
 * Parse a headersHelper's stdout into HTTP headers. Accepts either a JSON object
 * (`{"Authorization":"Bearer x"}`) or `Key: Value` lines.
 */
export function parseHelperOutput(stdout) {
    const out = {};
    const trimmed = stdout.trim();
    if (!trimmed)
        return out;
    try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            for (const [k, v] of Object.entries(obj))
                out[k] = String(v);
            return out;
        }
    }
    catch {
        /* not JSON — fall through to line parsing */
    }
    for (const line of trimmed.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0)
            out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return out;
}
/** Merge static `headers` with the dynamic `headersHelper` output (helper wins). */
async function resolveAuthHeaders(config) {
    const headers = { ...(config.headers ?? {}) };
    if (config.headersHelper) {
        try {
            const { stdout } = await execFileAsync('/bin/sh', ['-c', config.headersHelper], {
                timeout: 10_000,
            });
            Object.assign(headers, parseHelperOutput(stdout));
        }
        catch (err) {
            throw new Error(`headersHelper failed: ${err.message}`, { cause: err });
        }
    }
    return headers;
}
async function buildTransport(serverName, config, kind, authProvider) {
    if (kind === 'stdio') {
        if (!config.command) {
            throw new Error(`MCP server "${serverName}" (stdio) must specify a command`);
        }
        return new StdioClientTransport({
            command: config.command,
            args: config.args ?? [],
            env: { ...process.env, ...(config.env ?? {}) },
        });
    }
    // http / sse
    if (!config.url) {
        throw new Error(`MCP server "${serverName}" (${kind}) must specify a url`);
    }
    const url = new URL(config.url);
    const headers = await resolveAuthHeaders(config);
    const requestInit = Object.keys(headers).length > 0 ? { headers } : {};
    return kind === 'sse'
        ? new SSEClientTransport(url, { requestInit, authProvider })
        : new StreamableHTTPClientTransport(url, { requestInit, authProvider });
}
/** Max characters of MCP tool output fed back to the model (keeps a runaway
 *  server response from blowing the context window). */
export const MCP_OUTPUT_CAP = 50_000;
/** Truncate over-long MCP output with a visible notice. Exported for testing. */
export function capMcpOutput(text, cap = MCP_OUTPUT_CAP) {
    if (text.length <= cap)
        return text;
    const omitted = text.length - cap;
    return (text.slice(0, cap) +
        `\n\n[… ${omitted} characters truncated — MCP output exceeded the ${cap}-char cap]`);
}
/**
 * Connect to one MCP server (stdio / http / sse). Returns a handle containing
 * the registered tools (qualified as `mcp__<server>__<tool>`).
 * Caller is responsible for calling `handle.close()` on shutdown.
 */
export async function connectMcpServer(serverName, config, opts = {}) {
    const kind = pickTransportKind(config);
    if (!kind) {
        throw new Error(`MCP server "${serverName}" must specify a command (stdio) or a url (http/sse)`);
    }
    // OAuth (http/sse only): start a loopback receiver + provider so the SDK can
    // run the authorization-code + PKCE flow. Tokens persist + auto-refresh.
    let oauthProvider;
    if (config.oauth && kind !== 'stdio') {
        oauthProvider = await createMcpOAuthProvider(serverName, {
            scopes: config.oauthScopes,
            home: opts.home,
            directory: opts.directory,
            log: opts.log ?? ((m) => process.stderr.write(`[mcp:${serverName}] ${m}\n`)),
        });
    }
    let transport;
    try {
        transport = await buildTransport(serverName, config, kind, oauthProvider);
    }
    catch (error) {
        oauthProvider?.closeReceiver();
        throw error;
    }
    // Advertise elicitation support only when the host gave us a handler — an
    // empty `elicitation: {}` capability means form mode (SDK default).
    const capabilities = opts.elicit ? { elicitation: {} } : {};
    const client = new Client({ name: 'deepcode', version: '0.1.0' }, { capabilities });
    if (opts.elicit) {
        const elicit = opts.elicit;
        // Register before connect so an early server request can't race the handler.
        client.setRequestHandler(ElicitRequestSchema, async (req) => {
            const params = req.params;
            return elicit({
                server: serverName,
                message: params.message ?? '',
                requestedSchema: params.requestedSchema ?? { type: 'object', properties: {} },
            });
        });
    }
    try {
        await client.connect(transport);
    }
    catch (err) {
        // First connect with no/expired token throws UnauthorizedError after opening
        // the browser. Wait for the loopback redirect, finish the exchange, retry.
        if (oauthProvider && err instanceof UnauthorizedError) {
            try {
                const code = await oauthProvider.waitForCode();
                await transport.finishAuth(code);
                await client.connect(transport);
            }
            catch (authError) {
                await client.close().catch(() => undefined);
                throw authError;
            }
        }
        else {
            oauthProvider?.closeReceiver();
            await client.close().catch(() => undefined);
            throw err;
        }
    }
    finally {
        oauthProvider?.closeReceiver();
    }
    try {
        // List the tools the server exposes
        const listed = await client.listTools();
        const tools = listed.tools.map((t) => {
            const qualified = `mcp__${serverName}__${t.name}`;
            const def = {
                name: qualified,
                description: t.description ?? `(MCP tool from ${serverName})`,
                inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }),
            };
            return {
                name: qualified,
                definition: def,
                async execute(input) {
                    try {
                        const result = (await client.callTool({
                            name: t.name,
                            arguments: input,
                        }));
                        // MCP returns { content: [{type:'text', text:'...'}, ...] }
                        const textParts = (result.content ?? [])
                            .filter((c) => c.type === 'text')
                            .map((c) => c.text ?? '')
                            .join('\n') || '';
                        return {
                            content: textParts ? capMcpOutput(textParts) : '(MCP tool returned no text content)',
                            isError: result.isError === true,
                            data: { serverName, serverToolName: t.name },
                        };
                    }
                    catch (err) {
                        return {
                            content: `MCP call failed: ${err.message}`,
                            isError: true,
                        };
                    }
                },
            };
        });
        // Resources (best-effort, capability-gated). A server without the `resources`
        // capability — or one that errors on resources/list — just yields [].
        let resources = [];
        let resourceTemplates = [];
        if (client.getServerCapabilities()?.resources) {
            try {
                const r = await client.listResources();
                resources = (r.resources ?? []).map((res) => ({
                    uri: res.uri,
                    name: res.name,
                    description: res.description,
                    mimeType: res.mimeType,
                }));
            }
            catch {
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
            }
            catch {
                /* templates are optional even within the resources capability */
            }
        }
        // Prompts (best-effort, capability-gated — same degradation as resources).
        let prompts = [];
        if (client.getServerCapabilities()?.prompts) {
            try {
                const p = await client.listPrompts();
                prompts = (p.prompts ?? []).map((pr) => ({
                    name: pr.name,
                    description: pr.description,
                    arguments: pr.arguments,
                }));
            }
            catch {
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
    catch (error) {
        await client.close().catch(() => undefined);
        throw error;
    }
}
/**
 * Fetch an MCP prompt and flatten its messages to a single prompt string. Each
 * message's text content is concatenated (non-text content is skipped).
 */
export async function getMcpPrompt(handle, name, args = {}) {
    const result = await handle.client.getPrompt({ name, arguments: args });
    const parts = (result.messages ?? []).map((m) => {
        const c = m.content;
        if (c &&
            typeof c === 'object' &&
            'type' in c &&
            c.type === 'text' &&
            typeof c.text === 'string') {
            return c.text;
        }
        return '';
    });
    return parts.filter(Boolean).join('\n\n');
}
/** Build the `/mcp__server__prompt` command list across all connected servers. */
export function mcpPromptCommands(handles) {
    const out = [];
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
export function resolveMcpPromptInvocation(line, handles) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('/mcp__'))
        return null;
    const tokens = trimmed.split(/\s+/);
    const command = tokens[0]; // /mcp__server__prompt
    const rest = command.slice('/mcp__'.length);
    const sep = rest.indexOf('__');
    if (sep === -1)
        return null;
    const server = rest.slice(0, sep);
    const promptName = rest.slice(sep + 2);
    const handle = handles.find((h) => h.serverName === server);
    if (!handle)
        return null;
    const meta = handle.prompts.find((p) => p.name === promptName);
    if (!meta)
        return null;
    const declared = meta.arguments ?? [];
    const args = {};
    let positional = 0;
    for (const tok of tokens.slice(1)) {
        const eq = tok.indexOf('=');
        if (eq > 0) {
            args[tok.slice(0, eq)] = tok.slice(eq + 1);
        }
        else if (declared[positional]) {
            args[declared[positional].name] = tok;
            positional++;
        }
    }
    return { handle, prompt: promptName, args };
}
/**
 * Read an MCP resource by URI and flatten its contents to text. Binary blobs are
 * rendered as a `[binary …]` placeholder (the model can't use raw base64).
 */
export async function readMcpResource(handle, uri) {
    const result = await handle.client.readResource({ uri });
    const parts = (result.contents ?? []).map((c) => {
        if ('text' in c && typeof c.text === 'string')
            return c.text;
        if ('blob' in c && typeof c.blob === 'string') {
            return `[binary ${c.mimeType ?? 'application/octet-stream'} ${c.uri}]`;
        }
        return '';
    });
    return parts.filter(Boolean).join('\n');
}
// `@<server>:<scheme>://<rest>` — requires `://` so it can't match `@user:pass`
// or an email. Server names are the settings.mcpServers keys (word chars + `-`).
const RESOURCE_REF_RE = /@([A-Za-z0-9_-]+):([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]+)/g;
/** Find all `@server:scheme://path` references in `text` (deduped by raw token). */
export function parseResourceRefs(text) {
    const out = [];
    const seen = new Set();
    for (const m of text.matchAll(RESOURCE_REF_RE)) {
        const raw = m[0];
        if (seen.has(raw))
            continue;
        seen.add(raw);
        out.push({ raw, server: m[1], uri: m[2] });
    }
    return out;
}
/**
 * Expand `@server:scheme://path` references by reading each resource and
 * appending its content as a `<mcp-resource>` block after the user's text. The
 * original tokens are left in place so the model sees what was referenced.
 */
export async function expandMcpResourceRefs(text, handles) {
    const refs = parseResourceRefs(text);
    if (refs.length === 0)
        return { text, resolved: [], errors: [] };
    const byName = new Map(handles.map((h) => [h.serverName, h]));
    const blocks = [];
    const resolved = [];
    const errors = [];
    for (const ref of refs) {
        const handle = byName.get(ref.server);
        if (!handle) {
            errors.push({ ref, error: `unknown MCP server "${ref.server}"` });
            continue;
        }
        try {
            const content = await readMcpResource(handle, ref.uri);
            blocks.push(`<mcp-resource server="${ref.server}" uri="${ref.uri}">\n${content}\n</mcp-resource>`);
            resolved.push(ref);
        }
        catch (err) {
            errors.push({ ref, error: err.message });
        }
    }
    const expanded = blocks.length > 0 ? `${text}\n\n${blocks.join('\n\n')}` : text;
    return { text: expanded, resolved, errors };
}
export async function connectAllMcpServers(servers, opts = {}) {
    const handles = [];
    const errors = [];
    const enabled = opts.enabledOnly ? new Set(opts.enabledOnly) : null;
    const disabled = new Set(opts.disabled ?? []);
    for (const [name, cfg] of Object.entries(servers)) {
        if (enabled && !enabled.has(name))
            continue;
        if (disabled.has(name))
            continue;
        try {
            const handle = await connectMcpServer(name, cfg, {
                elicit: opts.elicit,
                home: opts.home,
                directory: opts.directory,
                log: opts.log,
            });
            handles.push(handle);
        }
        catch (err) {
            errors.push({ serverName: name, error: err.message });
        }
    }
    return { handles, errors };
}
export async function closeAllMcpServers(handles) {
    await Promise.allSettled(handles.map((h) => h.close()));
}
//# sourceMappingURL=client.js.map