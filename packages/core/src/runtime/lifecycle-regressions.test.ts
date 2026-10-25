import { mkdtemp, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAgent } from '../agent.js';
import { compact } from '../compaction/index.js';
import { ToolRegistry } from '../tools/registry.js';
import { HookDispatcher } from '../hooks/dispatcher.js';
import type { Provider } from '../providers/types.js';
import { dispatchToolCall } from '../harness/tool-dispatcher.js';
import { classifyAutoMode } from '../auto-mode/index.js';
const usage = { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0 };

describe('termination and cancellation regressions', () => {
  it('retains history when a provider returns an empty successful summary', async () => {
    const history = Array.from({ length: 15 }, () => ({
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'important' }],
    }));
    const provider: Provider = {
      name: 'empty',
      runTurn: async () => ({ content: [], stopReason: 'end_turn', usage }),
    };
    await expect(compact(history, { provider })).rejects.toThrow('did not return a summary');
    expect(history).toHaveLength(15);
  });
  it('does not let a completed hook leave a detached delayed writer', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dc-hook-child-'));
    try {
      const hooks = new HookDispatcher({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: '(sleep 0.3; touch late) >/dev/null 2>&1 &' }] },
          ],
        },
      });
      await hooks.dispatch({ event: 'Stop', cwd, triggeredAt: '', payload: {} });
      await new Promise((resolve) => setTimeout(resolve, 400));
      await expect(access(join(cwd, 'late'))).rejects.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  it('fails closed when the auto classifier is unavailable or truncated', async () => {
    const base = { toolName: 'Write', toolInput: {}, config: { fallback: 'allow' as const } };
    expect(await classifyAutoMode(base)).toBe('ask');
    expect(
      await classifyAutoMode({
        ...base,
        provider: {
          name: 'x',
          runTurn: async () => ({
            content: [{ type: 'text', text: 'allow' }],
            stopReason: 'max_tokens',
            usage,
          }),
        },
      }),
    ).toBe('ask');
  });
  it('applies write roots before approvals, hooks, and permission bypass', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dc-write-policy-'));
    const outside = await mkdtemp(join(tmpdir(), 'dc-write-outside-'));
    try {
      await symlink(outside, join(cwd, 'link'));
      const base = {
        tool: 'Write',
        input: { file_path: 'link/nested/file' },
        mode: 'bypassPermissions' as const,
        cwd,
      };
      expect((await dispatchToolCall(base)).decision).toBe('deny');
      expect(
        (
          await dispatchToolCall({
            ...base,
            input: { file_path: 'private/key' },
            sandboxConfig: { filesystem: { denyWrite: ['private'] } },
          })
        ).decision,
      ).toBe('deny');
      expect(
        (
          await dispatchToolCall({
            ...base,
            sandboxConfig: { mode: 'read-only' },
            input: { file_path: 'local' },
          })
        ).decision,
      ).toBe('deny');
      expect(
        (
          await dispatchToolCall({
            ...base,
            sandboxConfig: { filesystem: { allowWrite: [outside] } },
          })
        ).decision,
      ).toBe('allow');
      expect(
        (await dispatchToolCall({ ...base, sandboxConfig: { mode: 'danger-full-access' } }))
          .decision,
      ).toBe('allow');
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
  it.each(['max_tokens', 'error', 'stop_sequence'] as const)(
    'preserves provider termination %s',
    async (stopReason) => {
      const result = await runAgent({
        provider: { name: 'test', runTurn: async () => ({ stopReason, content: [], usage }) },
        tools: new ToolRegistry([]),
        model: 'test',
        cwd: tmpdir(),
        systemPrompt: '',
        userMessage: 'test',
        mode: 'default',
        systemReminders: false,
      });
      expect(result.stopReason).toBe(stopReason);
    },
  );
  it('does not commit a summary after cancellation, even if the provider ignores abort', async () => {
    const ac = new AbortController();
    const history = Array.from({ length: 15 }, () => ({
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'retain' }],
    }));
    const provider: Provider = {
      name: 'mock',
      defaultModel: 'kimi-k2.5',
      runTurn: async (opts) => {
        expect(opts.model).toBe('kimi-k2.5');
        expect(opts.signal).toBe(ac.signal);
        ac.abort();
        return { content: [{ type: 'text', text: 'summary' }], stopReason: 'end_turn', usage };
      },
    };
    await expect(compact(history, { provider, signal: ac.signal })).rejects.toThrow();
    expect(history).toHaveLength(15);
  });
  it('cancels a hook process group before its delayed write', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dc-hook-abort-'));
    try {
      const ac = new AbortController();
      const hooks = new HookDispatcher({
        hooks: {
          PreCompact: [{ hooks: [{ type: 'command', command: '(sleep 0.3; touch late) & wait' }] }],
        },
      });
      const timer = setTimeout(() => ac.abort(), 60);
      const result = await hooks.dispatch({
        event: 'PreCompact',
        cwd,
        triggeredAt: '',
        payload: {},
        signal: ac.signal,
      });
      clearTimeout(timer);
      expect(result.anyBlocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await expect(access(join(cwd, 'late'))).rejects.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
