import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrustStore } from './trust.js';
import { runTrustCommand } from './trust-cmd.js';

function sink(): { stream: Writable; text: () => string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => buf };
}

describe('runTrustCommand', () => {
  let home: string;
  const cwd = '/Users/x/project';
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-trustcmd-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('trusts the cwd at full mode by default', async () => {
    const out = sink();
    const code = await runTrustCommand([], { cwd, home, output: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toMatch(/Trusted .* enabled here/);
    expect(await new TrustStore({ home }).statusFor(cwd)).toBe('trusted');
  });

  it('trusts plan-only with --plan-only', async () => {
    const out = sink();
    await runTrustCommand(['--plan-only'], { cwd, home, output: out.stream });
    expect(out.text()).toMatch(/plan-only/);
    expect(await new TrustStore({ home }).statusFor(cwd)).toBe('plan-only');
  });

  it('--remove untrusts the cwd', async () => {
    await runTrustCommand([], { cwd, home, output: sink().stream });
    const out = sink();
    await runTrustCommand(['--remove'], { cwd, home, output: out.stream });
    expect(out.text()).toMatch(/Removed trust/);
    expect(await new TrustStore({ home }).statusFor(cwd)).toBe('untrusted');
  });

  it('--list shows trusted directories', async () => {
    await runTrustCommand([], { cwd, home, output: sink().stream });
    await runTrustCommand(['--plan-only'], { cwd: '/Users/x/other', home, output: sink().stream });
    const out = sink();
    await runTrustCommand(['--list'], { cwd, home, output: out.stream });
    expect(out.text()).toContain('/Users/x/project');
    expect(out.text()).toContain('/Users/x/other');
    expect(out.text()).toMatch(/plan-only/);
  });

  it('--list reports empty store', async () => {
    const out = sink();
    await runTrustCommand(['--list'], { cwd, home, output: out.stream });
    expect(out.text()).toMatch(/No trusted directories/);
  });
});
