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
import { connectAllMcpServers, connectMcpServer } from './client.js';

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
async function writeFakeServer(dir: string, name: string, tools: object[]): Promise<string> {
  const serverPath = join(dir, `${name}.mjs`);
  await fs.writeFile(
    serverPath,
    `
import { Server } from '${SERVER_INDEX}';
import { StdioServerTransport } from '${SERVER_STDIO}';
import { CallToolRequestSchema, ListToolsRequestSchema } from '${TYPES_INDEX}';

const server = new Server(
  { name: '${name}', version: '0.0.1' },
  { capabilities: { tools: {} } },
);

const TOOLS = ${JSON.stringify(tools)};

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const argsStr = JSON.stringify(req.params.arguments);
  return {
    content: [{ type: 'text', text: 'called: ' + req.params.name + ' args: ' + argsStr }],
  };
});

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

  it('rejects a server config missing `command`', async () => {
    await expect(connectMcpServer('bad', {})).rejects.toThrow(/command/);
  });
});

// Silence unused-import warning — Server/Transport are used via the spawned script
void Server;
void StdioServerTransport;
void CallToolRequestSchema;
void ListToolsRequestSchema;
