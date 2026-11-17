import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../sessions/manager.js';
import { RuntimeHost } from './host.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolExecutionService } from './tool-execution.js';
import type { RunAgentOptions } from '../agent.js';
let root: string;
let manager: SessionManager;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dc-journal-boundary-'));
  manager = new SessionManager({ root: join(root, 'sessions') });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 };
it('flushes input, approvals and intent before effects, then results and terminal before returning', async () => {
  const session = await manager.create(root);
  let step = 0;
  const types = async () => (await manager.journal(session.id).read())!.map((event) => event.type);
  const host = new RuntimeHost({
    cwd: root,
    disableLedger: true,
    mode: 'default',
    provider: {
      name: 'fixture',
      runTurn: async () => {
        expect(await types()).toContain('input.accepted');
        return {
          content:
            step++ === 0
              ? [
                  {
                    type: 'tool_use',
                    id: 'call',
                    name: 'Write',
                    input: { file_path: join(root, 'target') },
                  },
                ]
              : [],
          stopReason: step === 1 ? 'tool_use' : 'end_turn',
          usage,
        };
      },
    },
    tools: new ToolRegistry([
      {
        name: 'Write',
        definition: { name: 'Write', description: '', inputSchema: {} },
        execute: async () => {
          expect(await types()).toEqual(
            expect.arrayContaining(['approval.decided', 'tool.intent']),
          );
          await expect(
            new SessionManager({ root: manager.root }).append(session.id, {
              role: 'user',
              content: [],
            }),
          ).resolves.toBeUndefined(); // same async ownership scope, not a competing host
          return { content: 'done' };
        },
      },
    ]),
    approval: async () => {
      expect(await types()).toContain('approval.requested');
      return true;
    },
  });
  await host.run({
    model: 'fixture',
    systemPrompt: '',
    userMessage: 'write',
    session: { manager, id: session.id },
    systemReminders: false,
  });
  const events = (await manager.journal(session.id).read())!;
  expect(events.at(-1)?.type).toBe('turn.finished');
  expect(events.find((event) => event.type === 'tool.result')?.callId).toBe('call');
  expect(new Set(events.slice(1).map((event) => event.runEpoch)).size).toBe(1);
  await host.close();
});
it('journal failure before intent prevents execution; settlement failure rejects the run', async () => {
  const session = await manager.create(root);
  const execute = vi.fn(async () => ({ content: 'written' }));
  const options: RunAgentOptions = {
    provider: {
      name: 'fixture',
      runTurn: async () => ({ content: [], stopReason: 'end_turn', usage }),
    },
    tools: new ToolRegistry([
      { name: 'Write', definition: { name: 'Write', description: '', inputSchema: {} }, execute },
    ]),
    cwd: root,
    model: 'fixture',
    mode: 'bypassPermissions',
    systemPrompt: '',
    session: { manager, id: session.id },
  };
  const original = manager.record.bind(manager);
  const record = vi.spyOn(manager, 'record').mockImplementation(async (id, events) => {
    if (events.some((event) => event.type === 'tool.intent'))
      throw new Error('journal unavailable');
    return original(id, events);
  });
  const service = new ToolExecutionService(options);
  await expect(service.run('Write', { file_path: join(root, 'target') }, 'one')).rejects.toThrow(
    'journal unavailable',
  );
  expect(execute).not.toHaveBeenCalled();
  record.mockImplementation(async (id, events) => {
    if (events.some((event) => event.type === 'tool.result'))
      throw new Error('settlement unavailable');
    return original(id, events);
  });
  await expect(service.run('Write', { file_path: join(root, 'target') }, 'two')).rejects.toThrow(
    'settlement unavailable',
  );
  expect(execute).toHaveBeenCalledTimes(1);
  await service.close();
});

it('re-enters the session writer for transport callbacks and revokes it when the turn ends', async () => {
  const { AsyncResource } = await import('node:async_hooks');
  const { ToolExecutionBinding } = await import('./tool-execution.js');
  const transport = new AsyncResource('outside-turn-rpc');
  const session = await manager.create(root);
  const binding = new ToolExecutionBinding();
  let execution!: ToolExecutionService;
  await manager.withWriter(session.id, async () => {
    execution = new ToolExecutionService({
      cwd: root,
      mode: 'bypassPermissions',
      session: { manager, id: session.id },
      tools: new ToolRegistry([
        {
          name: 'fixture',
          definition: { name: 'fixture', description: '', inputSchema: {} },
          execute: async () => ({ content: 'ok' }),
        },
      ]),
    });
    binding.bind(execution);
    const result = await transport.runInAsyncScope(() => binding.run('fixture', {}, 'rpc'));
    expect(result.content).toBe('ok');
  });
  await expect(transport.runInAsyncScope(() => binding.run('fixture', {}, 'late'))).rejects.toThrow(
    'scope has ended',
  );
  expect(
    (await manager.journal(session.id).read())?.filter((event) => event.type === 'tool.intent'),
  ).toHaveLength(1);
  await execution.close();
  transport.emitDestroy();
});
