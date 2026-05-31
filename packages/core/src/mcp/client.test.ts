// MCP client tests — use a tiny in-process MCP server (via SDK) over a pipe
// pair to avoid spawning external `npx` (which is slow + network-dependent).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  capMcpOutput,
  connectAllMcpServers,
  connectMcpServer,
  expandMcpResourceRefs,
  getMcpPrompt,
  mcpPromptCommands,
  parseHelperOutput,
  parseResourceRefs,
  pickTransportKind,
  readMcpResource,
  resolveMcpPromptInvocation,
} from './client.js';

const require_ = createRequire(import.meta.url);
// Resolve a known sub-export (CJS shim file) to find the package root,
// then point to the ESM build for the spawned script.
const sdkSubmodule = require_.resolve('@modelcontextprotocol/sdk/server/index.js');
// .../sdk/dist/cjs/server/index.js → walk up to .../sdk/
const SDK_PKG_PATH = sdkSubmodule.replace(/\/dist\/(?:cjs|esm)\/.*$/, '');
const SERVER_INDEX = join(SDK_PKG_PATH, 'dist/esm/server/index.js');
const SERVER_STDIO = join(SDK_PKG_PATH, 'dist/esm/server/stdio.js');
const TYPES_INDEX = join(SDK_PKG_PATH, 'dist/esm/types.js');

/**
 * Spawn-a-script approach: write a tiny MCP server to disk, run it via node.
 * We import the SDK by absolute path so the spawned script doesn't have to
 * resolve `@modelcontextprotocol/sdk` from /tmp (which lacks node_modules).
 */
async function writeFakeServer(
  dir: string,
  name: string,
  tools: object[],
  resources?: Array<{ uri: string; name?: string; text: string; mimeType?: string }>,
  prompts?: Array<{
    name: string;
    description?: string;
    arguments?: Array<{ name: string; required?: boolean }>;
    text: string;
  }>,
  /** When set, the named tool triggers a server→client elicitation/create. */
  elicit?: { toolName: string; message: string; requestedSchema: object },
): Promise<string> {
  const serverPath = join(dir, `${name}.mjs`);
  const capList = ['tools: {}'];
  if (resources) capList.push('resources: {}');
  if (prompts) capList.push('prompts: {}');
  const caps = `{ ${capList.join(', ')} }`;
  const elicitBranch = elicit
    ? `
  if (req.params.name === ${JSON.stringify(elicit.toolName)}) {
    const r = await server.elicitInput({
      message: ${JSON.stringify(elicit.message)},
      requestedSchema: ${JSON.stringify(elicit.requestedSchema)},
    });
    return { content: [{ type: 'text', text: 'elicited:' + JSON.stringify(r) }] };
  }`
    : '';
  const resourceBlock = resources
    ? `
import { ListResourcesRequestSchema, ReadResourceRequestSchema, ListResourceTemplatesRequestSchema } from '${TYPES_INDEX}';
const RESOURCES = ${JSON.stringify(resources)};
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: RESOURCES.map((r) => ({ uri: r.uri, name: r.name, mimeType: r.mimeType })),
}));
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const found = RESOURCES.find((r) => r.uri === req.params.uri);
  if (!found) throw new Error('no such resource: ' + req.params.uri);
  return { contents: [{ uri: found.uri, mimeType: found.mimeType ?? 'text/plain', text: found.text }] };
});
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [{ uriTemplate: 'file:///{path}', name: 'file', description: 'a file by path' }],
}));
`
    : '';
  const promptBlock = prompts
    ? `
import { ListPromptsRequestSchema, GetPromptRequestSchema } from '${TYPES_INDEX}';
const PROMPTS = ${JSON.stringify(prompts)};
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS.map((p) => ({ name: p.name, description: p.description, arguments: p.arguments })),
}));
server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const found = PROMPTS.find((p) => p.name === req.params.name);
  if (!found) throw new Error('no such prompt: ' + req.params.name);
  const argsStr = JSON.stringify(req.params.arguments ?? {});
  return {
    messages: [
      { role: 'user', content: { type: 'text', text: found.text + ' args=' + argsStr } },
    ],
  };
});
`
    : '';
  await fs.writeFile(
    serverPath,
    `
import { Server } from '${SERVER_INDEX}';
import { StdioServerTransport } from '${SERVER_STDIO}';
import { CallToolRequestSchema, ListToolsRequestSchema } from '${TYPES_INDEX}';

const server = new Server(
  { name: '${name}', version: '0.0.1' },
  { capabilities: ${caps} },
);

const TOOLS = ${JSON.stringify(tools)};

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {${elicitBranch}
  const argsStr = JSON.stringify(req.params.arguments);
  return {
    content: [{ type: 'text', text: 'called: ' + req.params.name + ' args: ' + argsStr }],
  };
});
${resourceBlock}
${promptBlock}
await server.connect(new StdioServerTransport());
`,
    'utf8',
  );
  return serverPath;
}

describe('MCP client', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dc-mcp-test-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('connects to a stdio server, lists tools, qualifies names', async () => {
    const serverScript = await writeFakeServer(tmp, 'tester', [
      {
        name: 'ping',
        description: 'returns pong',
        inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
      },
      {
        name: 'echo',
        description: 'echoes input',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      },
    ]);
    const handle = await connectMcpServer('tester', {
      command: 'node',
      args: [serverScript],
    });
    try {
      expect(handle.serverName).toBe('tester');
      expect(handle.tools).toHaveLength(2);
      expect(handle.tools.map((t) => t.name).sort()).toEqual([
        'mcp__tester__echo',
        'mcp__tester__ping',
      ]);
      expect(handle.tools[0]?.definition.description).toBeDefined();
    } finally {
      await handle.close();
    }
  }, 20_000);

  it('calls a remote tool and returns its text output', async () => {
    const serverScript = await writeFakeServer(tmp, 'srv', [
      {
        name: 'hello',
        description: 'd',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      },
    ]);
    const handle = await connectMcpServer('srv', {
      command: 'node',
      args: [serverScript],
    });
    try {
      const helloTool = handle.tools.find((t) => t.name === 'mcp__srv__hello')!;
      const result = await helloTool.execute({ name: 'world' }, { cwd: tmp });
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('called: hello');
      expect(result.content).toContain('"name":"world"');
      expect(result.data?.serverName).toBe('srv');
      expect(result.data?.serverToolName).toBe('hello');
    } finally {
      await handle.close();
    }
  }, 20_000);

  it('connectAllMcpServers continues on individual failures', async () => {
    const goodScript = await writeFakeServer(tmp, 'good', [
      {
        name: 't',
        description: 'd',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
    const result = await connectAllMcpServers({
      good: { command: 'node', args: [goodScript] },
      broken: { command: 'no-such-command-xyzabc' },
    });
    expect(result.handles).toHaveLength(1);
    expect(result.handles[0]?.serverName).toBe('good');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.serverName).toBe('broken');
    await result.handles[0]?.close();
  }, 20_000);

  it('honors disabled list', async () => {
    const script = await writeFakeServer(tmp, 's', [
      {
        name: 't',
        description: 'd',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
    const result = await connectAllMcpServers(
      { s: { command: 'node', args: [script] } },
      { disabled: ['s'] },
    );
    expect(result.handles).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('honors enabledOnly list (M3c equivalent of enabledMcpjsonServers)', async () => {
    const script1 = await writeFakeServer(tmp, 's1', [
      {
        name: 't',
        description: 'd',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
    const script2 = await writeFakeServer(tmp, 's2', [
      {
        name: 't',
        description: 'd',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
    const result = await connectAllMcpServers(
      {
        s1: { command: 'node', args: [script1] },
        s2: { command: 'node', args: [script2] },
      },
      { enabledOnly: ['s1'] },
    );
    expect(result.handles.map((h) => h.serverName)).toEqual(['s1']);
    await result.handles[0]?.close();
  }, 20_000);

  it('rejects a server config with neither command nor url', async () => {
    await expect(connectMcpServer('bad', {})).rejects.toThrow(/command.*url|url.*command/);
  });

  it('lists resources on connect, reads them, and expands @server:uri refs', async () => {
    const serverScript = await writeFakeServer(
      tmp,
      'docs',
      [{ name: 'noop', description: 'd', inputSchema: { type: 'object', properties: {} } }],
      [
        { uri: 'file:///readme.md', name: 'readme', text: '# Hello\nbody text' },
        { uri: 'mem://note', name: 'note', text: 'a short note' },
      ],
    );
    const handle = await connectMcpServer('docs', { command: 'node', args: [serverScript] });
    try {
      // resources/list populated the handle
      expect(handle.resources.map((r) => r.uri).sort()).toEqual([
        'file:///readme.md',
        'mem://note',
      ]);

      // resources/templates/list populated the handle's templates
      expect(handle.resourceTemplates.map((t) => t.uriTemplate)).toEqual(['file:///{path}']);
      expect(handle.resourceTemplates[0]!.name).toBe('file');

      // readMcpResource flattens contents to text
      expect(await readMcpResource(handle, 'file:///readme.md')).toContain('# Hello');

      // expandMcpResourceRefs appends a tagged block, keeps the original token
      const { text, resolved, errors } = await expandMcpResourceRefs(
        'please summarize @docs:file:///readme.md now',
        [handle],
      );
      expect(resolved).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(text).toContain('@docs:file:///readme.md'); // original kept
      expect(text).toContain('<mcp-resource server="docs" uri="file:///readme.md">');
      expect(text).toContain('body text');

      // unknown server + bad uri surface as errors, not throws
      const r2 = await expandMcpResourceRefs('@nope:file:///x and @docs:mem://missing', [handle]);
      expect(r2.errors).toHaveLength(2);
      expect(r2.resolved).toHaveLength(0);
    } finally {
      await handle.close();
    }
  }, 20_000);

  it('lists prompts on connect and fetches one with arguments', async () => {
    const serverScript = await writeFakeServer(
      tmp,
      'gh',
      [{ name: 'noop', description: 'd', inputSchema: { type: 'object', properties: {} } }],
      undefined,
      [
        {
          name: 'open_pr',
          description: 'Open a PR',
          arguments: [{ name: 'title', required: true }],
          text: 'Draft a PR titled',
        },
      ],
    );
    const handle = await connectMcpServer('gh', { command: 'node', args: [serverScript] });
    try {
      expect(handle.prompts.map((p) => p.name)).toEqual(['open_pr']);

      // mcpPromptCommands surfaces it as a slash command
      const cmds = mcpPromptCommands([handle]);
      expect(cmds[0]!.command).toBe('/mcp__gh__open_pr');

      // resolveMcpPromptInvocation maps a positional token to the declared arg
      const inv = resolveMcpPromptInvocation('/mcp__gh__open_pr fix-bug', [handle]);
      expect(inv).not.toBeNull();
      expect(inv!.prompt).toBe('open_pr');
      expect(inv!.args).toEqual({ title: 'fix-bug' });

      // getMcpPrompt returns the server's rendered prompt text + forwarded args
      const text = await getMcpPrompt(handle, inv!.prompt, inv!.args);
      expect(text).toContain('Draft a PR titled');
      expect(text).toContain('"title":"fix-bug"');
    } finally {
      await handle.close();
    }
  }, 20_000);

  it('routes a server elicitation/create request to the host elicit handler', async () => {
    const serverScript = await writeFakeServer(
      tmp,
      'forms',
      [
        {
          name: 'ask',
          description: 'asks for input',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      undefined,
      undefined,
      {
        toolName: 'ask',
        message: 'What is your name?',
        requestedSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    );
    let seen: { server: string; message: string } | null = null;
    const handle = await connectMcpServer(
      'forms',
      { command: 'node', args: [serverScript] },
      {
        elicit: async (req) => {
          seen = { server: req.server, message: req.message };
          return { action: 'accept', content: { name: 'Ada' } };
        },
      },
    );
    try {
      const ask = handle.tools.find((t) => t.name === 'mcp__forms__ask')!;
      const result = await ask.execute({}, { cwd: tmp });
      // The host handler was invoked with the server's prompt...
      expect(seen).toEqual({ server: 'forms', message: 'What is your name?' });
      // ...and the accepted content flowed back to the server's tool result.
      expect(result.content).toContain('elicited:');
      expect(result.content).toContain('"action":"accept"');
      expect(result.content).toContain('"name":"Ada"');
    } finally {
      await handle.close();
    }
  }, 20_000);

  it('does not advertise elicitation when no handler is supplied', async () => {
    // A server that tries to elicit against a client without the capability
    // gets an error from its elicitInput call; the tool surfaces it (no hang).
    const serverScript = await writeFakeServer(
      tmp,
      'forms2',
      [{ name: 'ask', description: 'asks', inputSchema: { type: 'object', properties: {} } }],
      undefined,
      undefined,
      { toolName: 'ask', message: 'name?', requestedSchema: { type: 'object', properties: {} } },
    );
    const handle = await connectMcpServer('forms2', { command: 'node', args: [serverScript] });
    try {
      const ask = handle.tools.find((t) => t.name === 'mcp__forms2__ask')!;
      const result = await ask.execute({}, { cwd: tmp });
      // elicitInput rejects (client lacks the capability) → tool reports an error.
      expect(result.isError).toBe(true);
    } finally {
      await handle.close();
    }
  }, 20_000);
});

describe('pickTransportKind', () => {
  it('explicit transport wins', () => {
    expect(pickTransportKind({ transport: 'sse', url: 'https://x' })).toBe('sse');
    expect(pickTransportKind({ transport: 'stdio', command: 'x' })).toBe('stdio');
  });
  it('infers stdio from command, http from url', () => {
    expect(pickTransportKind({ command: 'node' })).toBe('stdio');
    expect(pickTransportKind({ url: 'https://mcp.example.com' })).toBe('http');
  });
  it('returns null when neither is set', () => {
    expect(pickTransportKind({})).toBeNull();
  });
});

describe('parseHelperOutput', () => {
  it('parses a JSON object', () => {
    expect(parseHelperOutput('{"Authorization":"Bearer abc","X-Tenant":"acme"}')).toEqual({
      Authorization: 'Bearer abc',
      'X-Tenant': 'acme',
    });
  });
  it('parses Key: Value lines', () => {
    expect(parseHelperOutput('Authorization: Bearer xyz\nX-Env: prod')).toEqual({
      Authorization: 'Bearer xyz',
      'X-Env': 'prod',
    });
  });
  it('returns {} for empty output', () => {
    expect(parseHelperOutput('   \n')).toEqual({});
  });
});

describe('capMcpOutput', () => {
  it('passes through output under the cap', () => {
    expect(capMcpOutput('short', 100)).toBe('short');
  });
  it('truncates over-long output with a notice', () => {
    const big = 'x'.repeat(120);
    const out = capMcpOutput(big, 100);
    expect(out.startsWith('x'.repeat(100))).toBe(true);
    expect(out).toMatch(/20 characters truncated/);
    expect(out).toMatch(/100-char cap/);
  });
});

describe('parseResourceRefs', () => {
  it('finds @server:scheme://path references', () => {
    const refs = parseResourceRefs(
      'look at @files:file:///etc/hosts and @db:postgres://h/t please',
    );
    expect(refs).toEqual([
      { raw: '@files:file:///etc/hosts', server: 'files', uri: 'file:///etc/hosts' },
      { raw: '@db:postgres://h/t', server: 'db', uri: 'postgres://h/t' },
    ]);
  });

  it('ignores @user:pass and emails (no scheme://)', () => {
    expect(parseResourceRefs('email me@host.com or @user:secret')).toEqual([]);
  });

  it('dedupes repeated references', () => {
    const refs = parseResourceRefs('@a:x://1 then again @a:x://1');
    expect(refs).toHaveLength(1);
  });

  it('returns [] when there are no references', () => {
    expect(parseResourceRefs('just plain text')).toEqual([]);
  });
});

describe('resolveMcpPromptInvocation', () => {
  const handle = {
    serverName: 'srv',
    prompts: [
      { name: 'greet', arguments: [{ name: 'who' }, { name: 'lang' }] },
      { name: 'noargs' },
    ],
  } as unknown as Parameters<typeof resolveMcpPromptInvocation>[1][number];

  it('returns null for non-prompt lines', () => {
    expect(resolveMcpPromptInvocation('hello world', [handle])).toBeNull();
    expect(resolveMcpPromptInvocation('/help', [handle])).toBeNull();
  });

  it('returns null for an unknown server or prompt', () => {
    expect(resolveMcpPromptInvocation('/mcp__other__greet', [handle])).toBeNull();
    expect(resolveMcpPromptInvocation('/mcp__srv__missing', [handle])).toBeNull();
  });

  it('maps bare tokens positionally onto declared argument names', () => {
    const inv = resolveMcpPromptInvocation('/mcp__srv__greet Ada french', [handle]);
    expect(inv?.prompt).toBe('greet');
    expect(inv?.args).toEqual({ who: 'Ada', lang: 'french' });
  });

  it('parses key=value tokens (and mixes with positional)', () => {
    const inv = resolveMcpPromptInvocation('/mcp__srv__greet lang=de Ada', [handle]);
    // lang set explicitly; bare "Ada" fills the first declared arg (who)
    expect(inv?.args).toEqual({ lang: 'de', who: 'Ada' });
  });

  it('handles a prompt with no declared arguments', () => {
    const inv = resolveMcpPromptInvocation('/mcp__srv__noargs', [handle]);
    expect(inv?.prompt).toBe('noargs');
    expect(inv?.args).toEqual({});
  });
});

// Silence unused-import warning — Server/Transport are used via the spawned script
void Server;
void StdioServerTransport;
void CallToolRequestSchema;
void ListToolsRequestSchema;
