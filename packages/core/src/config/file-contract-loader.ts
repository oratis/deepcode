// Loading side of the file contract — kept apart from `file-contract.ts` so the
// decision logic stays free of `node:fs` and remains exhaustively testable.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.A

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  FileContractError,
  parseFileContract,
  type ContractDecision,
  type FileContract,
} from './file-contract.js';

/**
 * Outcome of looking for a contract.
 *
 * `invalid` exists because the two obvious alternatives are both wrong: falling
 * back to "no contract" silently drops every `deny` the author wrote, and
 * refusing to start turns a typo into a broken install. Reporting it lets the
 * caller keep working under the tool rules alone while saying so loudly.
 */
export type FileContractStatus = 'absent' | 'loaded' | 'invalid';

export interface LoadedFileContract {
  status: FileContractStatus;
  contract?: FileContract;
  /** Absolute path of the file used, when one was found. */
  path?: string;
  /** Parse failure detail, present only when status is `invalid`. */
  error?: string;
}

export interface LoadFileContractOpts {
  cwd: string;
  /** Override $HOME (tests). */
  home?: string;
  /** Direct DeepCode data directory (contains file-contract.yaml). */
  directory?: string;
}

/** Candidate locations, most specific first. */
export function fileContractPaths(opts: LoadFileContractOpts): string[] {
  const home = opts.home ?? homedir();
  const directory = opts.directory ?? join(home, '.deepcode');
  return [
    join(opts.cwd, '.deepcode', 'file-contract.yaml'),
    join(opts.cwd, '.deepcode', 'file-contract.yml'),
    join(directory, 'file-contract.yaml'),
    join(directory, 'file-contract.yml'),
  ];
}

/**
 * Load the first contract that exists.
 *
 * Project beats user rather than merging them. Merging two rule lists would
 * make precedence depend on concatenation order across files nobody sees
 * together, and "which file denied this?" is a question the user has to be able
 * to answer by opening one file.
 */
export async function loadFileContract(opts: LoadFileContractOpts): Promise<LoadedFileContract> {
  for (const path of fileContractPaths(opts)) {
    let raw: string;
    try {
      raw = await fs.readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return { status: 'invalid', path, error: (err as Error).message };
    }
    try {
      return { status: 'loaded', path, contract: parseFileContract(raw) };
    } catch (err) {
      const message =
        err instanceof FileContractError ? err.message : `unparseable contract: ${String(err)}`;
      return { status: 'invalid', path, error: message };
    }
  }
  return { status: 'absent' };
}

/**
 * Starter contract for `deepcode contract init`.
 *
 * Defaults stay `allow` on all three axes. A coding agent that writes code is
 * doing its job, so the useful contract denies the handful of paths that are
 * never the job, rather than asking about everything and training the user to
 * approve reflexively.
 */
export const RECOMMENDED_FILE_CONTRACT = `# DeepCode file contract — permission rules on the path axis.
# Docs: https://github.com/oratis/deepcode/blob/main/docs/file-contract.md
#
# Decisions: allow | ask | deny. Axes: read | write | execute.
# More specific glob wins; equal specificity means the later rule wins.
#
# This constrains tool calls (Read/Write/Edit/Grep/Glob). It does NOT constrain
# what a shell command does once Bash starts — only the sandbox does that.

version: 1

defaults:
  read: allow
  write: allow
  execute: allow

rules:
  # Secrets are never the job.
  - glob: "**/.env*"
    owner: human
    read: deny
    write: deny
    reason: "Secrets are human-only."

  - glob: "**/*.{pem,key,p12,pfx,keystore,jks}"
    owner: human
    read: deny
    write: deny
    reason: "Private keys are human-only."

  - glob: "**/{id_rsa,id_ed25519,id_ecdsa,.npmrc,.pypirc,.netrc}"
    owner: human
    read: deny
    write: deny
    reason: "Credential file — human-only."

  # High impact: allowed, but worth a look before it lands.
  - glob: "{AGENTS.md,CLAUDE.md,DEEPCODE.md}"
    owner: shared
    write: ask
    reason: "Agent instructions shape every future run — review before writing."

  - glob: ".github/workflows/**"
    owner: human
    write: ask
    reason: "CI runs with repository credentials."

  - glob: ".deepcode/settings.json"
    owner: human
    write: ask
    reason: "Settings hold the permission rules themselves."
`;

/** Decisions in this contract that only take effect while the sandbox is on. */
export function contractNeedsSandbox(contract: FileContract | undefined): boolean {
  if (!contract) return false;
  const denies = (d: ContractDecision | undefined): boolean => d === 'deny';
  return (
    contract.defaults.read === 'deny' ||
    contract.rules.some((r) => denies(r.read) || denies(r.execute))
  );
}
