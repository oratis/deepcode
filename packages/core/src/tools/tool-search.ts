// ToolSearch tool — deferred-tool loading. Lets the agent discover and
// "expand" tools that aren't loaded by default (large MCP toolkits, computer-
// use tools, etc.) without bloating the system prompt with their full schema.
//
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.6
//
// Wire-up:
//   · ToolRegistry tracks a `deferred` map of name → { description, expand() }.
//   · Agent loop exposes ONLY the deferred-tool names (not schemas) until
//     ToolSearch is called with `select:Name1,Name2,...`.
//   · The tool returns the schemas and asks the registry to register them.

import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

export interface DeferredToolEntry {
  name: string;
  description: string;
  /** Lazily produce the full ToolHandler when the tool is "expanded". */
  expand: () => Promise<ToolHandler> | ToolHandler;
}

export interface DeferredToolStore {
  /** Returns all deferred entries (for keyword search). */
  list(): DeferredToolEntry[];
  /** Expand and register an entry; idempotent on already-registered names. */
  expand(name: string): Promise<ToolHandler | undefined>;
}

interface SearchInput {
  query: string;
  max_results?: number;
}

const DEFAULT_MAX_RESULTS = 5;

export function makeToolSearchTool(store: DeferredToolStore): ToolHandler {
  return {
    name: 'ToolSearch',
    definition: {
      name: 'ToolSearch',
      description:
        'Find and load deferred tools by name or keyword. Use "select:Name1,Name2" to load tools by exact name; otherwise the query is matched as a fuzzy keyword search against tool names and descriptions. Once loaded, the tools become callable in subsequent turns.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Either "select:<csv of tool names>" or a free-text query matching name+description.',
          },
          max_results: {
            type: 'number',
            description: 'Cap on results for keyword queries (default 5).',
          },
        },
        required: ['query'],
      },
    },
    async execute(rawInput: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const input = rawInput as unknown as SearchInput;
      if (!input?.query || typeof input.query !== 'string') {
        return { content: 'Error: query is required (string).', isError: true };
      }
      const max = Math.max(1, input.max_results ?? DEFAULT_MAX_RESULTS);

      if (input.query.startsWith('select:')) {
        const names = input.query
          .slice('select:'.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const loaded: string[] = [];
        const missing: string[] = [];
        for (const n of names) {
          const h = await store.expand(n);
          if (h) loaded.push(h.name);
          else missing.push(n);
        }
        const lines: string[] = [];
        if (loaded.length > 0) lines.push(`Loaded: ${loaded.join(', ')}`);
        if (missing.length > 0) lines.push(`Not found: ${missing.join(', ')}`);
        if (lines.length === 0) lines.push('No tools loaded.');
        return { content: lines.join('\n'), data: { loaded, missing } };
      }

      // Keyword search — rank by token overlap of name + description
      const tokens = input.query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);
      const ranked = store
        .list()
        .map((e) => ({ entry: e, score: score(e, tokens) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max);
      if (ranked.length === 0) {
        return { content: `No deferred tools matched "${input.query}".`, data: { hits: [] } };
      }
      const lines = ranked.map((r) => `${r.entry.name} — ${r.entry.description.slice(0, 120)}`);
      lines.push('');
      lines.push(`Use \`select:${ranked.map((r) => r.entry.name).join(',')}\` to load.`);
      return {
        content: lines.join('\n'),
        data: { hits: ranked.map((r) => ({ name: r.entry.name, score: r.score })) },
      };
    },
  };
}

function score(entry: DeferredToolEntry, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const text = `${entry.name} ${entry.description}`.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (entry.name.toLowerCase() === t) s += 100;
    else if (entry.name.toLowerCase().includes(t)) s += 10;
    if (text.includes(t)) s += 1;
  }
  return s;
}

/**
 * Default DeferredToolStore backed by a ToolRegistry. Builds an internal map
 * of name → entry on construction; expand() calls registry.register().
 */
/** Minimal registry surface installToolSearch needs. */
export interface ToolSearchRegistry {
  register: (h: ToolHandler) => void;
  get: (name: string) => ToolHandler | undefined;
}

/**
 * Wire a set of deferred tools behind a ToolSearch tool registered into
 * `registry`. The deferred tools are NOT in the registry until the agent loads
 * them via ToolSearch (`select:Name` or keyword search). No-op (returns []) when
 * `deferred` is empty — there's nothing to search, so ToolSearch isn't added.
 * Returns the deferred tool names (for surfacing to the user/model).
 */
export function installToolSearch(
  registry: ToolSearchRegistry,
  deferred: DeferredToolEntry[],
): string[] {
  if (deferred.length === 0) return [];
  const store = new RegistryDeferredStore(registry, deferred);
  registry.register(makeToolSearchTool(store));
  return deferred.map((e) => e.name);
}

export class RegistryDeferredStore implements DeferredToolStore {
  private readonly entries = new Map<string, DeferredToolEntry>();
  constructor(
    private readonly registry: {
      register: (h: ToolHandler) => void;
      get: (name: string) => ToolHandler | undefined;
    },
    entries: DeferredToolEntry[],
  ) {
    for (const e of entries) this.entries.set(e.name, e);
  }
  list(): DeferredToolEntry[] {
    return [...this.entries.values()];
  }
  async expand(name: string): Promise<ToolHandler | undefined> {
    const existing = this.registry.get(name);
    if (existing) return existing;
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    const handler = await entry.expand();
    this.registry.register(handler);
    return handler;
  }
}
