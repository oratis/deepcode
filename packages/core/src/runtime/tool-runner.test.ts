import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { createEngineToolRunner } from './tool-runner.js';
import { SessionManager } from '../sessions/manager.js';
import { ToolRegistry } from '../tools/registry.js';
import { WriteTool } from '../tools/write.js';
import { ReadTool } from '../tools/read.js';
import { runAgent, type RunAgentOptions } from '../agent.js';
import type { NewLedgerRecord } from '../ledger/index.js';
import { withAdditionalWritableDirs } from '../sandbox/additional-dirs.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

const usage = { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0 };
describe('engine tool execution review regressions', () => {
  let root: string;
  let cwd: string;
  let options: RunAgentOptions;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dc-engine-tools-'));
    cwd = join(root, 'workspace');
    await mkdir(cwd);
    options = {
      cwd,
      tools: new ToolRegistry([ReadTool, WriteTool]),
      provider: {
        name: 'unused',
        runTurn: async () => ({ content: [], stopReason: 'end_turn', usage }),
      },
      model: 'kimi-k2.5',
      systemPrompt: '',
      mode: 'bypassPermissions',
      systemReminders: false,
    };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it('records the before-image and continues snapshot numbering across SDK turns', async () => {
    const manager = new SessionManager({ root: join(root, 'sessions') });
    const session = await manager.create(cwd);
    options.session = { manager, id: session.id };
    const records: NewLedgerRecord[] = [];
    options.ledger = {
      append: async (_kind, record) => {
        records.push(record);
        return null;
      },
    };
    await writeFile(join(cwd, 'target'), 'before');
    await writeFile(join(cwd, 'source'), 'input');
    await manager.snapshot({
      cwd,
      sessionId: session.id,
      filePath: 'target',
      reason: 'existing',
      seq: 7,
    });
    const first = createEngineToolRunner(options);
    await first.run('Read', { file_path: 'source' }, 'read');
    await first.run('Write', { file_path: 'target', content: 'first' }, 'first');
    await createEngineToolRunner(options).run(
      'Write',
      { file_path: 'target', content: 'second' },
      'second',
    );
    const snapshots = await manager.snapshots(session.id);
    expect(snapshots.map((s) => s.seq)).toEqual([7, 8, 9, 10, 11]);
    expect(records.map((r) => r.rollbackHint?.ref)).toEqual(['8', '10']);
    expect(records[0]?.derivedFrom).toEqual(['source']);
    expect(await readFile(snapshots.find((s) => s.seq === 8)!.blobPath, 'utf8')).toBe('before');
    expect(await readFile(snapshots.find((s) => s.seq === 10)!.blobPath, 'utf8')).toBe('first');
  });
  it('does not fabricate a rollback hint when snapshots are disabled', async () => {
    const records: NewLedgerRecord[] = [];
    options.enableSnapshots = false;
    options.ledger = {
      append: async (_kind, record) => {
        records.push(record);
        return null;
      },
    };
    await createEngineToolRunner(options).run(
      'Write',
      { file_path: 'target', content: 'value' },
      'write',
    );
    expect(records[0]?.rollbackHint).toBeUndefined();
  });
  it.each(['native', 'bridge'])(
    'never starts %s execution when cancelled during the final path check',
    async (engine) => {
      const controller = new AbortController();
      options.signal = controller.signal;
      const target = join(cwd, 'target');
      await writeFile(target, 'before');
      const execute = vi.fn(WriteTool.execute);
      options.tools = new ToolRegistry([{ ...WriteTool, execute }]);
      const canonicalTarget = await fs.realpath(target);
      const originalStat = fs.stat;
      let checks = 0;
      const mock = vi.mocked(stat).mockImplementation(async (...args) => {
        const value = await originalStat(...args);
        if (String(args[0]) === canonicalTarget && ++checks === 3) controller.abort();
        return value;
      });
      const input = { file_path: target, content: 'after' };
      try {
        if (engine === 'bridge')
          await expect(
            createEngineToolRunner(options).run('Write', input, 'write'),
          ).rejects.toThrow();
        else {
          options.provider = {
            name: 'test',
            runTurn: async () => ({
              content: [{ type: 'tool_use', id: 'write', name: 'Write', input }],
              stopReason: 'tool_use',
              usage,
            }),
          };
          expect((await runAgent(options)).stopReason).toBe('aborted');
        }
        expect(checks).toBe(3);
        expect(execute).not.toHaveBeenCalled();
        expect(await readFile(target, 'utf8')).toBe('before');
      } finally {
        mock.mockRestore();
      }
    },
  );
  it.each(['native', 'bridge'])(
    'rechecks %s file targets after the approval wait',
    async (engine) => {
      const outside = join(root, 'outside');
      const inside = join(cwd, 'inside');
      await mkdir(outside);
      await mkdir(inside);
      await symlink(inside, join(cwd, 'link'));
      options.mode = 'default';
      options.approval = async () => {
        await unlink(join(cwd, 'link'));
        await symlink(outside, join(cwd, 'link'));
        return true;
      };
      const input = { file_path: 'link/target', content: 'escape' };
      if (engine === 'bridge')
        expect((await createEngineToolRunner(options).run('Write', input, 'write')).isError).toBe(
          true,
        );
      else {
        let calls = 0;
        options.provider = {
          name: 'test',
          runTurn: async () =>
            ++calls === 1
              ? {
                  content: [{ type: 'tool_use', id: 'write', name: 'Write', input }],
                  stopReason: 'tool_use',
                  usage,
                }
              : { content: [], stopReason: 'end_turn', usage },
        };
        const result = await runAgent(options);
        expect(result.history.flatMap((m) => m.content)).toContainEqual(
          expect.objectContaining({ type: 'tool_result', is_error: true }),
        );
      }
      await expect(access(join(outside, 'target'))).rejects.toThrow();
    },
  );
  it('rejects hard links to files outside the writable workspace', async () => {
    const outside = join(root, 'secret');
    await writeFile(outside, 'unchanged');
    await link(outside, join(cwd, 'linked'));
    expect(
      (
        await createEngineToolRunner(options).run(
          'Write',
          { file_path: 'linked', content: 'bad' },
          'write',
        )
      ).isError,
    ).toBe(true);
    expect(await readFile(outside, 'utf8')).toBe('unchanged');
  });
  it.each([
    ['native', 'default'],
    ['bridge', 'default'],
    ['native', 'workspace-write'],
    ['bridge', 'workspace-write'],
    ['native', 'read-only'],
    ['bridge', 'read-only'],
    ['native', 'denyWrite'],
    ['bridge', 'denyWrite'],
  ] as const)('honors additional directories in %s with %s sandbox', async (engine, mode) => {
    const outside = join(root, 'additional');
    await mkdir(outside);
    options.sandboxConfig = withAdditionalWritableDirs(
      mode === 'default'
        ? undefined
        : mode === 'denyWrite'
          ? { mode: 'workspace-write', filesystem: { denyWrite: [outside] } }
          : { mode },
      [outside],
      cwd,
    );
    const input = { file_path: join(outside, 'target'), content: 'allowed' };
    if (engine === 'bridge') await createEngineToolRunner(options).run('Write', input, 'write');
    else {
      let calls = 0;
      options.provider = {
        name: 'test',
        runTurn: async () =>
          ++calls === 1
            ? {
                content: [{ type: 'tool_use', id: 'write', name: 'Write', input }],
                stopReason: 'tool_use',
                usage,
              }
            : { content: [], stopReason: 'end_turn', usage },
      };
      await runAgent(options);
    }
    if (mode === 'read-only' || mode === 'denyWrite')
      await expect(access(input.file_path)).rejects.toThrow();
    else expect(await readFile(input.file_path, 'utf8')).toBe('allowed');
  });
});
