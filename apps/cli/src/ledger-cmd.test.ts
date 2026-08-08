import { FileLedger } from '@deepcode/core';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
