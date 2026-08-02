import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DirectoryTrustStore } from './trust-store.js';

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('DirectoryTrustStore', () => {
  it('supports the app-server data-directory layout', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dc-trust-directory-'));
    const store = new DirectoryTrustStore({ directory });
    await store.trust('/workspace', 'full');
    expect(store.filePath()).toBe(join(directory, 'trusted-dirs.json'));
    await expect(store.statusFor('/workspace')).resolves.toBe('trusted');
  });

  it('rejects malformed trust state instead of silently trusting it', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dc-trust-directory-'));
    const store = new DirectoryTrustStore({ directory });
    await writeFile(store.filePath(), '{"dirs":{"/workspace":{"mode":"full"}}}');
    await expect(store.statusFor('/workspace')).rejects.toThrow(/Invalid trust entry/);
  });

  it('rejects prototype-pollution keys in trust state', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dc-trust-directory-'));
    const store = new DirectoryTrustStore({ directory });
    await writeFile(
      store.filePath(),
      '{"dirs":{"__proto__":{"trustedAt":"2026-08-01T00:00:00Z","mode":"full"}}}',
    );
    await expect(store.load()).rejects.toThrow(/Invalid trust entry key/);
  });
});
