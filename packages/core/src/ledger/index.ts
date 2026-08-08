// Change ledger — an append-only record of what the agent changed and how to
// undo it.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.B
//
// Sessions already store a message stream and snapshots already capture file
// state, but neither answers the question a user actually asks after a run:
// "what did it change, why, and how do I undo that one thing?" A message log
// requires reading a conversation to find out; snapshots are addressable but
// carry no intent. This is the missing index over both.
//
// Not an authority. The ledger records decisions; it never influences one.
// (Selfware makes the same split: memory must not become protocol authority.)

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Two timelines, deliberately.
 *
 * `changes` is high-frequency workspace edits — the "what did it do" stream.
 * `governance` is low-frequency, high-impact: contract edits, plugin installs,
 * trust grants, rollbacks. Interleaving them buries the second in the first,
 * which is the whole reason to keep the split rather than one file with a type
 * column: the rare, important events stay readable on their own.
 */
export type LedgerKind = 'changes' | 'governance';

export const LEDGER_KINDS: readonly LedgerKind[] = ['changes', 'governance'];

export interface RollbackHint {
  /** `git` when a repo checkpoint exists, `snapshot` for per-file captures. */
  kind: 'git' | 'snapshot' | 'manual';
  /** Commit-ish, snapshot address, or a human instruction for `manual`. */
  ref?: string;
  /** Ready-to-run command, when one exists. */
  command?: string;
}

export interface LedgerRecord {
  id: string;
  /** ISO 8601. */
  timestamp: string;
  /** `user` | `agent` | `hook` | `plugin` | `subagent:<name>`. */
  actor: string;
  threadId?: string;
  turnId?: string;
  /** Tool that produced the change, when one did. */
  tool?: string;
  /** What the run was trying to achieve — the user's request, abridged. */
  intent?: string;
  /** Workspace-relative paths. Empty when the effect cannot be pinned to files. */
  paths: string[];
  summary: string;
  rollbackHint?: RollbackHint;
}

export type NewLedgerRecord = Omit<LedgerRecord, 'id' | 'timestamp'>;

/**
 * Where the agent loop writes. An interface so a host can substitute one, and
 * so tests need no filesystem.
 */
export interface LedgerSink {
  append(kind: LedgerKind, record: NewLedgerRecord): Promise<LedgerRecord | null>;
}

export interface LedgerRetention {
  /** Newest records to keep per file. */
  maxRecords: number;
  /** Drop records older than this. */
  maxAgeDays: number;
}

export const DEFAULT_RETENTION: LedgerRetention = { maxRecords: 5000, maxAgeDays: 90 };

/**
 * Ledgers live under the DeepCode data dir, keyed by project — not in the
 * repository.
 *
 * Selfware keeps its change log inside the instance, which suits a document
 * workspace. Here it would append to a tracked file on every edit and turn
 * `git status` into noise during the exact activity the user is reviewing.
 * `deepcode ledger export` covers the case where they do want it committed.
 */
export function projectLedgerDir(cwd: string, home: string = homedir()): string {
  const key = resolve(cwd).replace(/[/\\]+/g, '-');
  return join(home, '.deepcode', 'projects', key, 'ledger');
}

export function ledgerPath(cwd: string, kind: LedgerKind, home: string = homedir()): string {
  return join(projectLedgerDir(cwd, home), `${kind}.jsonl`);
}

let ledgerSeq = 0;
export function newLedgerId(now: number = Date.now()): string {
  return `chg-${now.toString(36)}-${(ledgerSeq++).toString(36).padStart(2, '0')}`;
}

/** Cap on one serialized record, so a single append stays a single atomic write. */
const MAX_LINE_BYTES = 4000;

export interface FileLedgerOpts {
  cwd: string;
  home?: string;
  retention?: Partial<LedgerRetention>;
  /** Clock injection for tests. */
  now?: () => Date;
}

export class FileLedger implements LedgerSink {
  private readonly retention: LedgerRetention;
  private readonly now: () => Date;
  /** Appends since the last prune check, per kind. */
  private readonly sinceCheck = new Map<LedgerKind, number>();

  constructor(private readonly opts: FileLedgerOpts) {
    this.retention = { ...DEFAULT_RETENTION, ...opts.retention };
    this.now = opts.now ?? (() => new Date());
  }

  path(kind: LedgerKind): string {
    return ledgerPath(this.opts.cwd, kind, this.opts.home ?? homedir());
  }

  /**
   * Append one record. Returns it, or null if it could not be written.
   *
   * Never throws. A ledger is an audit trail, not a precondition — failing a
   * tool call because bookkeeping failed would trade a working edit for a lost
   * one. Failures surface through `lastError`.
   */
  async append(kind: LedgerKind, record: NewLedgerRecord): Promise<LedgerRecord | null> {
    const full: LedgerRecord = {
      id: newLedgerId(this.now().getTime()),
      timestamp: this.now().toISOString(),
      ...record,
      summary: truncate(record.summary, 500),
      ...(record.intent ? { intent: truncate(record.intent, 500) } : {}),
    };
    let line = JSON.stringify(full);
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      // Prefer a shorter honest record over a dropped one.
      full.paths = full.paths.slice(0, 20);
      full.summary = truncate(full.summary, 200);
      line = JSON.stringify(full);
    }
    const path = this.path(kind);
    try {
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.appendFile(path, `${line}\n`, 'utf8');
    } catch (err) {
      this.lastError = err as Error;
      return null;
    }
    const n = (this.sinceCheck.get(kind) ?? 0) + 1;
    if (n >= 200) {
      this.sinceCheck.set(kind, 0);
      await this.prune(kind).catch((err: Error) => {
        this.lastError = err;
      });
    } else {
      this.sinceCheck.set(kind, n);
    }
    return full;
  }

  lastError?: Error;

  /**
   * Trim to the retention window: newest `maxRecords`, nothing older than
   * `maxAgeDays`.
   *
   * Retention ships with the writer rather than as a follow-up. A log that only
   * ever grows is a log someone eventually deletes wholesale, which loses the
   * old records the retention policy would have kept anyway.
   */
  async prune(kind: LedgerKind): Promise<number> {
    const path = this.path(kind);
    const records = await readLedger(path);
    const cutoff = this.now().getTime() - this.retention.maxAgeDays * 86_400_000;
    const kept = records
      .filter((r) => Date.parse(r.timestamp) >= cutoff)
      .slice(-this.retention.maxRecords);
    if (kept.length === records.length) return 0;
    const tmp = `${path}.tmp`;
    await fs.writeFile(
      tmp,
      kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''),
      'utf8',
    );
    await fs.rename(tmp, path);
    return records.length - kept.length;
  }
}

/**
 * Read a ledger file, skipping unparseable lines.
 *
 * A corrupt line here is not worth failing over: unlike a session, no later
 * state is reconstructed from these records, so the readable ones stay useful
 * on their own.
 */
export async function readLedger(path: string): Promise<LedgerRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: LedgerRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as LedgerRecord;
      if (parsed && typeof parsed.id === 'string' && Array.isArray(parsed.paths)) out.push(parsed);
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function readProjectLedger(
  cwd: string,
  kind: LedgerKind,
  home: string = homedir(),
): Promise<LedgerRecord[]> {
  return readLedger(ledgerPath(cwd, kind, home));
}

/** Find one record by id across both timelines. */
export async function findLedgerRecord(
  cwd: string,
  id: string,
  home: string = homedir(),
): Promise<{ kind: LedgerKind; record: LedgerRecord } | null> {
  for (const kind of LEDGER_KINDS) {
    const found = (await readProjectLedger(cwd, kind, home)).find((r) => r.id === id);
    if (found) return { kind, record: found };
  }
  return null;
}

function truncate(text: string, max: number): string {
  const trimmed = (text ?? '').trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** Render records as a human-readable Markdown digest. */
export function renderLedgerMarkdown(kind: LedgerKind, records: LedgerRecord[]): string {
  const title = kind === 'changes' ? 'Workspace changes' : 'Governance changes';
  if (records.length === 0) return `# ${title}\n\nNo records.\n`;
  const lines = [`# ${title}`, ''];
  for (const r of records) {
    lines.push(`## ${r.id} — ${r.timestamp}`);
    lines.push('');
    lines.push(`- **actor**: ${r.actor}${r.tool ? ` (${r.tool})` : ''}`);
    if (r.intent) lines.push(`- **intent**: ${r.intent}`);
    if (r.paths.length > 0) lines.push(`- **paths**: ${r.paths.map((p) => `\`${p}\``).join(', ')}`);
    lines.push(`- **summary**: ${r.summary}`);
    if (r.rollbackHint) {
      const hint = r.rollbackHint;
      const detail = hint.command ? `\`${hint.command}\`` : (hint.ref ?? 'see notes');
      lines.push(`- **rollback**: ${hint.kind} — ${detail}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
