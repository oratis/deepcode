import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TodoWriteTool } from '../tools/todo.js';
import {
  agentsMdMissingReminder,
  buildSystemReminders,
  cwdReminder,
  dateReminder,
  externalFileModifiedReminder,
  prependReminders,
  todosPendingReminder,
} from './index.js';

describe('dateReminder', () => {
  it('formats today as YYYY-MM-DD UTC', () => {
    const r = dateReminder({ cwd: '/x', now: () => new Date(Date.UTC(2026, 4, 7)) });
    expect(r).toContain('2026-05-07');
    expect(r).toContain('UTC');
  });
});

describe('cwdReminder', () => {
  it('shows the cwd literally', () => {
    expect(cwdReminder({ cwd: '/my/project' })).toBe('Current working directory: /my/project');
  });
});

describe('agentsMdMissingReminder', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dc-rem-agents-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when AGENTS.md exists', async () => {
    await fs.writeFile(join(dir, 'AGENTS.md'), 'hello');
    expect(await agentsMdMissingReminder({ cwd: dir })).toBeNull();
  });

  it('returns null when DEEPCODE.md exists', async () => {
    await fs.writeFile(join(dir, 'DEEPCODE.md'), 'x');
    expect(await agentsMdMissingReminder({ cwd: dir })).toBeNull();
  });

  it('returns null when CLAUDE.md exists (compat)', async () => {
    await fs.writeFile(join(dir, 'CLAUDE.md'), 'x');
    expect(await agentsMdMissingReminder({ cwd: dir })).toBeNull();
  });

  it('returns nudge when neither exists', async () => {
    const r = await agentsMdMissingReminder({ cwd: dir });
    expect(r).toBeTruthy();
    expect(r).toMatch(/AGENTS\.md/);
    expect(r).toMatch(/\/init/);
  });
});

describe('todosPendingReminder', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dc-rem-todos-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when sessionDir is undefined', async () => {
    expect(await todosPendingReminder({ cwd: '/x' })).toBeNull();
  });

  it('returns null when no todos exist', async () => {
    expect(await todosPendingReminder({ cwd: '/x', sessionDir: dir })).toBeNull();
  });

  it('returns null when all todos are completed', async () => {
    await TodoWriteTool.execute(
      {
        todos: [
          { content: 'A', activeForm: 'A-ing', status: 'completed' },
          { content: 'B', activeForm: 'B-ing', status: 'completed' },
        ],
      },
      { cwd: '/x', sessionDir: dir },
    );
    expect(await todosPendingReminder({ cwd: '/x', sessionDir: dir })).toBeNull();
  });

  it('lists in_progress + pending items, with activeForm for in_progress', async () => {
    await TodoWriteTool.execute(
      {
        todos: [
          { content: 'Write tests', activeForm: 'Writing tests', status: 'in_progress' },
          { content: 'Open PR', activeForm: 'Opening PR', status: 'pending' },
          { content: 'Plan', activeForm: 'Planning', status: 'completed' },
        ],
      },
      { cwd: '/x', sessionDir: dir },
    );
    const r = await todosPendingReminder({ cwd: '/x', sessionDir: dir });
    expect(r).toBeTruthy();
    expect(r).toMatch(/Writing tests/); // in_progress uses activeForm
    expect(r).toMatch(/Open PR/);
    expect(r).not.toMatch(/Plan(?!ning)/); // completed is excluded
  });
});

describe('externalFileModifiedReminder', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dc-rem-files-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when no known files', async () => {
    expect(await externalFileModifiedReminder({ cwd: '/x' })).toBeNull();
  });

  it('returns null when known files mtimes match', async () => {
    const fp = join(dir, 'a.txt');
    await fs.writeFile(fp, 'hi');
    const stat = await fs.stat(fp);
    const r = await externalFileModifiedReminder({
      cwd: '/x',
      knownFiles: new Map([[fp, stat.mtimeMs]]),
    });
    expect(r).toBeNull();
  });

  it('lists files whose mtime drifted by more than 1s', async () => {
    const fp = join(dir, 'a.txt');
    await fs.writeFile(fp, 'hi');
    // Simulate "agent saw it 10s ago" by providing an older mtime
    const old = Date.now() - 10_000;
    const r = await externalFileModifiedReminder({
      cwd: '/x',
      knownFiles: new Map([[fp, old]]),
    });
    expect(r).toBeTruthy();
    expect(r).toMatch(/Files modified externally/);
    expect(r).toContain(fp);
  });

  it('flags files that have been deleted', async () => {
    const r = await externalFileModifiedReminder({
      cwd: '/x',
      knownFiles: new Map([['/tmp/does-not-exist-' + Date.now(), Date.now()]]),
    });
    expect(r).toBeTruthy();
  });

  it('truncates list at 5 items with a "more" suffix', async () => {
    const knownFiles = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      const p = join(dir, `f${i}.txt`);
      await fs.writeFile(p, 'x');
      knownFiles.set(p, Date.now() - 10_000);
    }
    const r = await externalFileModifiedReminder({ cwd: '/x', knownFiles });
    expect(r).toMatch(/and 5 more/);
  });
});

describe('buildSystemReminders', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dc-rem-build-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('wraps every reminder in a single <system-reminder> block', async () => {
    const r = await buildSystemReminders({ cwd: dir });
    expect(r).toMatch(/^<system-reminder>/);
    expect(r).toMatch(/<\/system-reminder>$/);
    expect(r).toMatch(/Today's date/);
    expect(r).toMatch(/Current working directory/);
  });

  it('returns null when every builder returns null', async () => {
    // Existing AGENTS.md + no sessionDir + no known files → only date+cwd
    // remain, both always fire. So we need to disable them via opts to test.
    const r = await buildSystemReminders({ cwd: dir }, { enabled: ['todos-pending'] });
    expect(r).toBeNull();
  });

  it('respects `enabled` filter', async () => {
    const r = await buildSystemReminders({ cwd: dir }, { enabled: ['date'] });
    expect(r).toMatch(/Today's date/);
    expect(r).not.toMatch(/Current working directory/);
  });

  it('does not poison the batch on one builder error', async () => {
    // sessionDir points at a non-existent location → todos read returns []
    // (silent), so other builders still fire.
    const r = await buildSystemReminders({ cwd: dir, sessionDir: '/no/such/path' });
    expect(r).toMatch(/Today's date/);
  });
});

describe('prependReminders', () => {
  it('prepends block + blank line + user message', async () => {
    const out = await prependReminders('hi', { cwd: '/x' }, { enabled: ['date'] });
    expect(out).toMatch(/^<system-reminder>[\s\S]+<\/system-reminder>\n\nhi$/);
  });

  it('returns the user message unchanged when no reminders fire', async () => {
    const out = await prependReminders(
      'hi',
      { cwd: '/x', sessionDir: '/no' },
      { enabled: ['todos-pending'] },
    );
    expect(out).toBe('hi');
  });
});
