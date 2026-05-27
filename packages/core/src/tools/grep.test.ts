import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GrepTool } from './grep.js';

const execFileAsync = promisify(execFile);

async function hasRipgrep(): Promise<boolean> {
  try {
    await execFileAsync('rg', ['--version']);
    return true;
  } catch {
    return false;
  }
}

describe('GrepTool', async () => {
  let tmp: string;
  const skipReason = (await hasRipgrep()) ? null : 'ripgrep (rg) not installed';

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dc-grep-'));
    await fs.writeFile(join(tmp, 'a.ts'), 'function verifyToken() {}\n');
    await fs.writeFile(join(tmp, 'b.ts'), 'verifyToken(); // call site\n');
    await fs.writeFile(join(tmp, 'c.md'), 'verifyToken is documented here\n');
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

  if (skipReason) {
    it('skipped: ripgrep not available', () => {
      expect(skipReason).toMatch(/ripgrep/);
    });
  }
});
