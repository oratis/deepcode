// `deepcode contract [init|show|check]` — manage the path-axis file contract.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.A · Docs: docs/file-contract.md

import {
  RECOMMENDED_FILE_CONTRACT,
  contractGovernedTools,
  evaluatePath,
  fileContractPaths,
  fileContractWarnings,
  loadFileContract,
  normalizeContractPath,
  resolveSandboxMode,
  loadSettings,
  type ContractAction,
} from '@deepcode/core';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Writable } from 'node:stream';

export interface ContractCmdDeps {
  cwd: string;
  home?: string;
  output?: Writable;
  errOutput?: Writable;
}

export async function runContractCommand(args: string[], deps: ContractCmdDeps): Promise<number> {
  const out = deps.output ?? process.stdout;
  const err = deps.errOutput ?? process.stderr;
  const sub = args[0] ?? 'show';

  switch (sub) {
    case 'init':
      return init(args.slice(1), deps, out, err);
    case 'show':
      return show(deps, out);
    case 'check':
      return check(args.slice(1), deps, out, err);
    default:
      err.write(`Unknown subcommand "${sub}".\n\n`);
      usage(err);
      return 2;
  }
}

async function init(
  args: string[],
  deps: ContractCmdDeps,
  out: Writable,
  err: Writable,
): Promise<number> {
  const target = join(deps.cwd, '.deepcode', 'file-contract.yaml');
  const force = args.includes('--force');
  try {
    await fs.access(target);
    if (!force) {
      // Overwriting a contract would silently drop rules the user wrote, which
      // is the one thing this feature exists to prevent.
      err.write(`${target} already exists. Pass --force to overwrite it.\n`);
      return 1;
    }
  } catch {
    /* absent — the normal path */
  }
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, RECOMMENDED_FILE_CONTRACT, 'utf8');
  out.write(
    `Wrote ${target}\n\n` +
      `It denies reads of secret files and asks before agent-instruction and CI changes.\n` +
      `Review it, then commit it — the contract is meant to be reviewed like any other policy.\n` +
      `Check what it does with: deepcode contract check <path>\n`,
  );
  return 0;
}

async function show(deps: ContractCmdDeps, out: Writable): Promise<number> {
  const loaded = await loadFileContract({ cwd: deps.cwd, home: deps.home });
  if (loaded.status === 'absent') {
    out.write('No file contract. Path rules are not in effect.\n\n');
    out.write('Looked in:\n');
    for (const p of fileContractPaths({ cwd: deps.cwd, home: deps.home })) out.write(`  ${p}\n`);
    out.write('\nCreate one with: deepcode contract init\n');
    return 0;
  }
  if (loaded.status === 'invalid') {
    out.write(`Invalid contract at ${loaded.path}\n  ${loaded.error}\n`);
    return 1;
  }

  const c = loaded.contract!;
  out.write(`Contract: ${loaded.path}\n\n`);
  out.write(
    `Defaults  read=${c.defaults.read} write=${c.defaults.write} execute=${c.defaults.execute}\n\n`,
  );
  for (const rule of c.rules) {
    const axes = (['read', 'write', 'execute'] as ContractAction[])
      .filter((a) => rule[a])
      .map((a) => `${a}=${rule[a]}`)
      .join(' ');
    out.write(`  ${rule.glob}\n    ${axes}${rule.owner ? `  owner=${rule.owner}` : ''}\n`);
    if (rule.reason) out.write(`    ${rule.reason}\n`);
  }
  out.write(`\nGoverns: ${contractGovernedTools().join(', ')}\n`);
  out.write(`Bash is NOT governed — only the sandbox bounds it. See docs/file-contract.md.\n`);

  for (const warning of await warningsFor(deps, loaded)) out.write(`\nWarning: ${warning}\n`);
  return 0;
}

async function check(
  args: string[],
  deps: ContractCmdDeps,
  out: Writable,
  err: Writable,
): Promise<number> {
  const target = args[0];
  if (!target) {
    err.write('Usage: deepcode contract check <path>\n');
    return 2;
  }
  const loaded = await loadFileContract({ cwd: deps.cwd, home: deps.home });
  if (loaded.status === 'invalid') {
    err.write(`Invalid contract at ${loaded.path}: ${loaded.error}\n`);
    return 1;
  }
  const rel = normalizeContractPath(deps.cwd, target);
  if (rel === null) {
    out.write(`${target} is outside the workspace — the contract has no say; the sandbox does.\n`);
    return 0;
  }
  out.write(`${rel}\n`);
  for (const action of ['read', 'write', 'execute'] as ContractAction[]) {
    const v = evaluatePath(loaded.contract, { path: rel, action });
    const detail = v.rule ? `  (${v.rule})` : v.verdict === 'no-match' ? '' : '  (default)';
    out.write(`  ${action.padEnd(8)} ${v.verdict}${detail}\n`);
    if (v.reason) out.write(`           ${v.reason}\n`);
  }
  return 0;
}

async function warningsFor(
  deps: ContractCmdDeps,
  loaded: Awaited<ReturnType<typeof loadFileContract>>,
): Promise<string[]> {
  const settings = await loadSettings({ cwd: deps.cwd, home: deps.home });
  return fileContractWarnings({
    ...loaded,
    // `danger-full-access` is the fallback the runtime itself uses when nothing
    // is configured (sandbox/index.ts), so the warning reflects reality rather
    // than an optimistic default.
    sandboxMode: resolveSandboxMode(settings.merged.sandbox, 'danger-full-access'),
  });
}

function usage(out: Writable): void {
  out.write(
    [
      'Usage: deepcode contract <subcommand>',
      '',
      '  show           Print the active contract and what it governs (default)',
      '  init [--force] Write the recommended contract to .deepcode/file-contract.yaml',
      '  check <path>   Show the verdict for one path on all three axes',
      '',
    ].join('\n'),
  );
}
