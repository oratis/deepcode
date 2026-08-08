import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileLedger,
  findLedgerRecord,
  ledgerPath,
  readLedger,
  readProjectLedger,
  renderLedgerMarkdown,
  type LedgerRecord,
} from './index.js';
import { buildToolCallRecord, isRecordableTool, ledgerKindForTool } from './record-tool-call.js';

describe('FileLedger', () => {
  let cwd: string;
  let home: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-ledger-cwd-'));
    home = await mkdtemp(join(tmpdir(), 'dc-ledger-home-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  const base = { actor: 'agent', paths: ['a.ts'], summary: 'wrote a.ts' };

  it('appends and reads back', async () => {
    const ledger = new FileLedger({ cwd, home });
    const written = await ledger.append('changes', base);
    expect(written?.id).toMatch(/^chg-/);
    const records = await readProjectLedger(cwd, 'changes', home);
    expect(records).toHaveLength(1);
    expect(records[0]!.summary).toBe('wrote a.ts');
  });

  it('keeps the two timelines in separate files', async () => {
    // The split is the point: a rare governance event must not be buried under
    // thousands of edits.
    const ledger = new FileLedger({ cwd, home });
    await ledger.append('changes', base);
    await ledger.append('governance', { actor: 'user', paths: [], summary: 'installed a plugin' });
    expect(await readProjectLedger(cwd, 'changes', home)).toHaveLength(1);
    expect(await readProjectLedger(cwd, 'governance', home)).toHaveLength(1);
  });

  it('writes outside the repository, so git status stays clean', async () => {
    const ledger = new FileLedger({ cwd, home });
    await ledger.append('changes', base);
    expect(ledger.path('changes').startsWith(home)).toBe(true);
    expect(ledger.path('changes').startsWith(cwd)).toBe(false);
  });

  it('generates unique ids for rapid appends', async () => {
    const ledger = new FileLedger({ cwd, home });
    const a = await ledger.append('changes', base);
    const b = await ledger.append('changes', base);
    expect(a!.id).not.toBe(b!.id);
  });

  it('returns null instead of throwing when the write fails', async () => {
    // An audit trail must never be able to fail a completed edit.
    const ledger = new FileLedger({ cwd, home });
    const blocker = ledger.path('changes');
    await mkdir(blocker, { recursive: true }); // a directory where the file goes
    const result = await ledger.append('changes', base);
    expect(result).toBeNull();
    expect(ledger.lastError).toBeDefined();
  });

  it('truncates an oversized summary rather than dropping the record', async () => {
    const ledger = new FileLedger({ cwd, home });
    await ledger.append('changes', { ...base, summary: 'x'.repeat(9000) });
    const [record] = await readProjectLedger(cwd, 'changes', home);
    expect(record).toBeDefined();
    expect(record!.summary.length).toBeLessThan(600);
  });

  it('skips corrupt lines but keeps the readable ones', async () => {
    const ledger = new FileLedger({ cwd, home });
    await ledger.append('changes', base);
    await writeFile(
      ledger.path('changes'),
      (await readFile(ledger.path('changes'), 'utf8')) + 'not json\n',
    );
    await ledger.append('changes', { ...base, summary: 'second' });
    const records = await readProjectLedger(cwd, 'changes', home);
    expect(records.map((r) => r.summary)).toEqual(['wrote a.ts', 'second']);
  });

  describe('retention', () => {
    it('keeps only the newest maxRecords', async () => {
      const ledger = new FileLedger({ cwd, home, retention: { maxRecords: 3 } });
      for (let i = 0; i < 10; i++) await ledger.append('changes', { ...base, summary: `s${i}` });
      const dropped = await ledger.prune('changes');
      expect(dropped).toBe(7);
      const kept = await readProjectLedger(cwd, 'changes', home);
      expect(kept.map((r) => r.summary)).toEqual(['s7', 's8', 's9']);
    });

    it('drops records past maxAgeDays', async () => {
      let clock = new Date('2026-01-01T00:00:00.000Z');
      const ledger = new FileLedger({
        cwd,
        home,
        retention: { maxAgeDays: 30 },
        now: () => clock,
      });
      await ledger.append('changes', { ...base, summary: 'old' });
      clock = new Date('2026-06-01T00:00:00.000Z');
      await ledger.append('changes', { ...base, summary: 'new' });
      await ledger.prune('changes');
      expect((await readProjectLedger(cwd, 'changes', home)).map((r) => r.summary)).toEqual([
        'new',
      ]);
    });

    it('leaves the file alone when nothing is out of window', async () => {
      const ledger = new FileLedger({ cwd, home });
      await ledger.append('changes', base);
      expect(await ledger.prune('changes')).toBe(0);
      expect(await readProjectLedger(cwd, 'changes', home)).toHaveLength(1);
    });
  });

  it('finds a record by id across both timelines', async () => {
    const ledger = new FileLedger({ cwd, home });
    const gov = await ledger.append('governance', {
      actor: 'user',
      paths: [],
      summary: 'granted trust',
    });
    const found = await findLedgerRecord(cwd, gov!.id, home);
    expect(found?.kind).toBe('governance');
  });

  it('reads a missing ledger as empty rather than failing', async () => {
    expect(await readLedger(ledgerPath(cwd, 'changes', home))).toEqual([]);
  });
});

describe('buildToolCallRecord', () => {
  const cwd = '/work/repo';

  it('records the mutating tools', () => {
    for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash']) {
      expect(isRecordableTool(tool)).toBe(true);
      expect(ledgerKindForTool(tool)).toBe('changes');
    }
  });

  it('does not record reads', () => {
    // A ledger answering "what changed, how do I undo it" has nothing to say
    // about a read, and the traffic would bury the mutations.
    for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch']) {
      expect(isRecordableTool(tool)).toBe(false);
      expect(buildToolCallRecord({ tool, input: {}, cwd })).toBeNull();
    }
  });

  it('stores workspace-relative paths so the record survives a repo move', () => {
    const record = buildToolCallRecord({
      tool: 'Write',
      input: { file_path: '/work/repo/src/a.ts' },
      cwd,
    });
    expect(record?.paths).toEqual(['src/a.ts']);
  });

  it('reads NotebookEdit from notebook_path', () => {
    const record = buildToolCallRecord({
      tool: 'NotebookEdit',
      input: { notebook_path: 'nb.ipynb', edit_mode: 'insert' },
      cwd,
    });
    expect(record?.paths).toEqual(['nb.ipynb']);
    expect(record?.summary).toContain('insert');
  });

  it('records a Bash command with no paths', () => {
    // "The agent ran this" is exactly what an audit needs, even though no path
    // can be declared for it.
    const record = buildToolCallRecord({ tool: 'Bash', input: { command: 'rm -rf build' }, cwd });
    expect(record?.paths).toEqual([]);
    expect(record?.summary).toBe('ran: rm -rf build');
  });

  it('carries intent and thread identity through', () => {
    const record = buildToolCallRecord({
      tool: 'Write',
      input: { file_path: 'a.ts' },
      cwd,
      intent: 'fix the auth bug',
      threadId: 'thread-1',
      turnId: 'turn-2',
    });
    expect(record?.intent).toBe('fix the auth bug');
    expect(record?.threadId).toBe('thread-1');
    expect(record?.turnId).toBe('turn-2');
  });

  it('points the rollback hint at the checkpoint taken for this call', () => {
    const write = buildToolCallRecord({
      tool: 'Write',
      input: { file_path: 'a.ts' },
      cwd,
      snapshotSeq: 7,
    });
    expect(write?.rollbackHint).toMatchObject({ kind: 'snapshot', ref: '7' });

    const bash = buildToolCallRecord({
      tool: 'Bash',
      input: { command: 'x' },
      cwd,
      snapshotSeq: 8,
    });
    expect(bash?.rollbackHint).toMatchObject({ kind: 'git', ref: '8' });
  });

  it('omits the rollback hint when no checkpoint exists, rather than guessing', () => {
    const record = buildToolCallRecord({ tool: 'Write', input: { file_path: 'a.ts' }, cwd });
    expect(record?.rollbackHint).toBeUndefined();
  });
});

describe('renderLedgerMarkdown', () => {
  const record: LedgerRecord = {
    id: 'chg-1',
    timestamp: '2026-08-08T00:00:00.000Z',
    actor: 'agent',
    tool: 'Edit',
    intent: 'fix auth',
    paths: ['src/auth.ts'],
    summary: 'edited src/auth.ts',
    rollbackHint: { kind: 'snapshot', ref: '3' },
  };

  it('renders a record with its intent, paths and rollback', () => {
    const md = renderLedgerMarkdown('changes', [record]);
    expect(md).toContain('# Workspace changes');
    expect(md).toContain('chg-1');
    expect(md).toContain('fix auth');
    expect(md).toContain('`src/auth.ts`');
    expect(md).toContain('snapshot');
  });

  it('says so plainly when empty', () => {
    expect(renderLedgerMarkdown('governance', [])).toContain('No records.');
  });
});
