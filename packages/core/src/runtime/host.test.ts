import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Provider, ProviderResult, ProviderRunOpts } from '../providers/types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolHandler } from '../types.js';
import { RuntimeHost } from './host.js';

class ScriptedProvider implements Provider {
  readonly name = 'scripted';
  constructor(private readonly results: ProviderResult[]) {}
  async runTurn(_opts: ProviderRunOpts): Promise<ProviderResult> {
    const result = this.results.shift();
    if (!result) throw new Error('no scripted result');
    return result;
  }
}

const usage = { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0 };

function writeThenDone(): ProviderResult[] {
  return [
    {
      content: [
        {
          type: 'tool_use',
          id: 'write-1',
          name: 'Write',
          input: { file_path: 'x', content: 'x' },
        },
      ],
      stopReason: 'tool_use',
      usage,
    },
    {
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
      usage,
    },
  ];
}

describe('RuntimeHost', () => {
  it('fails closed when the host omits policy and approval', async () => {
    let executions = 0;
    const write: ToolHandler = {
      name: 'Write',
      definition: { name: 'Write', description: 'test', inputSchema: {} },
      execute: async () => {
        executions++;
        return { content: 'wrote' };
      },
    };
    const host = new RuntimeHost({
      provider: new ScriptedProvider(writeThenDone()),
      tools: new ToolRegistry([write]),
      cwd: '/tmp',
    });

    const result = await host.run({
      systemPrompt: '',
      userMessage: 'write',
      model: 'deepseek-chat',
      systemReminders: false,
    });

    expect(executions).toBe(0);
    expect(result.history.flatMap((message) => message.content)).toContainEqual(
      expect.objectContaining({ type: 'tool_result', is_error: true }),
    );
  });

  it('keeps host policy while accepting an explicit turn mode override', async () => {
    let executions = 0;
    const write: ToolHandler = {
      name: 'Write',
      definition: { name: 'Write', description: 'test', inputSchema: {} },
      execute: async () => {
        executions++;
        return { content: 'wrote' };
      },
    };
    const host = new RuntimeHost({
      provider: new ScriptedProvider(writeThenDone()),
      tools: new ToolRegistry([write]),
      cwd: '/tmp',
      mode: 'default',
    });

    await host.run({
      systemPrompt: '',
      userMessage: 'write',
      model: 'deepseek-chat',
      systemReminders: false,
      modeOverride: 'bypassPermissions',
    });

    expect(executions).toBe(1);
    expect(host.mode).toBe('default');
  });

  it('requires a cwd at either boundary', () => {
    const host = new RuntimeHost({
      provider: new ScriptedProvider([]),
      tools: new ToolRegistry(),
    });
    expect(() => host.run({ systemPrompt: '', userMessage: 'x', model: 'deepseek-chat' })).toThrow(
      /requires cwd/,
    );
  });
});

describe('RuntimeHost — file contract', () => {
  /** A workspace with a contract that denies writing to the given glob. */
  async function workspaceDenying(glob: string): Promise<{ cwd: string; home: string }> {
    const cwd = await mkdtemp(join(tmpdir(), 'dc-host-contract-'));
    const home = await mkdtemp(join(tmpdir(), 'dc-host-home-'));
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(
      join(cwd, '.deepcode', 'file-contract.yaml'),
      `version: 1\nrules:\n  - glob: "${glob}"\n    write: deny\n    reason: "not this one"\n`,
    );
    return { cwd, home };
  }

  function countingWrite(): { handler: ToolHandler; count: () => number } {
    let executions = 0;
    return {
      handler: {
        name: 'Write',
        definition: { name: 'Write', description: 'w', inputSchema: { type: 'object' } },
        async execute() {
          executions++;
          return { content: 'written' };
        },
      },
      count: () => executions,
    };
  }

  it('loads the contract itself, so a client passing nothing still gets it', async () => {
    // The point of doing this in the host: four clients each remembering an
    // optional argument is the shape AGENTS.md rules out for a tool gate.
    const { cwd, home } = await workspaceDenying('x');
    const write = countingWrite();
    try {
      const host = new RuntimeHost({
        provider: new ScriptedProvider(writeThenDone()),
        tools: new ToolRegistry([write.handler]),
        cwd,
        home,
        mode: 'bypassPermissions',
      });
      await host.run({ systemPrompt: '', userMessage: 'go', history: [], model: 'm' });
      expect(write.count()).toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it('lets the write through when the contract does not cover it', async () => {
    const { cwd, home } = await workspaceDenying('some-other-file');
    const write = countingWrite();
    try {
      const host = new RuntimeHost({
        provider: new ScriptedProvider(writeThenDone()),
        tools: new ToolRegistry([write.handler]),
        cwd,
        home,
        mode: 'bypassPermissions',
      });
      await host.run({ systemPrompt: '', userMessage: 'go', history: [], model: 'm' });
      expect(write.count()).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it('reports the sandbox-off warning through the host', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dc-host-warn-'));
    const home = await mkdtemp(join(tmpdir(), 'dc-host-warn-home-'));
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(
      join(cwd, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "**/.env*"\n    read: deny\n',
    );
    try {
      const host = new RuntimeHost({
        provider: new ScriptedProvider([]),
        tools: new ToolRegistry([]),
        cwd,
        home,
        mode: 'default',
        sandboxDefaultMode: 'danger-full-access',
      });
      const warnings = await host.contractWarnings();
      expect(warnings.join('\n')).toContain('sandbox is off');
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it('is silent and inert in a workspace with no contract', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dc-host-none-'));
    const home = await mkdtemp(join(tmpdir(), 'dc-host-none-home-'));
    const write = countingWrite();
    try {
      const host = new RuntimeHost({
        provider: new ScriptedProvider(writeThenDone()),
        tools: new ToolRegistry([write.handler]),
        cwd,
        home,
        mode: 'bypassPermissions',
      });
      expect(await host.contractWarnings()).toEqual([]);
      await host.run({ systemPrompt: '', userMessage: 'go', history: [], model: 'm' });
      expect(write.count()).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});
