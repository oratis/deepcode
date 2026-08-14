// Search across past sessions.
//
// Spec: docs/DSH_ADOPTION_PLAN.md §1.5
//
// Every session is already on disk as JSONL. Nothing could read it back, so
// "how did we fix this CI failure last month" was unanswerable — despite the
// answer sitting in a file the agent owns. This is the one advantage a local
// agent has over a hosted one, and it was unused.
//
// Scope is the load-bearing decision. Searching every session on the machine
// would let a session opened in one project surface another project's code,
// credentials, or client names into this context. So the default — and, unless
// the USER changes a setting, the only behavior — is to search sessions
// recorded in the current workspace. The model cannot widen it by passing an
// argument; that would make the model, not the user, the one consenting.
//
// No index. A few thousand JSONL files scan in tens of milliseconds, and an
// index is a second copy of the truth that can disagree with it. If the volume
// ever outgrows a scan, an index goes behind this same interface.

import { isAbsolute, resolve, sep } from 'node:path';
import type { StoredMessage } from '../types.js';
import { listSessions, readSessionRecords, type SessionMeta } from './storage.js';

/** Which sessions a search may look at. */
export type SessionSearchScope =
  /** Sessions recorded in the current workspace. The default. */
  | 'workspace'
  /** Every session on this machine. User-set only. */
  | 'all';

export interface SessionSearchOptions {
  /** Sessions directory to scan. */
  root: string;
  /** Text to look for, matched case-insensitively. */
  query: string;
  /** Current working directory — defines the workspace when scope is `workspace`. */
  cwd: string;
  /** Defaults to `workspace`. */
  scope?: SessionSearchScope;
  /** Maximum hits to return across all sessions. Defaults to 20. */
  limit?: number;
  /** Characters of surrounding text kept around each hit. Defaults to 200. */
  contextChars?: number;
  /** Exclude the session currently running, which the agent can already see. */
  excludeSessionId?: string;
}

/** One matching message. */
export interface SessionSearchHit {
  sessionId: string;
  /** Session title, when it has one. */
  title?: string;
  /** Workspace the session ran in. */
  cwd: string;
  /** Message timestamp, when the record carried one. */
  timestamp?: string;
  role: 'user' | 'assistant';
  /** Index of the message within the session, for retrieval. */
  messageIndex: number;
  /** The match with surrounding text, elided at both ends. */
  excerpt: string;
}

export interface SessionSearchResult {
  hits: SessionSearchHit[];
  /** Sessions actually read. */
  sessionsSearched: number;
  /** True when `limit` cut the results short. */
  truncated: boolean;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_CONTEXT_CHARS = 200;

/**
 * Whether a session belongs to the workspace rooted at `cwd`.
 *
 * Compared as resolved path prefixes on a separator boundary, so `/a/project`
 * does not capture `/a/project-two`.
 *
 * @param sessionCwd The session's recorded working directory.
 * @param cwd The workspace root.
 * @returns True when the session ran in that workspace or below it.
 */
export function inWorkspace(sessionCwd: string, cwd: string): boolean {
  if (!isAbsolute(sessionCwd) || !isAbsolute(cwd)) return false;
  const a = resolve(sessionCwd);
  const b = resolve(cwd);
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/** Flatten a message's content blocks to searchable text. */
function messageText(message: StoredMessage): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (typeof block === 'string') parts.push(block);
    else if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'tool_result') parts.push(block.content);
    else if (block.type === 'thinking') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * Cut an excerpt around a match, marking each end that was cut.
 *
 * @param text Full text the match was found in.
 * @param at Index the match starts at.
 * @param queryLength Length of the match.
 * @param contextChars Characters to keep on each side.
 * @returns The excerpt, with `…` where text was removed.
 */
export function excerptAround(
  text: string,
  at: number,
  queryLength: number,
  contextChars: number,
): string {
  const start = Math.max(0, at - contextChars);
  const end = Math.min(text.length, at + queryLength + contextChars);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

/** Sessions a search is allowed to read, newest first. */
function candidates(
  metas: SessionMeta[],
  opts: Pick<SessionSearchOptions, 'cwd' | 'scope' | 'excludeSessionId'>,
): SessionMeta[] {
  const scope = opts.scope ?? 'workspace';
  return metas
    .filter((m) => m.id !== opts.excludeSessionId)
    .filter((m) => scope === 'all' || inWorkspace(m.cwd, opts.cwd))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * Search past sessions for text.
 *
 * Newest sessions are read first, so a `limit` that cuts the search short keeps
 * the most recent matches rather than an arbitrary set.
 *
 * @param opts Where to search, for what, and how much to return.
 * @returns Matching excerpts, plus how many sessions were read.
 */
export async function searchSessions(opts: SessionSearchOptions): Promise<SessionSearchResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const contextChars = opts.contextChars ?? DEFAULT_CONTEXT_CHARS;
  const needle = opts.query.toLowerCase();
  if (needle.length === 0 || limit <= 0) {
    return { hits: [], sessionsSearched: 0, truncated: false };
  }

  const metas = candidates(await listSessions(opts.root), opts);
  const hits: SessionSearchHit[] = [];
  let sessionsSearched = 0;
  let truncated = false;

  for (const meta of metas) {
    if (hits.length >= limit) {
      truncated = true;
      break;
    }
    let messages: StoredMessage[];
    try {
      ({ messages } = await readSessionRecords(opts.root, meta.id));
    } catch {
      // A corrupt or half-written session must not fail the whole search; it is
      // one of many, and the others are still worth returning.
      continue;
    }
    sessionsSearched++;

    for (const [messageIndex, message] of messages.entries()) {
      const text = messageText(message);
      const at = text.toLowerCase().indexOf(needle);
      if (at === -1) continue;
      if (hits.length >= limit) {
        truncated = true;
        break;
      }
      hits.push({
        sessionId: meta.id,
        ...(meta.title !== undefined ? { title: meta.title } : {}),
        cwd: meta.cwd,
        ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
        role: message.role,
        messageIndex,
        excerpt: excerptAround(text, at, opts.query.length, contextChars),
      });
    }
  }

  return { hits, sessionsSearched, truncated };
}
