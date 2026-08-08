import { describe, expect, it } from 'vitest';
import {
  contractGovernedTools,
  evaluateContract,
  fileContractWarnings,
  mostRestrictive,
} from './contract-dispatch.js';
import { parseFileContract, type FileContract } from './file-contract.js';
import type { PermissionVerdict } from './permissions.js';

const CWD = '/work/repo';

function contract(body: string): FileContract {
  return parseFileContract(`version: 1\n${body}`);
}

const secrets = contract(`
rules:
  - glob: "**/.env*"
    read: deny
    write: deny
    reason: "Secrets are human-only."
  - glob: "AGENTS.md"
    write: ask
    reason: "Review first."
`);

describe('mostRestrictive', () => {
  const verdicts: PermissionVerdict[] = ['no-match', 'allow', 'ask', 'deny'];

  // The whole safety argument rests on this table, so it is enumerated rather
  // than sampled: 4 tool verdicts × 4 contract verdicts.
  const expected: Record<string, PermissionVerdict> = {
    'no-match|no-match': 'no-match',
    'no-match|allow': 'allow',
    'no-match|ask': 'ask',
    'no-match|deny': 'deny',
    'allow|no-match': 'allow',
    'allow|allow': 'allow',
    'allow|ask': 'ask',
    'allow|deny': 'deny',
    'ask|no-match': 'ask',
    'ask|allow': 'ask',
    'ask|ask': 'ask',
    'ask|deny': 'deny',
    'deny|no-match': 'deny',
    'deny|allow': 'deny',
    'deny|ask': 'deny',
    'deny|deny': 'deny',
  };

  for (const tool of verdicts) {
    for (const path of verdicts) {
      it(`tool=${tool} × contract=${path} → ${expected[`${tool}|${path}`]}`, () => {
        expect(mostRestrictive(tool, path)).toBe(expected[`${tool}|${path}`]);
      });
    }
  }

  it('never loosens: a settings deny survives any contract verdict', () => {
    for (const path of verdicts) expect(mostRestrictive('deny', path)).toBe('deny');
  });

  it('is symmetric, so argument order cannot change a decision', () => {
    for (const a of verdicts) {
      for (const b of verdicts) {
        expect(mostRestrictive(a, b)).toBe(mostRestrictive(b, a));
      }
    }
  });
});

describe('evaluateContract', () => {
  it('has no opinion without a contract', () => {
    expect(
      evaluateContract(undefined, { tool: 'Read', input: { file_path: '.env' }, cwd: CWD }).verdict,
    ).toBe('no-match');
  });

  it('maps Read to the read axis', () => {
    const out = evaluateContract(secrets, {
      tool: 'Read',
      input: { file_path: '/work/repo/.env' },
      cwd: CWD,
    });
    expect(out.verdict).toBe('deny');
    expect(out.reason).toBe('Secrets are human-only.');
  });

  it('maps Write and Edit to the write axis', () => {
    for (const tool of ['Write', 'Edit']) {
      expect(
        evaluateContract(secrets, { tool, input: { file_path: '.env.local' }, cwd: CWD }).verdict,
      ).toBe('deny');
    }
  });

  it('reads NotebookEdit from notebook_path, not file_path', () => {
    const c = contract('rules:\n  - glob: "secret.ipynb"\n    write: deny\n');
    expect(
      evaluateContract(c, {
        tool: 'NotebookEdit',
        input: { notebook_path: 'secret.ipynb' },
        cwd: CWD,
      }).verdict,
    ).toBe('deny');
  });

  it('maps Grep and Glob search roots to the read axis', () => {
    const c = contract('rules:\n  - glob: "vault/**"\n    read: deny\n');
    expect(
      evaluateContract(c, { tool: 'Grep', input: { path: 'vault/x' }, cwd: CWD }).verdict,
    ).toBe('deny');
    expect(
      evaluateContract(c, { tool: 'Glob', input: { path: 'vault/x' }, cwd: CWD }).verdict,
    ).toBe('deny');
  });

  it('has no opinion about Bash, by design', () => {
    // Statically parsing shell to guess at paths would be guesswork presented
    // as enforcement. Bash is the sandbox's job.
    expect(
      evaluateContract(secrets, { tool: 'Bash', input: { command: 'cat .env' }, cwd: CWD }).verdict,
    ).toBe('no-match');
  });

  it('has no opinion about tools with no path axis', () => {
    expect(
      evaluateContract(secrets, { tool: 'WebFetch', input: { url: 'https://x' }, cwd: CWD })
        .verdict,
    ).toBe('no-match');
  });

  it('has no opinion when the path argument is missing or not a string', () => {
    expect(evaluateContract(secrets, { tool: 'Read', input: {}, cwd: CWD }).verdict).toBe(
      'no-match',
    );
    expect(
      evaluateContract(secrets, { tool: 'Read', input: { file_path: 42 }, cwd: CWD }).verdict,
    ).toBe('no-match');
  });

  it('has no opinion about paths outside the workspace', () => {
    expect(
      evaluateContract(secrets, { tool: 'Read', input: { file_path: '/etc/.env' }, cwd: CWD })
        .verdict,
    ).toBe('no-match');
  });

  it('still applies after ../ traversal resolves back inside', () => {
    expect(
      evaluateContract(secrets, { tool: 'Read', input: { file_path: 'src/../.env' }, cwd: CWD })
        .verdict,
    ).toBe('deny');
  });

  it('lists the tools it governs', () => {
    expect(contractGovernedTools().sort()).toEqual([
      'Edit',
      'Glob',
      'Grep',
      'NotebookEdit',
      'Read',
      'Write',
    ]);
  });
});

describe('fileContractWarnings', () => {
  it('says nothing when there is no contract', () => {
    expect(fileContractWarnings({ status: 'absent' })).toEqual([]);
  });

  it('reports a malformed contract as having no rules in effect', () => {
    const [warning] = fileContractWarnings({
      status: 'invalid',
      path: '/work/repo/.deepcode/file-contract.yaml',
      error: 'line 4: read must be one of allow/ask/deny, got "maybe"',
    });
    expect(warning).toContain('no path rules are in effect');
    expect(warning).toContain('line 4');
  });

  it('warns that read denies do not cover Bash while the sandbox is off', () => {
    const [warning] = fileContractWarnings({
      status: 'loaded',
      contract: secrets,
      sandboxMode: 'danger-full-access',
    });
    expect(warning).toContain('sandbox is off');
    expect(warning).toContain('Bash');
  });

  it('stays quiet once the sandbox bounds Bash', () => {
    expect(
      fileContractWarnings({
        status: 'loaded',
        contract: secrets,
        sandboxMode: 'workspace-write',
      }),
    ).toEqual([]);
  });

  it('stays quiet for a write-only contract, which Bash cannot silently defeat', () => {
    // A write deny is about tool calls; there is no false-enforcement risk to
    // warn about, so warning anyway would just train users to ignore it.
    expect(
      fileContractWarnings({
        status: 'loaded',
        contract: contract('rules:\n  - glob: "a"\n    write: deny\n'),
        sandboxMode: 'danger-full-access',
      }),
    ).toEqual([]);
  });
});
