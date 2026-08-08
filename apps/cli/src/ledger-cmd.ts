// `deepcode ledger [list|show|export]` — read the change ledger.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.B · Docs: docs/change-ledger.md

import {
  LEDGER_KINDS,
  findLedgerRecord,
  ledgerPath,
  readProjectLedger,
  renderLedgerMarkdown,
  type LedgerKind,
  type LedgerRecord,
} from '@deepcode/core';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Writable } from 'node:stream';

export interface LedgerCmdDeps {
  cwd: string;
  home?: string;
  output?: Writable;
  errOutput?: Writable;
  json?: boolean;
}

export async function runLedgerCommand(args: string[], deps: LedgerCmdDeps): Promise<number> {
  const out = deps.output ?? process.stdout;
  const err = deps.errOutput ?? process.stderr;
  const sub = args[0] ?? 'list';

  switch (sub) {
    case 'list':
      return list(args.slice(1), deps, out);
    case 'show':
      return show(args.slice(1), deps, out, err);
    case 'export':
      return exportCmd(args.slice(1), deps, out, err);
    default:
      err.write(`Unknown subcommand "${sub}".\n\n`);
      usage(err);
      return 2;
  }
}

function parseKind(args: string[], fallback: LedgerKind | 'both'): LedgerKind | 'both' {
  const i = args.indexOf('--kind');
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (value && (LEDGER_KINDS as readonly string[]).includes(value)) return value as LedgerKind;
  return fallback;
}

function parseNumber(args: string[], flag: string, fallback: number): number {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const parsed = Number(args[i + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function list(args: string[], deps: LedgerCmdDeps, out: Writable): Promise<number> {
  const home = deps.home ?? homedir();
  const kind = parseKind(args, 'both');
  const limit = parseNumber(args, '--limit', 20);
  const kinds = kind === 'both' ? LEDGER_KINDS : [kind];

  const collected: Array<{ kind: LedgerKind; record: LedgerRecord }> = [];
  for (const k of kinds) {
    for (const record of await readProjectLedger(deps.cwd, k, home))
      collected.push({ kind: k, record });
  }
  collected.sort((a, b) => a.record.timestamp.localeCompare(b.record.timestamp));
  const shown = collected.slice(-limit);

  if (deps.json) {
    out.write(JSON.stringify(shown, null, 2) + '\n');
    return 0;
  }

  if (shown.length === 0) {
    out.write('No ledger records for this project yet.\n');
    return 0;
  }
  for (const { kind: k, record } of shown) {
    const where = record.paths.length > 0 ? record.paths.join(', ') : '—';
    out.write(
      `${record.id}  ${record.timestamp}  ${k === 'governance' ? '[gov] ' : ''}${record.summary}\n`,
    );
    out.write(`  paths: ${where}\n`);
    if (record.intent) out.write(`  intent: ${record.intent}\n`);
  }
  // Say what was withheld rather than letting a truncated list read as complete.
  if (collected.length > shown.length) {
    out.write(`\n(${collected.length - shown.length} older records not shown; use --limit)\n`);
  }
  return 0;
}

async function show(
  args: string[],
  deps: LedgerCmdDeps,
  out: Writable,
  err: Writable,
): Promise<number> {
  const id = args[0];
  if (!id) {
    err.write('Usage: deepcode ledger show <id>\n');
    return 2;
  }
  const found = await findLedgerRecord(deps.cwd, id, deps.home ?? homedir());
  if (!found) {
    err.write(`No ledger record with id "${id}".\n`);
    return 1;
  }
  if (deps.json) {
    out.write(JSON.stringify(found.record, null, 2) + '\n');
    return 0;
  }
  const r = found.record;
  out.write(`${r.id}\n`);
  out.write(`  timeline : ${found.kind}\n`);
  out.write(`  when     : ${r.timestamp}\n`);
  out.write(`  actor    : ${r.actor}${r.tool ? ` (${r.tool})` : ''}\n`);
  if (r.intent) out.write(`  intent   : ${r.intent}\n`);
  out.write(`  paths    : ${r.paths.length > 0 ? r.paths.join(', ') : '—'}\n`);
  out.write(`  summary  : ${r.summary}\n`);
  if (r.rollbackHint) {
    out.write(`  rollback : ${r.rollbackHint.kind}`);
    if (r.rollbackHint.ref) out.write(` @ ${r.rollbackHint.ref}`);
    out.write('\n');
  } else {
    out.write(`  rollback : none recorded\n`);
  }
  return 0;
}

async function exportCmd(
  args: string[],
  deps: LedgerCmdDeps,
  out: Writable,
  err: Writable,
): Promise<number> {
  const home = deps.home ?? homedir();
  const kind = parseKind(args, 'changes');
  if (kind === 'both') {
    err.write('Usage: deepcode ledger export [--kind changes|governance] [--out <path>]\n');
    return 2;
  }
  const records = await readProjectLedger(deps.cwd, kind, home);
  const markdown = renderLedgerMarkdown(kind, records);

  const outIdx = args.indexOf('--out');
  const target = outIdx === -1 ? undefined : args[outIdx + 1];
  if (!target) {
    out.write(markdown);
    return 0;
  }
  const abs = resolve(deps.cwd, target);
  await fs.mkdir(dirname(abs), { recursive: true });
  await fs.writeFile(abs, markdown, 'utf8');
  out.write(`Wrote ${records.length} record(s) to ${abs}\n`);
  return 0;
}

function usage(out: Writable): void {
  out.write(
    [
      'Usage: deepcode ledger <subcommand>',
      '',
      '  list [--kind changes|governance] [--limit N]   Recent records (default)',
      '  show <id>                                      One record in full',
      '  export [--kind K] [--out <path>]               Markdown digest',
      '',
      `Stored under ${dirname(ledgerPath('<project>', 'changes', '<home>'))}`,
      '',
    ].join('\n'),
  );
}
