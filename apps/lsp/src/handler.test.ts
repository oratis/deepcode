import { describe, expect, it } from 'vitest';
import { handleMessage, type LspMessage } from './handler.js';

describe('handleMessage — initialize', () => {
  it('returns capabilities + serverInfo + supported commands', async () => {
    const out: LspMessage[] = [];
    await handleMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { rootUri: 'file:///tmp/x' },
      },
      (m) => out.push(m),
    );
    expect(out).toHaveLength(1);
    const r = out[0]!.result as {
      capabilities: { executeCommandProvider: { commands: string[] } };
      serverInfo: { name: string };
    };
    expect(r.serverInfo.name).toBe('deepcode-lsp');
    expect(r.capabilities.executeCommandProvider.commands).toContain('deepcode.runAgent');
    expect(r.capabilities.executeCommandProvider.commands).toContain('deepcode.abort');
    expect(r.capabilities.executeCommandProvider.commands).toContain('deepcode.listSkills');
  });
});

describe('handleMessage — executeCommand', () => {
  it('returns a turnId for deepcode.runAgent and streams events', async () => {
    const out: LspMessage[] = [];
    await handleMessage(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'workspace/executeCommand',
        params: { command: 'deepcode.runAgent', arguments: [{ prompt: 'hi' }] },
      },
      (m) => out.push(m),
    );
    // Synchronous: started event + reply
    expect(out.some((m) => m.method === 'deepcode/agentEvent')).toBe(true);
    const reply = out.find((m) => m.id === 2);
    expect(reply).toBeDefined();
    expect((reply!.result as { turnId: string }).turnId).toMatch(/^lsp-/);
    // Async: wait for the agent run to finish (will error in test env
    // because no DEEPSEEK_API_KEY is set — that's the expected path).
    // Poll for turn_done with a timeout.
    for (let i = 0; i < 50; i++) {
      const done = out.find(
        (m) =>
          m.method === 'deepcode/agentEvent' && (m.params as { kind: string }).kind === 'turn_done',
      );
      if (done) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const events = out.filter((m) => m.method === 'deepcode/agentEvent');
    const kinds = events.map((e) => (e.params as { kind: string }).kind);
    expect(kinds).toContain('started');
    expect(kinds).toContain('turn_done');
  }, 5000);

  it('errors on missing prompt', async () => {
    const out: LspMessage[] = [];
    await handleMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'workspace/executeCommand',
        params: { command: 'deepcode.runAgent', arguments: [{}] },
      },
      (m) => out.push(m),
    );
    expect(out[0]!.error).toBeDefined();
    expect(out[0]!.error!.message).toMatch(/prompt is required/);
  });

  it('deepcode.abort returns false for unknown turnId', async () => {
    const out: LspMessage[] = [];
    await handleMessage(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'workspace/executeCommand',
        params: { command: 'deepcode.abort', arguments: [{ turnId: 'no-such' }] },
      },
      (m) => out.push(m),
    );
    expect((out[0]!.result as { aborted: boolean }).aborted).toBe(false);
  });

  it('errors on unknown command', async () => {
    const out: LspMessage[] = [];
    await handleMessage(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'workspace/executeCommand',
        params: { command: 'evil.command', arguments: [] },
      },
      (m) => out.push(m),
    );
    expect(out[0]!.error).toBeDefined();
    expect(out[0]!.error!.message).toMatch(/Unknown command/);
  });
});

describe('handleMessage — unknown method', () => {
  it('returns -32603 internal error', async () => {
    const out: LspMessage[] = [];
    await handleMessage({ jsonrpc: '2.0', id: 6, method: 'unknown/method' }, (m) => out.push(m));
    expect(out[0]!.error).toBeDefined();
  });
});

describe('handleMessage — notifications', () => {
  it('silently drops unknown notification', async () => {
    const out: LspMessage[] = [];
    await handleMessage({ jsonrpc: '2.0', method: 'unknown/notif' }, (m) => out.push(m));
    expect(out).toHaveLength(0);
  });

  it('accepts initialized notification (no reply)', async () => {
    const out: LspMessage[] = [];
    await handleMessage({ jsonrpc: '2.0', method: 'initialized' }, (m) => out.push(m));
    expect(out).toHaveLength(0);
  });
});
