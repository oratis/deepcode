import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialsStore, redact, resolveCredentials } from './index.js';

describe('CredentialsStore (file backend)', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-creds-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('returns empty when nothing stored', async () => {
    const s = new CredentialsStore({ home, forceFile: true });
    expect(await s.load()).toEqual({});
  });

  it('save + load round-trip (file)', async () => {
    const s = new CredentialsStore({ home, forceFile: true });
    await s.save({ apiKey: 'sk-test', baseURL: 'https://x' });
    const got = await s.load();
    expect(got.apiKey).toBe('sk-test');
    expect(got.baseURL).toBe('https://x');
  });

  it('file has mode 0600 after save', async () => {
    const s = new CredentialsStore({ home, forceFile: true });
    await s.save({ apiKey: 'sk-test' });
    const stat = await fs.stat(s.filePath());
    // permission bits are platform-dependent — at minimum no group/other access
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('clear() removes the file', async () => {
    const s = new CredentialsStore({ home, forceFile: true });
    await s.save({ apiKey: 'sk-test' });
    await s.clear();
    expect(await s.load()).toEqual({});
  });

  it('authToken (Bearer) supported separately', async () => {
    const s = new CredentialsStore({ home, forceFile: true });
    await s.save({ authToken: 'bearer-x' });
    const got = await s.load();
    expect(got.authToken).toBe('bearer-x');
  });
});

describe('resolveCredentials', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-resolve-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('apiKeyHelper output overrides stored apiKey', async () => {
    const store = new CredentialsStore({ home, forceFile: true });
    await store.save({ apiKey: 'sk-stored', baseURL: 'https://x' });
    const got = await resolveCredentials({
      store,
      apiKeyHelper: 'echo sk-helper',
    });
    expect(got.apiKey).toBe('sk-helper');
    expect(got.baseURL).toBe('https://x'); // baseURL still from store
  });

  it('falls back to stored creds when helper fails', async () => {
    const store = new CredentialsStore({ home, forceFile: true });
    await store.save({ apiKey: 'sk-stored' });
    const got = await resolveCredentials({
      store,
      apiKeyHelper: 'exit 1',
    });
    expect(got.apiKey).toBe('sk-stored');
  });

  it('falls back when helper produces empty output', async () => {
    const store = new CredentialsStore({ home, forceFile: true });
    await store.save({ apiKey: 'sk-stored' });
    const got = await resolveCredentials({ store, apiKeyHelper: 'true' });
    expect(got.apiKey).toBe('sk-stored');
  });

  it('without helper, returns stored creds verbatim', async () => {
    const store = new CredentialsStore({ home, forceFile: true });
    await store.save({ apiKey: 'sk-x', authToken: 'b-y' });
    const got = await resolveCredentials({ store });
    expect(got.apiKey).toBe('sk-x');
    expect(got.authToken).toBe('b-y');
  });
});

describe('redact', () => {
  it('redacts long secrets to first4…last4', () => {
    expect(redact('sk-d1f6abcdefghijklmnop')).toBe('sk-d…mnop');
  });
  it('returns asterisks for short values', () => {
    expect(redact('short')).toBe('****');
  });
  it('handles undefined', () => {
    expect(redact(undefined)).toBe('<not set>');
  });
});
