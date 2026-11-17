import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { access, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent, type RunAgentOptions } from '../agent.js';
import { parseFileContract } from '../config/file-contract.js';
import { HookDispatcher } from '../hooks/dispatcher.js';
import { buildMcpGate, buildMcpServer } from '../mcp/serve.js';
import { createPluginCapabilityBridge } from '../plugins/capability-bridge.js';
import { SessionManager } from '../sessions/manager.js';
import { NotebookEditTool } from '../tools/notebook.js';
import { ReadTool } from '../tools/read.js';
import { WriteTool } from '../tools/write.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolResult } from '../types.js';
import { ToolExecutionBinding, ToolExecutionService } from './tool-execution.js';
import { createEngineToolRunner } from './tool-runner.js';

const sources = ['native', 'sdk', 'plugin', 'mcp', 'service'] as const;
type Source = (typeof sources)[number];
const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 };
let root: string;
let cwd: string;
let options: RunAgentOptions;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dc-h01-'));
  cwd = join(root, 'work');
  await mkdir(cwd);
  options = {
    cwd,
    tools: new ToolRegistry([ReadTool, WriteTool]),
    mode: 'bypassPermissions',
    model: 'fixture',
    systemPrompt: '',
    systemReminders: false,
    provider: {
      name: 'fixture',
      runTurn: async () => ({ content: [], stopReason: 'end_turn', usage }),
    },
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function invoke(
  source: Source,
  input: Record<string, unknown> = { file_path: 'target', content: 'after' },
): Promise<ToolResult> {
  if (source === 'native') {
    let called = false;
    const result = await runAgent({
      ...options,
      provider: {
        name: 'fixture',
        runTurn: async () => {
          if (called) return { content: [], stopReason: 'end_turn', usage };
          called = true;
          return {
            content: [{ type: 'tool_use', id: 'call', name: 'Write', input }],
            stopReason: 'tool_use',
            usage,
          };
        },
      },
    });
    const block = result.history
      .flatMap((message) => message.content)
      .find((item) => item.type === 'tool_result');
    if (block?.type !== 'tool_result') throw new Error(result.stopReason);
    return { content: String(block.content), isError: block.is_error };
  }
  if (source === 'mcp') {
    const server = buildMcpServer({
      cwd,
      gate: buildMcpGate(options),
      tools: options.tools.list(),
      signal: options.signal,
      sandboxConfig: options.sandboxConfig,
      execution: options,
    });
    const client = new Client({ name: 'fixture', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const result = await client.callTool({ name: 'Write', arguments: input });
      return { content: JSON.stringify(result.content), isError: result.isError as boolean };
    } finally {
      await server.close();
      await client.close();
    }
  }
  const service = new ToolExecutionService(options);
  try {
    if (source === 'sdk')
      return await createEngineToolRunner({ ...options, toolExecution: service }).run(
        'Write',
        input,
        'call',
      );
    if (source === 'plugin') {
      const binding = new ToolExecutionBinding();
      const release = binding.bind(service);
      try {
        await createPluginCapabilityBridge(binding).fs_write(
          String(input.file_path),
          String(input.content),
        );
        return { content: 'ok' };
      } catch (error) {
        return { content: (error as Error).message, isError: true };
      } finally {
        release();
      }
    }
    return await service.run('Write', input, 'call');
  } finally {
    await service.close();
  }
}

describe.each(sources)('%s shared execution boundary', (source) => {
  it.each(['plan', 'deny', 'contract', 'read-only', 'unattended'] as const)(
    'refuses %s without a write',
    async (reason) => {
      if (reason === 'plan') options.mode = 'plan';
      if (reason === 'deny') {
        options.mode = 'default';
        options.permissions = { deny: ['Write'] };
      }
      if (reason === 'contract')
        options.contract = parseFileContract(
          'version: 1\nrules:\n  - glob: target\n    write: deny',
        );
      if (reason === 'read-only') options.sandboxConfig = { mode: 'read-only' };
      if (reason === 'unattended') {
        options.mode = 'default';
        options.unattended = true;
      }
      const result = await invoke(source);
      expect(result.isError).toBe(true);
      await expect(access(join(cwd, 'target'))).rejects.toThrow();
    },
  );
  it('rejects writes through a symlink outside the writable workspace', async () => {
    await symlink(root, join(cwd, 'escape'));
    expect((await invoke(source, { file_path: 'escape/outside', content: 'bad' })).isError).toBe(
      true,
    );
    await expect(access(join(root, 'outside'))).rejects.toThrow();
  });
  it('honors a denying hook even in bypass mode', async () => {
    options.hooks = new HookDispatcher({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'exit 1' }] }] },
    });
    expect((await invoke(source)).isError).toBe(true);
    await expect(access(join(cwd, 'target'))).rejects.toThrow();
  });
  it('does not let an auto-mode allow skip PreToolUse hooks', async () => {
    options.mode = 'auto';
    options.autoMode = { allow: ['Write'] };
    options.hooks = new HookDispatcher({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'exit 1' }] }] },
    });
    expect((await invoke(source)).isError).toBe(true);
    await expect(access(join(cwd, 'target'))).rejects.toThrow();
  });
  it('bounds and persists oversized output before projecting results', async () => {
    const content = 'x'.repeat(4096);
    options.tools = new ToolRegistry([{ ...WriteTool, execute: async () => ({ content }) }]);
    const saveText = vi.fn(async () => ({
      locator: 'fixture-result',
      bytes: 4096,
      retrievalHint: 'Read the fixture artifact',
    }));
    options.spillStore = { saveText };
    options.spillThresholdChars = 256;
    const events = vi.fn();
    options.onEvent = events;
    await invoke(source);
    expect(saveText).toHaveBeenCalledWith(expect.objectContaining({ content }));
    const result = events.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'tool_result');
    expect(result.result.content.length).toBeLessThan(content.length);
    expect(result.result.content).toContain('fixture-result');
  });
  it('honors cancellation before admission', async () => {
    options.signal = AbortSignal.abort();
    const result = await invoke(source).catch(() => ({ content: 'aborted', isError: true }));
    expect(result.isError).toBe(true);
    await expect(access(join(cwd, 'target'))).rejects.toThrow();
  });
  it('aborts and drains a cooperative tool deadline', async () => {
    let stopped = false;
    options.tools = new ToolRegistry([
      {
        ...WriteTool,
        execute: async (_input, ctx) =>
          new Promise((resolve) => {
            ctx.signal!.addEventListener(
              'abort',
              () => {
                stopped = true;
                resolve({ content: 'stopped' });
              },
              { once: true },
            );
          }),
      },
    ]);
    options.toolDeadlines = { defaultMs: 5 };
    expect((await invoke(source)).isError).toBe(true);
    expect(stopped).toBe(true);
  });
  it('settles snapshots and ledger through the same service', async () => {
    const manager = new SessionManager({ root: join(root, 'sessions') });
    const session = await manager.create(cwd);
    options.session = { manager, id: session.id, turnId: 'turn' };
    const append = vi.fn(async () => null);
    options.ledger = { append };
    await writeFile(join(cwd, 'target'), 'before');
    expect((await invoke(source)).isError ?? false).toBe(false);
    expect(await readFile(join(cwd, 'target'), 'utf8')).toBe('after');
    const snapshots = await manager.snapshots(session.id);
    expect(snapshots.map((s) => s.reason)).toEqual(['pre-Write', 'post-Write']);
    expect(await readFile(snapshots[0]!.blobPath, 'utf8')).toBe('before');
    expect(append).toHaveBeenCalledOnce();
  });
});

describe.each(['service', 'sdk', 'mcp'] as const)('%s request cancellation', (source) => {
  it.each(['PreToolUse', 'PostToolUse'] as const)(
    'revokes a nested MCP hook during %s',
    async (event) => {
      const controller = new AbortController();
      const entered = Promise.withResolvers<AbortSignal>();
      const release = Promise.withResolvers<void>();
      let wrote = false;
      const hooks = new HookDispatcher({
        hooks: {
          [event]: [
            { matcher: 'Read', hooks: [{ type: 'mcp_tool', server: 'fixture', tool: 'write' }] },
          ],
        },
      });
      const tools = new ToolRegistry([
        { ...ReadTool, execute: async () => ({ content: 'read' }) },
        {
          name: 'mcp__fixture__write',
          definition: { name: 'mcp__fixture__write', description: '', inputSchema: {} },
          execute: async (_input, context) => {
            entered.resolve(context.signal!);
            await release.promise;
            context.signal!.throwIfAborted();
            wrote = true;
            return { content: 'written' };
          },
        },
      ]);
      const executionOptions = { ...options, hooks, tools };
      let close: () => Promise<unknown>;
      let work: Promise<unknown>;
      if (source === 'mcp') {
        const server = buildMcpServer({
          cwd,
          gate: buildMcpGate(executionOptions),
          tools: tools.list(),
        });
        const client = new Client({ name: 'fixture', version: '1' });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await Promise.all([server.connect(a), client.connect(b)]);
        close = async () => {
          await server.close();
          await client.close();
        };
        work = client.callTool({ name: 'Read', arguments: {} }, undefined, {
          signal: controller.signal,
        });
      } else {
        const service = new ToolExecutionService(executionOptions);
        close = () => service.close();
        work =
          source === 'sdk'
            ? createEngineToolRunner({
                ...executionOptions,
                toolExecution: service,
                signal: controller.signal,
              }).run('Read', {}, 'request')
            : service.run('Read', {}, 'request', controller.signal);
      }
      const outcome = work.catch((error: unknown) => error);
      try {
        const nestedSignal = await entered.promise;
        controller.abort();
        await expect.poll(() => nestedSignal.aborted).toBe(true);
      } finally {
        release.resolve();
        await outcome;
        await close();
      }
      expect(wrote).toBe(false);
    },
  );
});

it('fails closed when an MCP hook decision exceeds the spill ceiling', async () => {
  const execute = vi.fn(async () => ({ content: 'should not execute' }));
  const service = new ToolExecutionService({
    ...options,
    spillThresholdChars: 128,
    hooks: new HookDispatcher({
      hooks: {
        PreToolUse: [
          { matcher: 'Write', hooks: [{ type: 'mcp_tool', server: 'fixture', tool: 'check' }] },
        ],
      },
    }),
    tools: new ToolRegistry([
      { ...WriteTool, execute },
      {
        name: 'mcp__fixture__check',
        definition: { name: 'mcp__fixture__check', description: '', inputSchema: {} },
        execute: async () => ({
          content: JSON.stringify({ decision: 'deny', additionalContext: 'x'.repeat(1024) }),
        }),
      },
    ]),
  });
  try {
    expect(
      (await service.run('Write', { file_path: 'target', content: 'forbidden' }, 'call')).isError,
    ).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await service.close();
  }
});

it('passes request cancellation to an agent hook', async () => {
  const controller = new AbortController();
  const entered = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  const service = new ToolExecutionService({
    ...options,
    hooks: new HookDispatcher({
      hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'agent', agent: 'fixture' }] }] },
    }),
  });
  service.setRuntimeContext({
    runSubAgent: async ({ signal }) => {
      entered.resolve(signal!);
      await release.promise;
      signal!.throwIfAborted();
      return { text: '', turnsUsed: 0, agentType: 'fixture' };
    },
  });
  const work = service
    .run('Read', {}, 'request', controller.signal)
    .catch((error: unknown) => error);
  try {
    const nestedSignal = await entered.promise;
    controller.abort();
    expect(nestedSignal.aborted).toBe(true);
  } finally {
    release.resolve();
    await work;
    await service.close();
  }
});

describe('execution lifecycle and admission', () => {
  it('snapshots NotebookEdit using its notebook_path and records a real rollback image', async () => {
    const before = JSON.stringify({
      cells: [{ cell_type: 'code', id: 'one', source: ['before'] }],
    });
    await writeFile(join(cwd, 'work.ipynb'), before);
    const manager = new SessionManager({ root: join(root, 'sessions') });
    const session = await manager.create(cwd);
    const service = new ToolExecutionService({
      ...options,
      tools: new ToolRegistry([NotebookEditTool]),
      session: { manager, id: session.id },
    });
    try {
      expect(
        (
          await service.run(
            'NotebookEdit',
            { notebook_path: 'work.ipynb', cell_id: 'one', new_source: 'after' },
            'nb',
          )
        ).isError,
      ).toBeFalsy();
      const snapshots = await manager.snapshots(session.id);
      expect(snapshots.map((snapshot) => snapshot.reason)).toEqual([
        'pre-NotebookEdit',
        'post-NotebookEdit',
      ]);
      expect(await readFile(snapshots[0]!.blobPath, 'utf8')).toBe(before);
      expect(await readFile(snapshots[1]!.blobPath, 'utf8')).toContain('after');
    } finally {
      await service.close();
    }
  });
  it('freezes approved arguments, checks the path again, and consumes admission once', async () => {
    await mkdir(join(cwd, 'inside'));
    await symlink(join(cwd, 'inside'), join(cwd, 'link'));
    const input = { file_path: 'link/target', content: 'approved' };
    const service = new ToolExecutionService(options);
    try {
      const call = await service.prepare('Write', input, 'call');
      input.content = 'unapproved';
      expect(call.input.content).toBe('approved');
      await unlink(join(cwd, 'link'));
      await symlink(root, join(cwd, 'link'));
      expect((await service.execute(call)).isError).toBe(true);
      await expect(service.execute(call)).rejects.toThrow(/consumed/);
      await expect(service.execute({ id: 'forged', name: 'Write', input })).rejects.toThrow(
        /Invalid/,
      );
      await expect(access(join(root, 'target'))).rejects.toThrow();
    } finally {
      await service.close();
    }
  });
  it('cancels pending approval and never executes after a late approval', async () => {
    const controller = new AbortController();
    let approve!: (value: boolean) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const service = new ToolExecutionService({
      ...options,
      mode: 'default',
      signal: controller.signal,
      approval: () => {
        started();
        return new Promise((resolve) => {
          approve = resolve;
        });
      },
    });
    const work = service.run('Write', { file_path: 'target', content: 'bad' }, 'call');
    const rejected = expect(work).rejects.toThrow();
    await ready;
    controller.abort();
    await rejected;
    approve(true);
    await service.close();
    await expect(access(join(cwd, 'target'))).rejects.toThrow();
  });
  it('SDK projection and its private cancellation reach a host-owned executor', async () => {
    const events = vi.fn();
    const controller = new AbortController();
    const service = new ToolExecutionService(options);
    const runner = createEngineToolRunner({
      ...options,
      toolExecution: service,
      onEvent: events,
      signal: controller.signal,
    });
    await runner.run('Read', { file_path: 'missing' }, 'read');
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(['tool_use', 'tool_result']);
    controller.abort();
    await expect(
      runner.run('Write', { file_path: 'target', content: 'bad' }, 'write'),
    ).rejects.toThrow();
    await service.close();
  });
  it('drains cooperative deadlines and quarantines uncooperative handlers', async () => {
    const tools = new ToolRegistry([
      {
        ...ReadTool,
        execute: async (_input, ctx) =>
          new Promise((resolve) => {
            ctx.signal!.addEventListener('abort', () => resolve({ content: 'stopped' }), {
              once: true,
            });
          }),
      },
    ]);
    const service = new ToolExecutionService({
      ...options,
      tools,
      toolDeadlines: { defaultMs: 5 },
    });
    expect((await service.run('Read', {}, 'timeout')).isError).toBe(true);
    await service.close();
    const stuck = new ToolExecutionService({
      ...options,
      tools: new ToolRegistry([{ ...ReadTool, execute: () => new Promise(() => {}) }]),
      toolDeadlines: { defaultMs: 5 },
    });
    await expect(stuck.run('Read', {}, 'stuck')).rejects.toThrow(/cleanup_incomplete/);
    await expect(stuck.run('Read', {}, 'later')).rejects.toThrow(/cleanup_incomplete/);
    await expect(stuck.close()).rejects.toThrow(/cleanup_incomplete/);
  }, 5000);
  it('binds each plugin call to the current turn, refuses ambiguous scopes and revokes old scopes', async () => {
    const binding = new ToolExecutionBinding();
    const bridge = createPluginCapabilityBridge(binding);
    await expect(bridge.fs_write('target', 'bad')).rejects.toThrow(/outside/);
    const first = new ToolExecutionService(options);
    const releaseFirst = binding.bind(first);
    const second = new ToolExecutionService({ ...options, mode: 'plan' });
    const releaseSecond = binding.bind(second);
    await expect(bridge.fs_write('target', 'bad')).rejects.toThrow(/ambiguous/);
    releaseFirst();
    await first.close();
    await expect(bridge.fs_write('target', 'bad')).rejects.toThrow(/mode=plan/);
    releaseSecond();
    await second.close();
    await expect(bridge.fs_read('target')).rejects.toThrow(/outside/);
  });
  it('enforces the runtime policy over a custom hook dispatcher', async () => {
    const bypass = vi.fn(async () => ({ stdout: 'bypassed', stderr: '', exitCode: 0 }));
    const hooks = new HookDispatcher({
      mcpToolDispatcher: bypass,
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'mcp_tool', server: 'unknown', tool: 'write' }] }],
      },
    });
    const service = new ToolExecutionService({ ...options, hooks });
    const result = await service.withScope(() =>
      hooks.dispatch({ event: 'UserPromptSubmit', cwd, triggeredAt: '', payload: {} }),
    );
    expect(result.anyBlocked).toBe(true);
    expect(bypass).not.toHaveBeenCalled();
    await service.close();
  });
  it('MCP hook dispatch uses the active policy across turns and blocks recursive hooks', async () => {
    const execute = vi.fn(async () => ({ content: 'ran' }));
    const tool = {
      name: 'mcp__fixture__run',
      definition: { name: 'mcp__fixture__run', description: '', inputSchema: {} },
      execute,
    };
    const hooks = new HookDispatcher({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'mcp_tool', server: 'fixture', tool: 'run' }] }],
      },
    });
    for (const mode of ['bypassPermissions', 'plan'] as const) {
      const service = new ToolExecutionService({
        ...options,
        tools: new ToolRegistry([tool]),
        hooks,
        mode,
      });
      await service.withScope(() =>
        hooks.dispatch({ event: 'UserPromptSubmit', cwd, triggeredAt: '', payload: {} }),
      );
      await service.close();
    }
    expect(execute).toHaveBeenCalledOnce();
    hooks.mergeHooks({
      PreToolUse: [{ hooks: [{ type: 'mcp_tool', server: 'fixture', tool: 'run' }] }],
    });
    const service = new ToolExecutionService({
      ...options,
      tools: new ToolRegistry([tool]),
      hooks,
    });
    expect((await service.run(tool.name, {}, 'recursive')).isError).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    await service.close();
  });
});
