import { describe, expect, it } from 'vitest';
import { ToolRegistry } from './registry.js';
import {
  installToolSearch,
  makeToolSearchTool,
  RegistryDeferredStore,
  type DeferredToolEntry,
} from './tool-search.js';
import type { ToolHandler } from '../types.js';

function fakeHandler(name: string, description = ''): ToolHandler {
  return {
    name,
    definition: { name, description, inputSchema: { type: 'object' } },
    async execute() {
      return { content: `ran ${name}` };
    },
  };
}

function entry(name: string, description: string): DeferredToolEntry {
  return {
    name,
    description,
    expand: () => fakeHandler(name, description),
  };
}

describe('ToolSearch keyword query', () => {
  it('returns sorted matches with a "select:" hint', async () => {
    const reg = new ToolRegistry([]);
    const store = new RegistryDeferredStore(reg, [
      entry('mcp__slack__send', 'Send a message to Slack'),
      entry('mcp__gmail__draft', 'Draft a Gmail email'),
      entry('mcp__notion__page', 'Create a Notion page'),
    ]);
    const search = makeToolSearchTool(store);
    const r = await search.execute({ query: 'slack' }, { cwd: '/x' });
    expect(r.content).toContain('mcp__slack__send');
    expect(r.content).toContain('select:mcp__slack__send');
  });

  it('returns "no matched" when nothing scores', async () => {
    const reg = new ToolRegistry([]);
    const store = new RegistryDeferredStore(reg, [entry('foo', 'bar')]);
    const search = makeToolSearchTool(store);
    const r = await search.execute({ query: 'zzz-no-such' }, { cwd: '/x' });
    expect(r.content).toMatch(/No deferred tools matched/);
  });

  it('caps results at max_results', async () => {
    const reg = new ToolRegistry([]);
    const entries: DeferredToolEntry[] = [];
    for (let i = 0; i < 20; i++) entries.push(entry(`tool${i}`, 'common-word common'));
    const store = new RegistryDeferredStore(reg, entries);
    const search = makeToolSearchTool(store);
    const r = await search.execute({ query: 'common', max_results: 3 }, { cwd: '/x' });
    const data = r.data as { hits: unknown[] };
    expect(data.hits).toHaveLength(3);
  });
});

describe('ToolSearch select: query', () => {
  it('loads named tools into the registry', async () => {
    const reg = new ToolRegistry([]);
    const store = new RegistryDeferredStore(reg, [entry('A', 'desc A'), entry('B', 'desc B')]);
    const search = makeToolSearchTool(store);
    const r = await search.execute({ query: 'select:A,B' }, { cwd: '/x' });
    expect(r.content).toMatch(/Loaded: A, B/);
    expect(reg.get('A')).toBeDefined();
    expect(reg.get('B')).toBeDefined();
  });

  it('reports missing tools without failing', async () => {
    const reg = new ToolRegistry([]);
    const store = new RegistryDeferredStore(reg, [entry('A', 'a')]);
    const search = makeToolSearchTool(store);
    const r = await search.execute({ query: 'select:A,DoesNotExist' }, { cwd: '/x' });
    expect(r.content).toMatch(/Loaded: A/);
    expect(r.content).toMatch(/Not found: DoesNotExist/);
  });

  it('is idempotent — second select: doesnt double-register', async () => {
    const reg = new ToolRegistry([]);
    const store = new RegistryDeferredStore(reg, [entry('A', 'a')]);
    const search = makeToolSearchTool(store);
    await search.execute({ query: 'select:A' }, { cwd: '/x' });
    const r2 = await search.execute({ query: 'select:A' }, { cwd: '/x' });
    expect(r2.content).toMatch(/Loaded: A/);
  });

  it('errors on empty query', async () => {
    const reg = new ToolRegistry([]);
    const store = new RegistryDeferredStore(reg, []);
    const search = makeToolSearchTool(store);
    const r = await search.execute({ query: '' }, { cwd: '/x' });
    expect(r.isError).toBe(true);
  });
});

describe('installToolSearch', () => {
  it('registers ToolSearch + defers tools that load on select:', async () => {
    const reg = new ToolRegistry([]);
    const names = installToolSearch(reg, [
      {
        name: 'mcp__db__query',
        description: 'run a SQL query',
        expand: () => fakeHandler('mcp__db__query'),
      },
    ]);
    expect(names).toEqual(['mcp__db__query']);
    // ToolSearch is registered; the deferred tool is NOT yet callable.
    expect(reg.get('ToolSearch')).toBeDefined();
    expect(reg.get('mcp__db__query')).toBeUndefined();
    // Load it via the tool, then it's callable.
    const ts = reg.get('ToolSearch')!;
    const r = await ts.execute({ query: 'select:mcp__db__query' }, { cwd: '/x' });
    expect((r.data as { loaded: string[] }).loaded).toEqual(['mcp__db__query']);
    expect(reg.get('mcp__db__query')).toBeDefined();
  });

  it('is a no-op (no ToolSearch) when there are no deferred tools', () => {
    const reg = new ToolRegistry([]);
    expect(installToolSearch(reg, [])).toEqual([]);
    expect(reg.get('ToolSearch')).toBeUndefined();
  });
});
