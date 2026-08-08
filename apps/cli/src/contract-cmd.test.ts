import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContractCommand } from './contract-cmd.js';

function capture(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  let buf = '';
  stream.on('data', (c: Buffer) => {
    buf += c.toString('utf8');
  });
  return { stream, text: () => buf };
}

describe('deepcode contract', () => {
  let cwd: string;
  let home: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-contract-cmd-'));
    home = await mkdtemp(join(tmpdir(), 'dc-contract-home-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it('show reports absence and lists where it looked', async () => {
    const out = capture();
    const code = await runContractCommand(['show'], { cwd, home, output: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toContain('No file contract');
    expect(out.text()).toContain('file-contract.yaml');
  });

  it('init writes a contract that parses and takes effect', async () => {
    const out = capture();
    expect(await runContractCommand(['init'], { cwd, home, output: out.stream })).toBe(0);

    const written = await readFile(join(cwd, '.deepcode', 'file-contract.yaml'), 'utf8');
    expect(written).toContain('version: 1');

    const check = capture();
    await runContractCommand(['check', '.env'], { cwd, home, output: check.stream });
    expect(check.text()).toContain('deny');
  });

  it('init refuses to clobber an existing contract without --force', async () => {
    // Overwriting would silently drop rules the user wrote, which is the exact
    // failure this feature exists to prevent.
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(join(cwd, '.deepcode', 'file-contract.yaml'), 'version: 1\n');
    const err = capture();
    const code = await runContractCommand(['init'], { cwd, home, errOutput: err.stream });
    expect(code).toBe(1);
    expect(err.text()).toContain('--force');
    expect(await readFile(join(cwd, '.deepcode', 'file-contract.yaml'), 'utf8')).toBe(
      'version: 1\n',
    );
  });

  it('check reports all three axes with the deciding rule', async () => {
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(
      join(cwd, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "**/.env*"\n    read: deny\n    reason: "no secrets"\n',
    );
    const out = capture();
    await runContractCommand(['check', 'config/.env.local'], { cwd, home, output: out.stream });
    const text = out.text();
    expect(text).toContain('read');
    expect(text).toContain('deny');
    expect(text).toContain('no secrets');
    expect(text).toContain('write');
  });

  it('check says an outside path belongs to the sandbox, not the contract', async () => {
    const out = capture();
    await runContractCommand(['check', '/etc/passwd'], { cwd, home, output: out.stream });
    expect(out.text()).toContain('outside the workspace');
  });

  it('show surfaces a parse error instead of pretending there are no rules', async () => {
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(
      join(cwd, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "a"\n    read: maybe\n',
    );
    const out = capture();
    const code = await runContractCommand(['show'], { cwd, home, output: out.stream });
    expect(code).toBe(1);
    expect(out.text()).toContain('Invalid contract');
    expect(out.text()).toContain('line 4');
  });

  it('show warns that read denies leave Bash uncovered when the sandbox is off', async () => {
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(
      join(cwd, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "**/.env*"\n    read: deny\n',
    );
    const out = capture();
    await runContractCommand(['show'], { cwd, home, output: out.stream });
    expect(out.text()).toContain('sandbox is off');
  });

  it('rejects an unknown subcommand with usage', async () => {
    const err = capture();
    expect(await runContractCommand(['bogus'], { cwd, home, errOutput: err.stream })).toBe(2);
    expect(err.text()).toContain('Usage:');
  });
});
