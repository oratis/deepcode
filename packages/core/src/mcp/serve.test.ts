import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFileContract } from '../config/file-contract.js';
import { buildMcpGate, buildMcpServer, MCP_SERVE_EXCLUDE, mcpServableTools } from './serve.js';

/** The gate the existing round-trip tests run under: everything permitted. */
const allowAll = async () => ({ allowed: true, reason: 'test' });

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
    const server = buildMcpServer({
      cwd: dir,
      name: 'deepcode-test',
      version: '9.9.9',
      gate: allowAll,
    });
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

// `mcp serve` hands Read/Write/Edit/Bash to whatever connected. It used to do
// that with no mode, no permission rules, no file contract and no PreToolUse
// hooks — the same shape as the #181 runAgent bypass, in a different entry
// point. `gate` is required so a host cannot omit it by accident.
describe('the gate', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dc-mcp-gate-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function connect(server: ReturnType<typeof buildMcpServer>): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), c.connect(clientTransport)]);
    return c;
  }

  it('refuses a denied call without executing it', async () => {
    const c = await connect(
      buildMcpServer({
        cwd: dir,
        gate: async () => ({ allowed: false, reason: 'denied by permission rules' }),
      }),
    );
    const file = join(dir, 'should-not-exist.txt');
    const res = (await c.callTool({
      name: 'Write',
      arguments: { file_path: file, content: 'x' },
    })) as { content: Array<{ text: string }>; isError?: boolean };

    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/denied by permission rules/);
    await expect(fs.access(file)).rejects.toThrow();
    await c.close();
  });

  it('sees the arguments the peer actually sent', async () => {
    const seen: Array<{ tool: string; input: Record<string, unknown> }> = [];
    const c = await connect(
      buildMcpServer({
        cwd: dir,
        gate: async (req) => {
          seen.push(req);
          return { allowed: true, reason: 'ok' };
        },
      }),
    );
    await c.callTool({ name: 'Read', arguments: { file_path: join(dir, 'x') } });
    expect(seen).toEqual([{ tool: 'Read', input: { file_path: join(dir, 'x') } }]);
    await c.close();
  });
});

describe('buildMcpGate', () => {
  const cwd = '/work/repo';

  it('refuses an `ask`, because nobody is attached to be asked', async () => {
    // Fail-closed, matching an unattended cron run. Granting instead would make
    // "who connected" the authority on what may run.
    const gate = buildMcpGate({ cwd, mode: 'default' });
    const verdict = await gate({ tool: 'Write', input: { file_path: 'a.ts', content: 'x' } });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/no attached user/);
    expect(verdict.reason).toMatch(/permissions.allow/);
  });

  it('allows what settings explicitly allow', async () => {
    const gate = buildMcpGate({
      cwd,
      mode: 'default',
      permissions: { allow: ['Read'] },
    });
    expect((await gate({ tool: 'Read', input: { file_path: 'a.ts' } })).allowed).toBe(true);
  });

  it('honours a file contract deny', async () => {
    const gate = buildMcpGate({
      cwd,
      mode: 'bypassPermissions',
      contract: parseFileContract(
        ['version: 1', 'rules:', '  - glob: "**/.env*"', '    read: deny'].join('\n'),
      ),
    });
    // bypassPermissions cannot waive a contract deny, here as anywhere else.
    const verdict = await gate({ tool: 'Read', input: { file_path: '/work/repo/.env' } });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/file contract/);
  });
});
