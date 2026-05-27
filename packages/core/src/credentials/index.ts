// Credentials — macOS Keychain primary, ~/.deepcode/credentials.json fallback.
// Spec: docs/DEVELOPMENT_PLAN.md §3.4

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SERVICE = 'deepcode';
const KEYCHAIN_ACCOUNT_API = 'deepseek-api-key';
const KEYCHAIN_ACCOUNT_AUTH = 'deepseek-auth-token';

export interface Credentials {
  /** X-Api-Key — primary credential. */
  apiKey?: string;
  /** Bearer token alternative. If both set, Bearer wins. */
  authToken?: string;
  /** Custom DeepSeek API base URL (e.g. for proxies). */
  baseURL?: string;
}

export interface CredentialsStoreOpts {
  home?: string;
  /** Force file-backend (skip Keychain) — useful for tests. */
  forceFile?: boolean;
}

export class CredentialsStore {
  private readonly home: string;
  private readonly useKeychain: boolean;

  constructor(opts: CredentialsStoreOpts = {}) {
    this.home = opts.home ?? homedir();
    this.useKeychain = !opts.forceFile && platform() === 'darwin';
  }

  filePath(): string {
    return join(this.home, '.deepcode', 'credentials.json');
  }

  async load(): Promise<Credentials> {
    if (this.useKeychain) {
      const fromKeychain = await this.loadKeychain();
      if (fromKeychain.apiKey || fromKeychain.authToken) {
        // Read baseURL from file (Keychain doesn't store it)
        const fromFile = await this.loadFile();
        return { ...fromKeychain, baseURL: fromFile.baseURL };
      }
    }
    return this.loadFile();
  }

  async save(creds: Credentials): Promise<void> {
    if (this.useKeychain) {
      await this.saveKeychain(creds);
    }
    // Always also persist baseURL (+ a sentinel) to file
    await this.saveFile(creds);
  }

  async clear(): Promise<void> {
    if (this.useKeychain) {
      await Promise.allSettled([
        execFileAsync('security', [
          'delete-generic-password',
          '-s',
          SERVICE,
          '-a',
          KEYCHAIN_ACCOUNT_API,
        ]),
        execFileAsync('security', [
          'delete-generic-password',
          '-s',
          SERVICE,
          '-a',
          KEYCHAIN_ACCOUNT_AUTH,
        ]),
      ]);
    }
    try {
      await fs.unlink(this.filePath());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  private async loadFile(): Promise<Credentials> {
    try {
      const raw = await fs.readFile(this.filePath(), 'utf8');
      const parsed = JSON.parse(raw) as Credentials;
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  private async saveFile(creds: Credentials): Promise<void> {
    const path = this.filePath();
    await fs.mkdir(dirname(path), { recursive: true });
    // If Keychain is the source of truth, only write baseURL marker
    const toWrite: Credentials = this.useKeychain
      ? { baseURL: creds.baseURL }
      : { apiKey: creds.apiKey, authToken: creds.authToken, baseURL: creds.baseURL };
    await fs.writeFile(path, JSON.stringify(toWrite, null, 2) + '\n', 'utf8');
    await fs.chmod(path, 0o600);
  }

  private async loadKeychain(): Promise<Credentials> {
    const apiKey = await this.kcRead(KEYCHAIN_ACCOUNT_API);
    const authToken = await this.kcRead(KEYCHAIN_ACCOUNT_AUTH);
    return { apiKey, authToken };
  }

  private async saveKeychain(creds: Credentials): Promise<void> {
    if (creds.apiKey) await this.kcWrite(KEYCHAIN_ACCOUNT_API, creds.apiKey);
    if (creds.authToken) await this.kcWrite(KEYCHAIN_ACCOUNT_AUTH, creds.authToken);
  }

  private async kcRead(account: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        SERVICE,
        '-a',
        account,
        '-w',
      ]);
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async kcWrite(account: string, value: string): Promise<void> {
    await execFileAsync('security', [
      'add-generic-password',
      '-s',
      SERVICE,
      '-a',
      account,
      '-w',
      value,
      '-U',
    ]);
  }
}

/**
 * Resolve credentials at runtime: apiKeyHelper (if set) overrides stored creds.
 * Spec: docs/DEVELOPMENT_PLAN.md §3.4 — apiKeyHelper refresh on 401 + 5min cycle.
 * M2 implements one-shot resolution; the refresh loop is M3+.
 */
export async function resolveCredentials(args: {
  store: CredentialsStore;
  apiKeyHelper?: string;
}): Promise<Credentials> {
  if (args.apiKeyHelper) {
    try {
      const { stdout } = await execFileAsync('/bin/sh', ['-c', args.apiKeyHelper], {
        timeout: 10_000,
      });
      const key = stdout.trim();
      if (key) {
        const stored = await args.store.load();
        return { ...stored, apiKey: key };
      }
    } catch {
      // fall through to stored creds
    }
  }
  return args.store.load();
}

/** Display-safe redacted form of a credential — first 4 + last 4. */
export function redact(value: string | undefined): string {
  if (!value) return '<not set>';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
