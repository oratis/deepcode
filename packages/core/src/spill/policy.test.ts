import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySpillPolicy } from './policy.js';
import { createLocalSpillStore } from './local.js';
import type { SpillOutcome } from './policy.js';
import type { SpillSource, SpillStore } from './types.js';

const source: SpillSource = { toolName: 'Bash', callId: 'toolu_01', label: 'result' };

function outcomeOf(data: Record<string, unknown> | undefined): SpillOutcome {
  return data?.['spill'] as SpillOutcome;
}

describe('applySpillPolicy', () => {
  it('leaves a result that fits completely untouched', async () => {
    const result = { content: 'small', data: { exitCode: 0 } };
    const out = await applySpillPolicy(result, { source, thresholdChars: 100 });
    expect(out).toBe(result);
  });

  it('leaves a result exactly at the threshold untouched', async () => {
    const result = { content: 'x'.repeat(100) };
    expect(await applySpillPolicy(result, { source, thresholdChars: 100 })).toBe(result);
  });

  it('bounds the model-visible content even with no store', async () => {
    const result = { content: 'x'.repeat(10_000) };
    const out = await applySpillPolicy(result, { source, thresholdChars: 200 });
    // Threshold plus the fixed marker — the point is that 10 KB does not reach
    // the model, not that the marker is free.
    expect(out.content.length).toBeLessThan(600);
    expect(out.content).toContain('was not saved');
    expect(outcomeOf(out.data).locator).toBeUndefined();
    expect(outcomeOf(out.data).unsavedReason).toContain('no session directory');
  });

  it('keeps both the head and the tail of the original', async () => {
    const content = `START${'-'.repeat(5000)}END`;
    const out = await applySpillPolicy({ content }, { source, thresholdChars: 200 });
    expect(out.content.startsWith('START')).toBe(true);
    expect(out.content.trimEnd().endsWith('END')).toBe(true);
  });

  it('gives the tail more room than the head', async () => {
    // A failing command's useful output is at the end, so the split is not even.
    const out = await applySpillPolicy(
      { content: 'x'.repeat(10_000) },
      { source, thresholdChars: 1000 },
    );
    const [head, tail] = out.content.split(/\n\n\.\.\. \[.*?\] \.\.\.\n\n/s);
    expect(head.length).toBeLessThan(tail.length);
  });

  it('preserves the tool result fields it does not own', async () => {
    const out = await applySpillPolicy(
      { content: 'x'.repeat(500), isError: true, data: { exitCode: 3 } },
      { source, thresholdChars: 100 },
    );
    expect(out.isError).toBe(true);
    expect(out.data?.['exitCode']).toBe(3);
  });

  it('saves the full text and points the model at it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spill-'));
    const content = `START${'-'.repeat(5000)}END`;
    const out = await applySpillPolicy(
      { content },
      { source, thresholdChars: 200, store: createLocalSpillStore(dir) },
    );

    const locator = outcomeOf(out.data).locator;
    expect(locator).toBeDefined();
    expect(out.content).toContain(locator as string);
    expect(out.content).toContain('Read that file');
    expect(await readFile(locator as string, 'utf8')).toBe(content);
    expect(outcomeOf(out.data).originalChars).toBe(content.length);
  });

  it('degrades to a preview when saving fails', async () => {
    const store: SpillStore = {
      saveText: () => Promise.reject(new Error('disk full')),
    };
    const out = await applySpillPolicy(
      { content: 'x'.repeat(500) },
      { source, thresholdChars: 100, store },
    );
    expect(out.content).toContain('disk full');
    expect(outcomeOf(out.data).locator).toBeUndefined();
  });
});

describe('createLocalSpillStore', () => {
  it('reports the byte length, not the character count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spill-'));
    const ref = await createLocalSpillStore(dir).saveText({ source, content: '😀' });
    expect(ref.bytes).toBe(4);
  });

  it('does not overwrite an artifact whose name collides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spill-'));
    const store = createLocalSpillStore(dir);
    // Sanitizing maps both of these call ids onto the same base name.
    const a = await store.saveText({ source: { ...source, callId: 'a/b' }, content: 'first' });
    const b = await store.saveText({ source: { ...source, callId: 'a:b' }, content: 'second' });

    expect(a.locator).not.toBe(b.locator);
    expect(await readFile(a.locator, 'utf8')).toBe('first');
    expect(await readFile(b.locator, 'utf8')).toBe('second');
    expect((await readdir(join(dir, 'spill'))).length).toBe(2);
  });
});
