// Trust dialog — track which directories the user has approved for full feature access.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.10
// M2: tracks state to ~/.deepcode/trusted-dirs.json; CLI prompt for new dirs.
// Hooks/MCP/apiKeyHelper gating is consulted by their owners (deferred to M3).

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface TrustState {
  dirs: Record<string, { trustedAt: string; mode: 'full' | 'plan-only' }>;
}

const EMPTY: TrustState = { dirs: {} };

export interface TrustStoreOpts {
  home?: string;
}

export class TrustStore {
  private readonly home: string;
  constructor(opts: TrustStoreOpts = {}) {
    this.home = opts.home ?? homedir();
  }

  filePath(): string {
    return join(this.home, '.deepcode', 'trusted-dirs.json');
  }

  async load(): Promise<TrustState> {
    try {
      const raw = await fs.readFile(this.filePath(), 'utf8');
      return JSON.parse(raw) as TrustState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
      throw err;
    }
  }

  async save(state: TrustState): Promise<void> {
    const path = this.filePath();
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  async statusFor(cwd: string): Promise<'trusted' | 'plan-only' | 'untrusted'> {
    const abs = resolve(cwd);
    const state = await this.load();
    const entry = state.dirs[abs];
    if (!entry) return 'untrusted';
    return entry.mode === 'plan-only' ? 'plan-only' : 'trusted';
  }

  async trust(cwd: string, mode: 'full' | 'plan-only'): Promise<void> {
    const abs = resolve(cwd);
    const state = await this.load();
    state.dirs[abs] = { trustedAt: new Date().toISOString(), mode };
    await this.save(state);
  }

  async untrust(cwd: string): Promise<void> {
    const abs = resolve(cwd);
    const state = await this.load();
    delete state.dirs[abs];
    await this.save(state);
  }
}
