import { FileLedger, captureSnapshot } from '@deepcode/core';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runLedgerCommand } from './ledger-cmd.js';

function capture(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  let buf = '';
  stream.on('data', (c: Buffer) => {
    buf += c.toString('utf8');
  });
  return { stream, text: () => buf };
}

describe('deepcode ledger', () => {
  let cwd: string;
  let home: string;
  let ledger: FileLedger;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-ledger-cli-'));
    home = await mkdtemp(join(tmpdir(), 'dc-ledger-cli-home-'));
    ledger = new FileLedger({ cwd, home });
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it('says so plainly when there is nothing recorded', async () => {
    const out = capture();
    expect(await runLedgerCommand(['list'], { cwd, home, output: out.stream })).toBe(0);
    expect(out.text()).toContain('No ledger records');
  });

  it('lists records from both timelines, oldest first', async () => {
    await ledger.append('changes', { actor: 'agent', paths: ['a.ts'], summary: 'edited a.ts' });
    await ledger.append('governance', { actor: 'user', paths: [], summary: 'granted trust' });
    const out = capture();
    await runLedgerCommand(['list'], { cwd, home, output: out.stream });
    expect(out.text()).toContain('edited a.ts');
    expect(out.text()).toContain('[gov]');
  });

  it('filters by timeline', async () => {
    await ledger.append('changes', { actor: 'agent', paths: [], summary: 'edited a.ts' });
    await ledger.append('governance', { actor: 'user', paths: [], summary: 'granted trust' });
    const out = capture();
    await runLedgerCommand(['list', '--kind', 'governance'], { cwd, home, output: out.stream });
    expect(out.text()).toContain('granted trust');
    expect(out.text()).not.toContain('edited a.ts');
  });

  it('reports how many records the limit hid', async () => {
    // A truncated list that looks complete is how people conclude the agent
    // changed less than it did.
    for (let i = 0; i < 5; i++) {
      await ledger.append('changes', { actor: 'agent', paths: [], summary: `s${i}` });
    }
    const out = capture();
    await runLedgerCommand(['list', '--limit', '2'], { cwd, home, output: out.stream });
    expect(out.text()).toContain('3 older records not shown');
  });

  it('shows one record with its rollback handle', async () => {
    const written = await ledger.append('changes', {
      actor: 'agent',
      tool: 'Edit',
      intent: 'fix auth',
      paths: ['src/auth.ts'],
      summary: 'edited src/auth.ts',
      rollbackHint: { kind: 'snapshot', ref: '3' },
    });
    const out = capture();
    await runLedgerCommand(['show', written!.id], { cwd, home, output: out.stream });
    const text = out.text();
    expect(text).toContain('fix auth');
    expect(text).toContain('src/auth.ts');
    expect(text).toContain('snapshot @ 3');
  });

  it('says a record has no rollback rather than implying one', async () => {
    const written = await ledger.append('changes', {
      actor: 'agent',
      paths: ['a.ts'],
      summary: 'edited a.ts',
    });
    const out = capture();
    await runLedgerCommand(['show', written!.id], { cwd, home, output: out.stream });
    expect(out.text()).toContain('none recorded');
  });

  it('fails on an unknown id', async () => {
    const err = capture();
    expect(await runLedgerCommand(['show', 'nope'], { cwd, home, errOutput: err.stream })).toBe(1);
    expect(err.text()).toContain('nope');
  });

  it('exports Markdown to stdout', async () => {
    await ledger.append('changes', { actor: 'agent', paths: ['a.ts'], summary: 'edited a.ts' });
    const out = capture();
    await runLedgerCommand(['export'], { cwd, home, output: out.stream });
    expect(out.text()).toContain('# Workspace changes');
    expect(out.text()).toContain('`a.ts`');
  });

  it('exports to a file when asked', async () => {
    await ledger.append('changes', { actor: 'agent', paths: ['a.ts'], summary: 'edited a.ts' });
    const out = capture();
    await runLedgerCommand(['export', '--out', 'audit.md'], { cwd, home, output: out.stream });
    expect(await readFile(join(cwd, 'audit.md'), 'utf8')).toContain('edited a.ts');
  });

  it('emits JSON when asked', async () => {
    await ledger.append('changes', { actor: 'agent', paths: ['a.ts'], summary: 'edited a.ts' });
    const out = capture();
    await runLedgerCommand(['list'], { cwd, home, output: out.stream, json: true });
    const parsed = JSON.parse(out.text()) as Array<{ record: { summary: string } }>;
    expect(parsed[0]!.record.summary).toBe('edited a.ts');
  });

  it('rejects an unknown subcommand with usage', async () => {
    const err = capture();
    expect(await runLedgerCommand(['bogus'], { cwd, home, errOutput: err.stream })).toBe(2);
    expect(err.text()).toContain('Usage:');
  });
});

describe('deepcode ledger rollback', () => {
  let cwd: string;
  let home: string;
  let sessionsRoot: string;
  let ledger: FileLedger;
  const sessionId = 'thread-cli';

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-rb-cwd-'));
    home = await mkdtemp(join(tmpdir(), 'dc-rb-home-'));
    sessionsRoot = await mkdtemp(join(tmpdir(), 'dc-rb-sessions-'));
    ledger = new FileLedger({ cwd, home });
  });
  afterEach(async () => {
    for (const dir of [cwd, home, sessionsRoot]) await rm(dir, { recursive: true, force: true });
  });

  /** A recorded edit with a real snapshot behind it. */
  async function recordedEdit(): Promise<{ id: string; file: string }> {
    const file = join(cwd, 'a.ts');
    await writeFile(file, 'original\n');
    await captureSnapshot({
      sessionsRoot,
      sessionId,
      cwd,
      filePath: file,
      reason: 'pre-Edit',
      seq: 1,
    });
    await writeFile(file, 'changed\n');
    const written = await ledger.append('changes', {
      actor: 'agent',
      tool: 'Edit',
      threadId: sessionId,
      paths: ['a.ts'],
      summary: 'edited a.ts',
      rollbackHint: { kind: 'snapshot', ref: '1' },
    });
    return { id: written!.id, file };
  }

  it('restores the file and records the rollback on the governance timeline', async () => {
    const { id, file } = await recordedEdit();
    const out = capture();
    const code = await runLedgerCommand(['rollback', id], {
      cwd,
      home,
      sessionsRoot,
      output: out.stream,
      confirm: async () => 'accept',
    });
    expect(code).toBe(0);
    expect(await readFile(file, 'utf8')).toBe('original\n');

    // An audit trail with an unlogged undo is not an audit trail.
    const out2 = capture();
    await runLedgerCommand(['list', '--kind', 'governance'], { cwd, home, output: out2.stream });
    expect(out2.text()).toContain('rolled back');
  });

  it('changes nothing when the user declines', async () => {
    const { id, file } = await recordedEdit();
    const out = capture();
    await runLedgerCommand(['rollback', id], {
      cwd,
      home,
      sessionsRoot,
      output: out.stream,
      confirm: async () => 'reject',
    });
    expect(await readFile(file, 'utf8')).toBe('changed\n');
    expect(out.text()).toContain('nothing was changed');
  });

  it('shows the explanation and preview before asking', async () => {
    const { id } = await recordedEdit();
    let shown = '';
    await runLedgerCommand(['rollback', id], {
      cwd,
      home,
      sessionsRoot,
      output: capture().stream,
      confirm: async (p) => {
        shown = JSON.stringify(p);
        return 'reject';
      },
    });
    expect(shown).toContain('snapshot');
    expect(shown).toContain('a.ts');
  });

  it('explains why a record cannot be rolled back instead of failing obscurely', async () => {
    const written = await ledger.append('changes', {
      actor: 'agent',
      paths: ['a.ts'],
      summary: 'edited a.ts',
    });
    const err = capture();
    const code = await runLedgerCommand(['rollback', written!.id], {
      cwd,
      home,
      sessionsRoot,
      errOutput: err.stream,
    });
    expect(code).toBe(1);
    expect(err.text()).toContain('no rollback point');
  });

  it('fails on an unknown id', async () => {
    const err = capture();
    expect(
      await runLedgerCommand(['rollback', 'nope'], {
        cwd,
        home,
        sessionsRoot,
        errOutput: err.stream,
      }),
    ).toBe(1);
  });
});
