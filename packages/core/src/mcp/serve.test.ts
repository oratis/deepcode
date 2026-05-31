import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer, MCP_SERVE_EXCLUDE, mcpServableTools } from './serve.js';

describe('mcpServableTools', () => {
  it('excludes interactive / host-coupled tools', () => {
    const names = mcpServableTools().map((t) => t.name);
    for (const excluded of MCP_SERVE_EXCLUDE) {
      expect(names).not.toContain(excluded);
    }
  });

  it('includes the core file/shell tools', () => {
    const names = mcpServableTools().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']),
    );
  });
});

describe('buildMcpServer over an in-memory transport', () => {
  let dir: string;
  let client: Client;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dc-mcp-serve-'));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer({ cwd: dir, name: 'deepcode-test', version: '9.9.9' });
    client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });
  afterEach(async () => {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('lists tools (and hides excluded ones)', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('Read');
    expect(names).toContain('Write');
    expect(names).not.toContain('AskUserQuestion');
    expect(names).not.toContain('Task');
    // every listed tool carries a description + object input schema
    for (const t of tools) {
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('executes a tool round-trip (Write then Read)', async () => {
    const file = join(dir, 'note.txt');
    const writeRes = await client.callTool({
      name: 'Write',
      arguments: { file_path: file, content: 'hello from mcp' },
    });
    expect(writeRes.isError ?? false).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe('hello from mcp');

    const readRes = (await client.callTool({
      name: 'Read',
      arguments: { file_path: file },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(readRes.isError ?? false).toBe(false);
    expect(readRes.content[0]!.text).toContain('hello from mcp');
  });

  it('returns isError for an unknown tool', async () => {
    const res = (await client.callTool({ name: 'NoSuchTool', arguments: {} })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Unknown tool/);
  });

  it('surfaces a tool-level error as isError (Read of a missing file)', async () => {
    const res = (await client.callTool({
      name: 'Read',
      arguments: { file_path: join(dir, 'does-not-exist.txt') },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
  });
});
