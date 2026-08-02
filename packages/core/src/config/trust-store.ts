import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { TrustStatus } from './trust-gate.js';

export interface DirectoryTrustState {
  dirs: Record<string, { trustedAt: string; mode: 'full' | 'plan-only' }>;
}

export interface DirectoryTrustStoreOptions {
  /** User home. Ignored when `directory` is supplied. */
  home?: string;
  /** Direct DeepCode data directory, for app-server sidecars and tests. */
  directory?: string;
}

/** Canonical directory-trust store shared by every runtime host. */
export class DirectoryTrustStore {
  private readonly directory: string;

  constructor(options: DirectoryTrustStoreOptions = {}) {
    this.directory = options.directory ?? join(options.home ?? homedir(), '.deepcode');
  }

  filePath(): string {
    return join(this.directory, 'trusted-dirs.json');
  }

  async load(): Promise<DirectoryTrustState> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath(), 'utf8')) as unknown;
      return validateState(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { dirs: {} };
      throw new Error(`Failed to load directory trust: ${(error as Error).message}`);
    }
  }

  async save(state: DirectoryTrustState): Promise<void> {
    const path = this.filePath();
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, `${JSON.stringify(validateState(state), null, 2)}\n`, 'utf8');
  }

  async statusFor(cwd: string): Promise<TrustStatus> {
    const entry = (await this.load()).dirs[resolve(cwd)];
    if (!entry) return 'untrusted';
    return entry.mode === 'plan-only' ? 'plan-only' : 'trusted';
  }

  async trust(cwd: string, mode: 'full' | 'plan-only'): Promise<void> {
    const state = await this.load();
    state.dirs[resolve(cwd)] = { trustedAt: new Date().toISOString(), mode };
    await this.save(state);
  }

  async untrust(cwd: string): Promise<void> {
    const state = await this.load();
    delete state.dirs[resolve(cwd)];
    await this.save(state);
  }
}

function validateState(value: unknown): DirectoryTrustState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('trusted-dirs.json must contain an object');
  }
  const dirs = (value as { dirs?: unknown }).dirs;
  if (!dirs || typeof dirs !== 'object' || Array.isArray(dirs)) {
    throw new Error('trusted-dirs.json must contain a dirs object');
  }
  const validated: DirectoryTrustState = { dirs: {} };
  for (const [path, raw] of Object.entries(dirs)) {
    if (path === '__proto__' || path === 'prototype' || path === 'constructor') {
      throw new Error(`Invalid trust entry key ${path}`);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Invalid trust entry for ${path}`);
    }
    const entry = raw as { trustedAt?: unknown; mode?: unknown };
    if (
      typeof entry.trustedAt !== 'string' ||
      (entry.mode !== 'full' && entry.mode !== 'plan-only')
    ) {
      throw new Error(`Invalid trust entry for ${path}`);
    }
    validated.dirs[path] = { trustedAt: entry.trustedAt, mode: entry.mode };
  }
  return validated;
}
