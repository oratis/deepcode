import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluatePath,
  globMatches,
  normalizeContractPath,
  parseFileContract,
  specificity,
  type FileContract,
} from './file-contract.js';
import {
  RECOMMENDED_FILE_CONTRACT,
  contractNeedsSandbox,
  loadFileContract,
} from './file-contract-loader.js';

function contract(body: string): FileContract {
  return parseFileContract(`version: 1\n${body}`);
}

describe('globMatches', () => {
  it('* stays inside one segment', () => {
    expect(globMatches('src/*.ts', 'src/a.ts')).toBe(true);
    expect(globMatches('src/*.ts', 'src/nested/a.ts')).toBe(false);
  });

  it('** crosses segments', () => {
    expect(globMatches('src/**', 'src/a/b/c.ts')).toBe(true);
    expect(globMatches('**/*.ts', 'a/b/c.ts')).toBe(true);
  });

  it('a/**/b also matches a/b — the zero-directory case', () => {
    expect(globMatches('src/**/index.ts', 'src/index.ts')).toBe(true);
    expect(globMatches('src/**/index.ts', 'src/a/b/index.ts')).toBe(true);
  });

  it('**/x matches x at the root', () => {
    expect(globMatches('**/.env', '.env')).toBe(true);
    expect(globMatches('**/.env', 'config/.env')).toBe(true);
  });

  it('{a,b} alternates', () => {
    expect(globMatches('**/*.{pem,key}', 'certs/server.pem')).toBe(true);
    expect(globMatches('**/*.{pem,key}', 'certs/server.key')).toBe(true);
    expect(globMatches('**/*.{pem,key}', 'certs/server.txt')).toBe(false);
  });

  it('? matches one non-separator character', () => {
    expect(globMatches('a?.ts', 'ab.ts')).toBe(true);
    expect(globMatches('a?.ts', 'a/.ts')).toBe(false);
  });

  it('treats regex metacharacters as literals', () => {
    // A glob is not a regex; `.` must not match an arbitrary character, or
    // `**/.env*` would also deny `axenv`.
    expect(globMatches('a.txt', 'axtxt')).toBe(false);
    expect(globMatches('a+b.ts', 'a+b.ts')).toBe(true);
    expect(globMatches('(x).ts', '(x).ts')).toBe(true);
  });
});

describe('specificity ordering', () => {
  const rank = (g: string) => specificity(g);

  it('fewer ** beats more', () => {
    expect(rank('src/*.ts').doubleStars).toBeLessThan(rank('**/*.ts').doubleStars);
  });

  it('more segments beats fewer at equal **', () => {
    expect(rank('src/a/**').segments).toBeGreaterThan(rank('src/**').segments);
  });

  it('more literal characters breaks the remaining tie', () => {
    expect(rank('**/.env*').literals).toBeGreaterThan(rank('**/*').literals);
  });
});

describe('evaluatePath', () => {
  it('returns no-match without a contract, so an absent file changes nothing', () => {
    expect(evaluatePath(undefined, { path: 'a.ts', action: 'write' }).verdict).toBe('no-match');
  });

  it('falls back to defaults when no rule covers the action', () => {
    const c = contract(`
defaults:
  write: ask
rules:
  - glob: "src/**"
    read: allow
`);
    expect(evaluatePath(c, { path: 'src/a.ts', action: 'write' }).verdict).toBe('ask');
    expect(evaluatePath(c, { path: 'src/a.ts', action: 'read' }).verdict).toBe('allow');
  });

  it('defaults to allow on every axis when no defaults block is given', () => {
    const c = contract(`
rules:
  - glob: "**/.env*"
    read: deny
`);
    expect(evaluatePath(c, { path: 'src/a.ts', action: 'write' }).verdict).toBe('allow');
    expect(evaluatePath(c, { path: '.env', action: 'read' }).verdict).toBe('deny');
  });

  it('the more specific glob wins regardless of file order', () => {
    const c = contract(`
rules:
  - glob: "**/.env*"
    read: deny
  - glob: "src/**"
    read: allow
`);
    // Both match src/.env.local; the deny is more literal, so it wins even
    // though the allow is written later.
    expect(evaluatePath(c, { path: 'src/.env.local', action: 'read' }).verdict).toBe('deny');
  });

  it('equal specificity resolves to the later rule', () => {
    const c = contract(`
rules:
  - glob: "src/*.ts"
    write: deny
  - glob: "src/*.ts"
    write: allow
`);
    expect(evaluatePath(c, { path: 'src/a.ts', action: 'write' }).verdict).toBe('allow');
  });

  it('surfaces the rule and its reason so a refusal is explainable', () => {
    const c = contract(`
rules:
  - glob: "**/.env*"
    read: deny
    reason: "Secrets are human-only."
`);
    const out = evaluatePath(c, { path: '.env', action: 'read' });
    expect(out.rule).toBe('**/.env*');
    expect(out.reason).toBe('Secrets are human-only.');
  });

  it('ignores rules that say nothing about the action being asked about', () => {
    const c = contract(`
defaults:
  read: allow
rules:
  - glob: "src/**"
    write: deny
`);
    expect(evaluatePath(c, { path: 'src/a.ts', action: 'read' }).verdict).toBe('allow');
  });

  // ── adversarial ──────────────────────────────────────────────────────
  describe('a contract cannot widen itself', () => {
    it('refuses writes to the contract even when a rule allows them', () => {
      const c = contract(`
rules:
  - glob: ".deepcode/file-contract.yaml"
    write: allow
`);
      const out = evaluatePath(c, { path: '.deepcode/file-contract.yaml', action: 'write' });
      expect(out.verdict).toBe('deny');
      expect(out.reason).toMatch(/cannot amend itself/);
    });

    it('holds when the permissive rule is broad rather than exact', () => {
      const c = contract(`
defaults:
  write: allow
rules:
  - glob: "**"
    write: allow
`);
      expect(
        evaluatePath(c, { path: '.deepcode/file-contract.yml', action: 'write' }).verdict,
      ).toBe('deny');
    });

    it('still permits reading it — auditing the contract is the point', () => {
      const c = contract(`
rules:
  - glob: "**"
    read: allow
`);
      expect(
        evaluatePath(c, { path: '.deepcode/file-contract.yaml', action: 'read' }).verdict,
      ).toBe('allow');
    });
  });
});

describe('normalizeContractPath', () => {
  const cwd = '/work/repo';

  it('makes absolute in-workspace paths relative', () => {
    expect(normalizeContractPath(cwd, '/work/repo/src/a.ts')).toBe('src/a.ts');
  });

  it('resolves relative paths against the workspace', () => {
    expect(normalizeContractPath(cwd, 'src/a.ts')).toBe('src/a.ts');
    expect(normalizeContractPath(cwd, './src/../src/a.ts')).toBe('src/a.ts');
  });

  it('returns null for paths outside the workspace', () => {
    // Out-of-workspace paths belong to the sandbox; the contract declines to
    // have an opinion rather than inventing one.
    expect(normalizeContractPath(cwd, '/etc/passwd')).toBeNull();
    expect(normalizeContractPath(cwd, '../other/a.ts')).toBeNull();
    expect(normalizeContractPath(cwd, '/work/repo/../secrets/.env')).toBeNull();
  });

  it('does not let ../ traversal re-enter and dodge a rule', () => {
    // src/../.env normalizes to .env, so a rule on .env still applies.
    expect(normalizeContractPath(cwd, '/work/repo/src/../.env')).toBe('.env');
  });

  it('returns null for the workspace root and for empty input', () => {
    expect(normalizeContractPath(cwd, cwd)).toBeNull();
    expect(normalizeContractPath(cwd, '')).toBeNull();
  });

  it('is not fooled by a sibling directory sharing the workspace prefix', () => {
    expect(normalizeContractPath('/work/repo', '/work/repo-evil/.env')).toBeNull();
  });
});

describe('parseFileContract', () => {
  it('parses the shipped recommended contract', () => {
    const parsed = parseFileContract(RECOMMENDED_FILE_CONTRACT);
    expect(parsed.version).toBe(1);
    expect(parsed.rules.length).toBeGreaterThan(0);
    expect(evaluatePath(parsed, { path: '.env.local', action: 'read' }).verdict).toBe('deny');
    expect(evaluatePath(parsed, { path: 'src/a.ts', action: 'write' }).verdict).toBe('allow');
    expect(evaluatePath(parsed, { path: 'AGENTS.md', action: 'write' }).verdict).toBe('ask');
    expect(
      evaluatePath(parsed, { path: '.github/workflows/ci.yml', action: 'write' }).verdict,
    ).toBe('ask');
  });

  it('keeps # inside a quoted reason', () => {
    const c = contract(`
rules:
  - glob: "a"
    write: deny
    reason: "see issue #42"
`);
    expect(c.rules[0]!.reason).toBe('see issue #42');
  });

  it('strips a trailing comment', () => {
    const c = contract(`
rules:
  - glob: "a"   # the a file
    write: deny
`);
    expect(c.rules[0]!.glob).toBe('a');
  });

  // Every one of these must throw rather than silently drop a rule: a dropped
  // line in this file is a permission quietly granted.
  it.each([
    ['missing version', 'rules:\n  - glob: "a"\n    read: deny\n'],
    ['unsupported version', 'version: 2\n'],
    ['unknown top-level key', 'version: 1\nrulez:\n'],
    ['unknown rule field', 'version: 1\nrules:\n  - glob: "a"\n    rewrite: deny\n'],
    ['unknown default axis', 'version: 1\ndefaults:\n  delete: deny\n'],
    ['invalid decision', 'version: 1\nrules:\n  - glob: "a"\n    read: maybe\n'],
    ['invalid owner', 'version: 1\nrules:\n  - glob: "a"\n    owner: robot\n    read: deny\n'],
    ['rule without glob', 'version: 1\nrules:\n  - read: deny\n'],
    ['rule that decides nothing', 'version: 1\nrules:\n  - glob: "a"\n'],
    ['line without a colon', 'version: 1\nrules:\n  - glob: "a"\n    deny\n'],
    ['non-integer version', 'version: one\n'],
  ])('rejects %s', (_label, body) => {
    expect(() => parseFileContract(body)).toThrow();
  });

  it('reports the offending line number', () => {
    expect(() => parseFileContract('version: 1\nrules:\n  - glob: "a"\n    read: maybe\n')).toThrow(
      /line 4/,
    );
  });
});

describe('loadFileContract', () => {
  let cwd: string;
  let home: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-contract-cwd-'));
    home = await mkdtemp(join(tmpdir(), 'dc-contract-home-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it('reports absent when there is no contract anywhere', async () => {
    expect((await loadFileContract({ cwd, home })).status).toBe('absent');
  });

  it('loads the project contract', async () => {
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(
      join(cwd, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "**/.env*"\n    read: deny\n',
    );
    const loaded = await loadFileContract({ cwd, home });
    expect(loaded.status).toBe('loaded');
    expect(evaluatePath(loaded.contract, { path: '.env', action: 'read' }).verdict).toBe('deny');
  });

  it('prefers the project contract over the user one instead of merging', async () => {
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await mkdir(join(home, '.deepcode'), { recursive: true });
    await writeFile(
      join(home, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "**"\n    write: deny\n',
    );
    await writeFile(
      join(cwd, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "**"\n    write: allow\n',
    );
    const loaded = await loadFileContract({ cwd, home });
    expect(evaluatePath(loaded.contract, { path: 'a.ts', action: 'write' }).verdict).toBe('allow');
  });

  it('falls back to the user contract when the project has none', async () => {
    await mkdir(join(home, '.deepcode'), { recursive: true });
    await writeFile(
      join(home, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "**/.env*"\n    read: deny\n',
    );
    expect((await loadFileContract({ cwd, home })).status).toBe('loaded');
  });

  it('reports a malformed contract as invalid rather than as absent', async () => {
    // Reporting `absent` would silently drop every deny the author wrote.
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(join(cwd, '.deepcode', 'file-contract.yaml'), 'version: 1\nrules:\n  - oops\n');
    const loaded = await loadFileContract({ cwd, home });
    expect(loaded.status).toBe('invalid');
    expect(loaded.error).toBeTruthy();
    expect(loaded.contract).toBeUndefined();
  });
});

describe('contractNeedsSandbox', () => {
  it('is true when any read or execute deny exists', () => {
    expect(contractNeedsSandbox(contract('rules:\n  - glob: "a"\n    read: deny\n'))).toBe(true);
    expect(contractNeedsSandbox(contract('rules:\n  - glob: "a"\n    execute: deny\n'))).toBe(true);
  });

  it('is false for a write-only contract, which Bash cannot bypass silently', () => {
    expect(contractNeedsSandbox(contract('rules:\n  - glob: "a"\n    write: deny\n'))).toBe(false);
  });

  it('is false without a contract', () => {
    expect(contractNeedsSandbox(undefined)).toBe(false);
  });
});
