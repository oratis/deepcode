import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrustStore } from './trust.js';

describe('TrustStore', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-trust-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('reports untrusted by default', async () => {
    const s = new TrustStore({ home });
    expect(await s.statusFor('/some/path')).toBe('untrusted');
  });

  it('persists trust', async () => {
    const s = new TrustStore({ home });
    await s.trust('/my/proj', 'full');
    expect(await s.statusFor('/my/proj')).toBe('trusted');
    // a fresh instance still sees it
    const s2 = new TrustStore({ home });
    expect(await s2.statusFor('/my/proj')).toBe('trusted');
  });

  it('plan-only mode persists', async () => {
    const s = new TrustStore({ home });
    await s.trust('/another', 'plan-only');
    expect(await s.statusFor('/another')).toBe('plan-only');
  });

  it('untrust removes the entry', async () => {
    const s = new TrustStore({ home });
    await s.trust('/x', 'full');
    await s.untrust('/x');
    expect(await s.statusFor('/x')).toBe('untrusted');
  });

  it('resolves relative paths', async () => {
    const s = new TrustStore({ home });
    await s.trust(process.cwd(), 'full');
    expect(await s.statusFor('.')).toBe('trusted');
  });

  it('does not leak state across stores with separate homes (no shared empty)', async () => {
    // Regression: load() used to return a shallow copy of a module-level EMPTY
    // whose `dirs` was shared, so trust() on one store polluted later loads of
    // a not-yet-created store file under a different home.
    const otherHome = await mkdtemp(join(tmpdir(), 'dc-trust-other-'));
    try {
      await new TrustStore({ home }).trust('/proj/a', 'full');
      // A brand-new store at a different home must see an EMPTY state.
      const fresh = await new TrustStore({ home: otherHome }).load();
      expect(fresh.dirs).toEqual({});
      expect(await new TrustStore({ home: otherHome }).statusFor('/proj/a')).toBe('untrusted');
    } finally {
      await rm(otherHome, { recursive: true, force: true });
    }
  });
});
