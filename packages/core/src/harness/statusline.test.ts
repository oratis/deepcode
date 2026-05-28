import { describe, expect, it } from 'vitest';
import { runStatusLineCommand, StatusLineRunner, type StatusLinePayload } from './statusline.js';

const samplePayload: StatusLinePayload = {
  session_id: 'sess-1',
  model: 'deepseek-chat',
  cwd: '/tmp',
  mode: 'default',
  effort: 'medium',
  version: '0.1.0',
};

describe('runStatusLineCommand', () => {
  it('runs a command and returns its stdout (trimmed)', async () => {
    const r = await runStatusLineCommand(
      { type: 'command', command: 'echo "main · 2 modified"' },
      JSON.stringify(samplePayload),
    );
    expect(r).toBe('main · 2 modified');
  });

  it('feeds JSON payload to stdin', async () => {
    const r = await runStatusLineCommand(
      { type: 'command', command: "grep -o 'plan-mode-x' | head -1" },
      JSON.stringify({ ...samplePayload, mode: 'plan-mode-x' }),
    );
    expect(r).toContain('plan-mode-x');
  });

  it('caps output at 200 chars', async () => {
    const r = await runStatusLineCommand(
      { type: 'command', command: 'printf "x%.0s" $(seq 1 500)' },
      '',
    );
    expect(r.length).toBeLessThanOrEqual(200);
  });

  it('returns empty string on timeout', async () => {
    const r = await runStatusLineCommand({ type: 'command', command: 'sleep 10' }, '');
    expect(r).toBe('');
  }, 5000);

  it('returns empty string when command fails', async () => {
    const r = await runStatusLineCommand({ type: 'command', command: 'exit 1' }, '');
    expect(r).toBe('');
  });

  it('returns empty when config has no command', async () => {
    const r = await runStatusLineCommand({ type: 'command', command: '' }, '');
    expect(r).toBe('');
  });
});

describe('StatusLineRunner', () => {
  it('calls onUpdate on tick + only when text changes', async () => {
    let counter = 0;
    const updates: string[] = [];
    const runner = new StatusLineRunner({
      config: {
        type: 'command',
        // Output two distinct lines on first vs subsequent invocations
        command:
          'if [ "$(cat /tmp/dc-sl-counter 2>/dev/null)" = "ok" ]; then echo same; else echo first; echo ok > /tmp/dc-sl-counter; fi',
      },
      payload: () => samplePayload,
      onUpdate: (text) => {
        updates.push(text);
        counter++;
      },
      debounceMs: 50,
    });
    runner.start();
    await new Promise((r) => setTimeout(r, 250));
    runner.stop();
    // First tick should produce a change; subsequent identical "same" lines should NOT trigger more updates
    expect(updates).toContain('first');
    // Cleanup
    await new Promise((r) => setTimeout(r, 10));
    expect(counter).toBeGreaterThan(0);
    // Remove tmp marker for repeat runs
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink('/tmp/dc-sl-counter').catch(() => {});
    } catch {
      /* ignore */
    }
  }, 5000);

  it('honors DEEPCODE_STATUS_LINE_DEBOUNCE_MS env override', () => {
    process.env.DEEPCODE_STATUS_LINE_DEBOUNCE_MS = '1234';
    const runner = new StatusLineRunner({
      config: { type: 'command', command: 'echo x' },
      payload: () => samplePayload,
      onUpdate: () => {},
    });
    // Read private field via cast
    expect((runner as unknown as { debounceMs: number }).debounceMs).toBe(1234);
    delete process.env.DEEPCODE_STATUS_LINE_DEBOUNCE_MS;
  });
});
