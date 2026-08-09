import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFileContract } from '../config/file-contract.js';
import { formatRipgrepRow, GrepTool, parseRipgrepRows } from './grep.js';

const execFileAsync = promisify(execFile);

async function hasRipgrep(): Promise<boolean> {
  try {
    await execFileAsync('rg', ['--version']);
    return true;
  } catch {
    // Skipping locally is a convenience; skipping in CI is a green suite that
    // tested nothing. The Grep tool parses ripgrep's `--null` output byte for
    // byte, so an environment without it must say so rather than pass.
    if (process.env.DC_REQUIRE_RIPGREP === '1') {
      throw new Error('DC_REQUIRE_RIPGREP=1 but ripgrep (rg) is not on PATH');
    }
    return false;
  }
}

// Captured from ripgrep 14.1.1. These run without ripgrep installed, which is
// the point: the integration tests below self-skip when `rg` is missing, and a
// parser that only runs when a binary happens to be present is a parser nobody
// is testing.
describe('parseRipgrepRows', () => {
  it('reads content mode, where NUL follows the path and newline ends the record', () => {
    const out = 'a.ts\x001:hit\nsecrets/prod.key\x001:KEY=hunter2\n';
    expect(parseRipgrepRows(out, 'content')).toEqual([
      { path: 'a.ts', text: '1:hit' },
      { path: 'secrets/prod.key', text: '1:KEY=hunter2' },
    ]);
  });

  it('reads files_with_matches, where NUL *is* the record separator', () => {
    // No newlines at all. Splitting this on '\n' yields one row whose path is
    // `a.ts` and whose text carries every other path along for the ride — a
    // filter would drop nothing and still look like it worked.
    const out = 'a.ts\x00secrets/prod.key\x00b.ts\x00';
    expect(parseRipgrepRows(out, 'files_with_matches')).toEqual([
      { path: 'a.ts', text: '' },
      { path: 'secrets/prod.key', text: '' },
      { path: 'b.ts', text: '' },
    ]);
  });

  it('reads count mode', () => {
    expect(parseRipgrepRows('a.ts\x003\n', 'count')).toEqual([{ path: 'a.ts', text: '3' }]);
  });

  it('handles a path containing a colon, which is why NUL is needed', () => {
    const rows = parseRipgrepRows('src/od:d.ts\x001:hit\n', 'content');
    expect(rows).toEqual([{ path: 'src/od:d.ts', text: '1:hit' }]);
    // And round-trips to exactly what rg would have printed without --null.
    expect(formatRipgrepRow(rows[0]!)).toBe('src/od:d.ts:1:hit');
  });

  it('passes through a record with no path', () => {
    expect(parseRipgrepRows('--\n', 'content')).toEqual([{ path: '', text: '--' }]);
  });
});

describe('GrepTool', async () => {
  let tmp: string;
  const skipReason = (await hasRipgrep()) ? null : 'ripgrep (rg) not installed';

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dc-grep-'));
    await fs.writeFile(join(tmp, 'a.ts'), 'function verifyToken() {}\n');
    await fs.writeFile(join(tmp, 'b.ts'), 'verifyToken(); // call site\n');
    await fs.writeFile(join(tmp, 'c.md'), 'verifyToken is documented here\n');
    // Not a dotfile: ripgrep skips hidden and gitignored paths by default, so a
    // `.env` fixture would pass without the filter doing anything at all.
    await fs.mkdir(join(tmp, 'secrets'), { recursive: true });
    await fs.writeFile(join(tmp, 'secrets', 'prod.key'), 'KEY=hunter2 verifyToken\n');
  });
  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it.skipIf(skipReason)('finds matches across files', async () => {
    const r = await GrepTool.execute({ pattern: 'verifyToken', path: tmp }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/a\.ts/);
    expect(r.content).toMatch(/b\.ts/);
  });

  it.skipIf(skipReason)('filters by type', async () => {
    const r = await GrepTool.execute(
      { pattern: 'verifyToken', path: tmp, type: 'ts' },
      { cwd: tmp },
    );
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/a\.ts/);
    expect(r.content).not.toMatch(/c\.md/);
  });

  it.skipIf(skipReason)('returns (no matches) on miss', async () => {
    const r = await GrepTool.execute({ pattern: 'doesNotExist_xyzabc', path: tmp }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/no matches/i);
  });

  it.skipIf(skipReason)('files_with_matches mode', async () => {
    const r = await GrepTool.execute(
      { pattern: 'verifyToken', path: tmp, output_mode: 'files_with_matches' },
      { cwd: tmp },
    );
    expect(r.isError).toBeFalsy();
    expect(r.data?.mode).toBe('files_with_matches');
  });

  // The pre-call gate adjudicates the *search root*. A search rooted at the
  // workspace is allowed, and then hands back the contents of every file it
  // matched — including the ones the contract says must never be read.
  describe('file contract', () => {
    const contract = (decision: string) =>
      parseFileContract(
        ['version: 1', 'rules:', '  - glob: "secrets/**"', `    read: ${decision}`].join('\n'),
      );

    it.skipIf(skipReason)('withholds matches from a denied path, with their content', async () => {
      const r = await GrepTool.execute(
        { pattern: 'verifyToken', path: tmp },
        { cwd: tmp, contract: contract('deny') },
      );
      expect(r.content).toMatch(/a\.ts/);
      expect(r.content).not.toMatch(/prod\.key/);
      expect(r.content).not.toMatch(/hunter2/); // the secret itself
      expect(r.content).toMatch(/1 result withheld by the file contract/);
      expect(r.data?.withheld).toBe(1);
    });

    it.skipIf(skipReason)('withholds in files_with_matches mode too', async () => {
      const r = await GrepTool.execute(
        { pattern: 'verifyToken', path: tmp, output_mode: 'files_with_matches' },
        { cwd: tmp, contract: contract('deny') },
      );
      expect(r.content).toMatch(/a\.ts/);
      expect(r.content).not.toMatch(/prod\.key/);
      expect(r.data?.withheld).toBe(1);
    });

    it.skipIf(skipReason)('leaves `ask` results alone', async () => {
      const r = await GrepTool.execute(
        { pattern: 'verifyToken', path: tmp },
        { cwd: tmp, contract: contract('ask') },
      );
      // Nobody can be prompted mid-search, and a search is not a read of every
      // hit. Reading the file still goes through the ordinary approval.
      expect(r.content).toMatch(/prod\.key/);
      expect(r.data?.withheld).toBeUndefined();
    });

    it.skipIf(skipReason)('emits the same output as before when nothing is denied', async () => {
      const withContract = await GrepTool.execute(
        { pattern: 'verifyToken', path: tmp, '-n': true },
        { cwd: tmp, contract: parseFileContract('version: 1\n') },
      );
      const without = await GrepTool.execute(
        { pattern: 'verifyToken', path: tmp, '-n': true },
        { cwd: tmp },
      );
      // Compared as sets: ripgrep searches in parallel and does not promise an
      // order, so two runs of the same query legitimately differ in sequence.
      const lines = (r: typeof without) => (r.content as string).split('\n').sort();
      expect(lines(withContract)).toEqual(lines(without));
      // `--null` is an implementation detail of parsing, never of the output.
      expect(without.content).not.toContain('\0');
      expect(without.content).toMatch(/a\.ts:1:function verifyToken/);
    });
  });

  if (skipReason) {
    it('skipped: ripgrep not available', () => {
      expect(skipReason).toMatch(/ripgrep/);
    });
  }
});
