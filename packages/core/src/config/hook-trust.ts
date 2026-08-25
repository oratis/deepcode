import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { LoadedSettings } from './loader.js';
import type { HookEventName, HookHandler, Hooks } from './types.js';

export interface HookReview {
  hash: string;
  event: HookEventName;
  matcher?: string;
  command: string;
  source: { layer: 'project' | 'local'; path: string };
  trusted: boolean;
}

interface HookTrustState {
  version: 1;
  directories: Record<string, Record<string, { trustedAt: string; sourcePath: string }>>;
}

export class HookTrustStore {
  private readonly directory: string;

  constructor(options: { home?: string; directory?: string } = {}) {
    this.directory = options.directory ?? join(options.home ?? homedir(), '.deepcode');
  }

  filePath(): string {
    return join(this.directory, 'hook-trust.json');
  }

  async load(): Promise<HookTrustState> {
    try {
      return validateState(JSON.parse(await fs.readFile(this.filePath(), 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, directories: {} };
      }
      throw new Error(`Failed to load hook trust: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  async save(state: HookTrustState): Promise<void> {
    const path = this.filePath();
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, `${JSON.stringify(validateState(state), null, 2)}\n`, 'utf8');
  }

  async review(
    cwd: string,
    loaded: LoadedSettings,
    hooks: Hooks | undefined,
  ): Promise<{
    hooks: Hooks | undefined;
    reviews: HookReview[];
  }> {
    if (!hooks) return { hooks, reviews: [] };
    const state = await this.load();
    const trusted = state.directories[resolve(cwd)] ?? {};
    const filtered: Hooks = {};
    const reviews: HookReview[] = [];

    for (const [event, matchers] of Object.entries(hooks) as Array<
      [HookEventName, NonNullable<Hooks[HookEventName]>]
    >) {
      const source = sourceForEvent(loaded, event);
      const nextMatchers = matchers
        .map((matcher) => {
          const nextHandlers = matcher.hooks.filter((handler) => {
            if (handler.type !== 'command' || !source) return true;
            const hash = hookDefinitionHash(event, matcher.matcher, handler);
            const review: HookReview = {
              hash,
              event,
              matcher: matcher.matcher,
              command: handler.command ?? '',
              source,
              trusted: trusted[hash]?.sourcePath === source.path,
            };
            reviews.push(review);
            return review.trusted;
          });
          return nextHandlers.length > 0 ? { ...matcher, hooks: nextHandlers } : undefined;
        })
        .filter((matcher): matcher is NonNullable<typeof matcher> => matcher !== undefined);
      if (nextMatchers.length > 0) filtered[event] = nextMatchers;
    }
    return { hooks: filtered, reviews };
  }

  async trust(cwd: string, reviews: HookReview[]): Promise<void> {
    const state = await this.load();
    const key = resolve(cwd);
    const entries = state.directories[key] ?? {};
    for (const review of reviews) {
      entries[review.hash] = {
        trustedAt: new Date().toISOString(),
        sourcePath: review.source.path,
      };
    }
    state.directories[key] = entries;
    await this.save(state);
  }

  async revoke(cwd: string): Promise<void> {
    const state = await this.load();
    delete state.directories[resolve(cwd)];
    await this.save(state);
  }
}

export function hookDefinitionHash(
  event: HookEventName,
  matcher: string | undefined,
  handler: HookHandler,
): string {
  const canonical = canonicalJson({ event, matcher: matcher ?? '', handler });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 20);
}

function sourceForEvent(
  loaded: LoadedSettings,
  event: HookEventName,
): HookReview['source'] | undefined {
  const source = loaded.provenance[`/hooks/${escapePointer(event)}`];
  return source?.layer === 'project' || source?.layer === 'local'
    ? { layer: source.layer, path: source.path }
    : undefined;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function validateState(value: unknown): HookTrustState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hook-trust.json must contain an object');
  }
  const raw = value as { version?: unknown; directories?: unknown };
  if (
    raw.version !== 1 ||
    !raw.directories ||
    typeof raw.directories !== 'object' ||
    Array.isArray(raw.directories)
  ) {
    throw new Error('hook-trust.json must contain version 1 and directories');
  }
  const state: HookTrustState = { version: 1, directories: {} };
  for (const [cwd, entries] of Object.entries(raw.directories as Record<string, unknown>)) {
    if (!safeKey(cwd) || !entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new Error(`Invalid hook trust directory ${cwd}`);
    }
    const next: HookTrustState['directories'][string] = {};
    for (const [hash, entry] of Object.entries(entries as Record<string, unknown>)) {
      if (!safeKey(hash) || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Invalid hook trust entry ${hash}`);
      }
      const item = entry as { trustedAt?: unknown; sourcePath?: unknown };
      if (typeof item.trustedAt !== 'string' || typeof item.sourcePath !== 'string') {
        throw new Error(`Invalid hook trust entry ${hash}`);
      }
      next[hash] = { trustedAt: item.trustedAt, sourcePath: item.sourcePath };
    }
    state.directories[cwd] = next;
  }
  return state;
}

function safeKey(value: string): boolean {
  return value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}
