import { CredentialsStore } from '@deepcode/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSetupToken } from './setup-token.js';

function sink(): { stream: Writable; text: () => string } {
  let buf = '';
  const stream = new Writable({
    write(c, _e, cb) {
      buf += c.toString();
      cb();
    },
  });
  return { stream, text: () => buf };
}

/** A non-TTY readable carrying `data` (mimics a pipe). */
function pipe(data: string): Readable & { isTTY?: boolean } {
  const r = Readable.from([Buffer.from(data)]) as Readable & { isTTY?: boolean };
  r.isTTY = false;
  return r;
}

describe('runSetupToken', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-tok-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('stores a token passed as an argument', async () => {
    const out = sink();
    const code = await runSetupToken({
      token: 'tok-abc123',
      home,
      output: out.stream,
      env: {},
      forceFile: true,
    });
    expect(code).toBe(0);
    expect(out.text()).toMatch(/Stored DeepSeek auth token/);
    expect((await new CredentialsStore({ home, forceFile: true }).load()).authToken).toBe(
      'tok-abc123',
    );
  });

  it('reads the token from $DEEPSEEK_AUTH_TOKEN', async () => {
    await runSetupToken({
      home,
      output: sink().stream,
      env: { DEEPSEEK_AUTH_TOKEN: 'env-tok' },
      forceFile: true,
    });
    expect((await new CredentialsStore({ home, forceFile: true }).load()).authToken).toBe(
      'env-tok',
    );
  });

  it('reads a piped token from stdin (non-TTY)', async () => {
    await runSetupToken({
      home,
      output: sink().stream,
      env: {},
      stdin: pipe('piped-tok\n'),
      forceFile: true,
    });
    expect((await new CredentialsStore({ home, forceFile: true }).load()).authToken).toBe(
      'piped-tok',
    );
  });

  it('preserves an existing apiKey/baseURL when adding the token', async () => {
    await new CredentialsStore({ home, forceFile: true }).save({
      apiKey: 'sk-keep',
      baseURL: 'https://x/v1',
    });
    await runSetupToken({ token: 't', home, output: sink().stream, env: {}, forceFile: true });
    const creds = await new CredentialsStore({ home, forceFile: true }).load();
    expect(creds.apiKey).toBe('sk-keep');
    expect(creds.authToken).toBe('t');
    expect(creds.baseURL).toBe('https://x/v1');
  });

  it('errors with usage when no token is available', async () => {
    const err = sink();
    const ttyStdin = Object.assign(Readable.from([]), { isTTY: true });
    const code = await runSetupToken({
      home,
      errOutput: err.stream,
      env: {},
      stdin: ttyStdin,
      forceFile: true,
    });
    expect(code).toBe(2);
    expect(err.text()).toMatch(/Usage: deepcode setup-token/);
  });
});
