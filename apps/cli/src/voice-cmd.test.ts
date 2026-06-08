// Tests for the /voice slash command messaging. Detection logic itself is
// unit-tested in core (voice/detect.test.ts); here we drive the command end to
// end with real temp files so the "ready" path is deterministic, and bogus
// configured paths so the "not set up" path never depends on the host's PATH.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@deepcode/core';
import { CommandRegistry, type SessionContext } from './commands.js';

const reg = new CommandRegistry();
const tmps: string[] = [];
async function tmpDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'dc-voice-'));
  tmps.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(tmps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    cwd: '/tmp/x',
    model: 'deepseek-chat',
    mode: 'default',
    effort: 'medium',
    settings: {},
    creds: { apiKey: 'sk-test' },
    sessionId: 's1',
    sessions: new SessionManager({ root: '/tmp/x' }),
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 },
    ...overrides,
  };
}

const run = (args: string[], c: SessionContext) => reg.match('/voice')!.cmd.run(args, c);

describe('/voice', () => {
  it('reports ready when configured binary + model both exist', async () => {
    const dir = await tmpDir();
    const binPath = join(dir, 'whisper-cli');
    const modelPath = join(dir, 'model.bin');
    await writeFile(binPath, '#!/bin/sh\n');
    await writeFile(modelPath, 'GGML');
    const out = (await run([], ctx({ settings: { voice: { binPath, modelPath } } }))).join('\n');
    expect(out).toMatch(/ready/i);
    expect(out).toContain(binPath);
    expect(out).toContain(modelPath);
    expect(out).toMatch(/Ctrl\+V/);
  });

  it('prints setup steps + issues when configured paths are missing', async () => {
    const out = (
      await run(
        [],
        ctx({ settings: { voice: { binPath: '/no/such/whisper', modelPath: '/no/such/m.bin' } } }),
      )
    ).join('\n');
    expect(out).toMatch(/not set up yet/i);
    expect(out).toMatch(/brew install whisper-cpp/);
    expect(out).toMatch(/docs\/VOICE_INPUT\.md/);
    // The specific configured-but-missing problems surface under "Issues:".
    expect(out).toMatch(/Issues:/);
    expect(out).toContain('Configured voice.binPath not found: /no/such/whisper');
    expect(out).toContain('Configured voice.modelPath not found: /no/such/m.bin');
  });

  it('`/voice setup` always shows install steps, even when ready', async () => {
    const dir = await tmpDir();
    const binPath = join(dir, 'whisper-cli');
    const modelPath = join(dir, 'model.bin');
    await writeFile(binPath, '');
    await writeFile(modelPath, '');
    const out = (await run(['setup'], ctx({ settings: { voice: { binPath, modelPath } } }))).join(
      '\n',
    );
    expect(out).toMatch(/Setup:/);
    expect(out).toMatch(/brew install whisper-cpp/);
    // Still acknowledges it's already ready.
    expect(out).toMatch(/ready/i);
  });
});
