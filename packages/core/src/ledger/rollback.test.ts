import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyWithCeremony } from '../runtime/apply-ceremony.js';
import { captureSnapshot } from '../sessions/snapshots.js';
import { planRollback } from './rollback.js';
import type { LedgerRecord } from './index.js';

describe('planRollback', () => {
  let cwd: string;
  let sessionsRoot: string;
  const sessionId = 'thread-test';

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-rollback-cwd-'));
    sessionsRoot = await mkdtemp(join(tmpdir(), 'dc-rollback-sessions-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(sessionsRoot, { recursive: true, force: true });
  });

  function record(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
    return {
      id: 'chg-1',
      timestamp: '2026-08-08T00:00:00.000Z',
      actor: 'agent',
      tool: 'Edit',
      threadId: sessionId,
      paths: ['a.ts'],
      summary: 'edited a.ts',
      rollbackHint: { kind: 'snapshot', ref: '1' },
      ...overrides,
    };
  }

  it('restores the pre-change contents through the ceremony', async () => {
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

    const planned = await planRollback({ record: record(), sessionsRoot, cwd });
    expect(planned.status).toBe('ready');
    if (planned.status !== 'ready') return;

    const outcome = await applyWithCeremony(planned.plan, async () => 'accept');
    expect(outcome.status).toBe('applied');
    expect(await readFile(file, 'utf8')).toBe('original\n');
  });

  it('changes nothing when the user rejects', async () => {
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

    const planned = await planRollback({ record: record(), sessionsRoot, cwd });
    if (planned.status !== 'ready') throw new Error('expected a plan');
    await applyWithCeremony(planned.plan, async () => 'reject');
    expect(await readFile(file, 'utf8')).toBe('changed\n');
  });

  it('deletes a file that did not exist before the change', async () => {
    const file = join(cwd, 'new.ts');
    await captureSnapshot({
      sessionsRoot,
      sessionId,
      cwd,
      filePath: file,
      reason: 'pre-Write',
      seq: 1,
    });
    await writeFile(file, 'created\n');

    const planned = await planRollback({
      record: record({ paths: ['new.ts'], summary: 'wrote new.ts' }),
      sessionsRoot,
      cwd,
    });
    if (planned.status !== 'ready') throw new Error('expected a plan');
    expect(planned.plan.explanation.application).toContain('delete');
    await applyWithCeremony(planned.plan, async () => 'accept');
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  describe('what it refuses to plan', () => {
    it('a record with no rollback hint', async () => {
      const planned = await planRollback({
        record: record({ rollbackHint: undefined }),
        sessionsRoot,
        cwd,
      });
      expect(planned).toMatchObject({ status: 'unavailable' });
      if (planned.status === 'unavailable') expect(planned.reason).toContain('no rollback point');
    });

    it('a record not tied to a session', async () => {
      const planned = await planRollback({
        record: record({ threadId: undefined }),
        sessionsRoot,
        cwd,
      });
      expect(planned).toMatchObject({ status: 'unavailable' });
    });

    it('a snapshot that has aged out', async () => {
      // Snapshots and ledger records expire on different schedules, so this is
      // normal rather than corruption — the user gets a reason, not a stack.
      const planned = await planRollback({ record: record(), sessionsRoot, cwd });
      expect(planned).toMatchObject({ status: 'unavailable' });
      if (planned.status === 'unavailable') expect(planned.reason).toContain('no longer available');
    });
  });

  describe('conflict warnings', () => {
    it('warns that later edits to the same file will be discarded', async () => {
      const file = join(cwd, 'a.ts');
      await writeFile(file, 'v1\n');
      await captureSnapshot({
        sessionsRoot,
        sessionId,
        cwd,
        filePath: file,
        reason: 'pre-Edit',
        seq: 1,
      });
      await writeFile(file, 'v2\n');
      await captureSnapshot({
        sessionsRoot,
        sessionId,
        cwd,
        filePath: file,
        reason: 'post-Edit',
        seq: 2,
      });
      await captureSnapshot({
        sessionsRoot,
        sessionId,
        cwd,
        filePath: file,
        reason: 'pre-Edit',
        seq: 3,
      });
      await writeFile(file, 'v3\n');

      const planned = await planRollback({ record: record(), sessionsRoot, cwd });
      if (planned.status !== 'ready') throw new Error('expected a plan');
      expect(planned.plan.warnings.join(' ')).toContain('later change');
    });

    it('does not count the post-capture of the same call as a later edit', async () => {
      // Otherwise every single-edit rollback would warn about itself and the
      // warning would stop meaning anything.
      const file = join(cwd, 'a.ts');
      await writeFile(file, 'v1\n');
      await captureSnapshot({
        sessionsRoot,
        sessionId,
        cwd,
        filePath: file,
        reason: 'pre-Edit',
        seq: 1,
      });
      await writeFile(file, 'v2\n');
      await captureSnapshot({
        sessionsRoot,
        sessionId,
        cwd,
        filePath: file,
        reason: 'post-Edit',
        seq: 2,
      });

      const planned = await planRollback({ record: record(), sessionsRoot, cwd });
      if (planned.status !== 'ready') throw new Error('expected a plan');
      expect(planned.plan.warnings.join(' ')).not.toContain('later change');
    });

    it('warns when the file was modified outside DeepCode', async () => {
      const file = join(cwd, 'a.ts');
      await writeFile(file, 'v1\n');
      await captureSnapshot({
        sessionsRoot,
        sessionId,
        cwd,
        filePath: file,
        reason: 'pre-Edit',
        seq: 1,
      });
      await writeFile(file, 'v2\n');
      await captureSnapshot({
        sessionsRoot,
        sessionId,
        cwd,
        filePath: file,
        reason: 'post-Edit',
        seq: 2,
      });
      await writeFile(file, 'edited by hand\n');

      const planned = await planRollback({ record: record(), sessionsRoot, cwd });
      if (planned.status !== 'ready') throw new Error('expected a plan');
      expect(planned.plan.warnings.join(' ')).toContain('outside DeepCode');
    });
  });

  it('explains all four things before asking', async () => {
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

    const planned = await planRollback({ record: record(), sessionsRoot, cwd });
    if (planned.status !== 'ready') throw new Error('expected a plan');
    const { explanation } = planned.plan;
    expect(explanation.source).toContain('chg-1');
    expect(explanation.method).toBeTruthy();
    expect(explanation.application).toBeTruthy();
    expect(explanation.rollback).toBeTruthy();
  });
});
