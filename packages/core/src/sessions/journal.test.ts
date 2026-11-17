import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  appendFile,
  rm,
  readdir,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import ts from 'typescript';
import { projectJournal } from './journal.js';
import { SessionManager } from './manager.js';
import { importLegacySession } from './importer.js';
import { writeMeta, appendMessage } from './storage.js';

let directory: string;
let manager: SessionManager;
const children: ChildProcess[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dc-journal-'));
  manager = new SessionManager({ root: join(directory, 'sessions') });
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    }
  }
  await rm(directory, { recursive: true, force: true });
});
const msg = (text: string) => ({
  role: 'user' as const,
  content: [{ type: 'text' as const, text }],
});
async function files(id: string) {
  const path = join(manager.resourceRoot, id);
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  return { path, manifest, log: join(path, `journal-${manifest.generation}.jsonl`) };
}
async function childWriter(id: string, mode = 'hold') {
  const fixture = join(directory, 'worker');
  await mkdir(fixture, { recursive: true });
  // Transpile the actual implementation, not a separately maintained lock fixture.
  for (const name of ['journal', 'lease', 'storage']) {
    const source = await readFile(new URL(`./${name}.ts`, import.meta.url), 'utf8');
    await writeFile(
      join(fixture, `${name}.mjs`),
      ts
        .transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
        })
        .outputText.replaceAll("'./lease.js'", "'./lease.mjs'")
        .replaceAll("'./storage.js'", "'./storage.mjs'"),
    );
  }
  const script = `import { SessionJournal } from ${JSON.stringify(new URL(`file://${fixture}/journal.mjs`).href)};\nconst journal = new SessionJournal(process.argv[1], process.argv[2]);\ntry { await journal.withWriter(async () => { process.stdout.write('owned\\n'); await new Promise(resolve => ${mode === 'hold' ? 'setInterval(()=>{},1000)' : 'setTimeout(resolve,500)'}); }); } catch(e) { process.stdout.write('blocked\\n'); process.exitCode=7; }`;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', script, manager.resourceRoot, id],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.push(child);
  const [output] = await once(child.stdout!, 'data');
  return { child, output: String(output) };
}
describe('session-v2 committed journal', () => {
  it('writes only v2, projects checkpoints without deleting history, and uses private files', async () => {
    const meta = await manager.create('/work');
    await manager.append(meta.id, msg('first'));
    await manager.materialize(meta, [msg('summary')]);
    const journal = manager.journal(meta.id);
    const events = (await journal.read())!;
    expect(projectJournal(events)).toEqual(await journal.projection());
    expect((await manager.load(meta.id))?.messages).toEqual([msg('summary')]);
    expect(events.find((event) => event.type === 'message.appended')?.payload.message).toEqual(
      msg('first'),
    );
    const { path, log } = await files(meta.id);
    expect((await stat(path)).mode & 0o777).toBe(0o700);
    expect((await stat(log)).mode & 0o777).toBe(0o600);
    expect(await readdir(manager.root).catch(() => [])).toEqual([]);
  });
  it('repairs only bytes beyond the committed cursor, and refuses committed corruption', async () => {
    const meta = await manager.create('/work');
    const { log } = await files(meta.id);
    await appendFile(log, '{"uncommitted":');
    expect((await manager.load(meta.id))?.messages).toEqual([]);
    await manager.append(meta.id, msg('after crash'));
    expect((await manager.load(meta.id))?.messages).toEqual([msg('after crash')]);
    const bytes = await readFile(log);
    bytes[20] = bytes[20] === 97 ? 98 : 97;
    await writeFile(log, bytes);
    await expect(manager.append(meta.id, msg('must not write'))).rejects.toThrow('checksum');
    expect(await readFile(log)).toEqual(bytes);
  });
  it('refuses future manifests/required semantics while retaining opaque extension events', async () => {
    const meta = await manager.create('/work');
    await manager.record(meta.id, [{ type: 'extension.fixture', payload: { unknown: 42 } }]);
    expect((await manager.journal(meta.id).read())!.at(-1)?.payload).toEqual({ unknown: 42 });
    await expect(
      manager.record(meta.id, [{ type: 'extension.future', payload: { required: true } }]),
    ).rejects.toThrow('required');
    const { path, manifest } = await files(meta.id);
    await writeFile(
      join(path, 'manifest.json'),
      JSON.stringify({ ...manifest, schemaVersion: 99 }),
    );
    await expect(manager.load(meta.id)).rejects.toThrow('future');
    await expect(manager.append(meta.id, msg('no'))).rejects.toThrow('future');
  });
  it('rejects a second process for the entire live writer scope, then recovers after SIGKILL', async () => {
    const meta = await manager.create('/work');
    const { child, output } = await childWriter(meta.id);
    expect(output).toContain('owned');
    await expect(manager.append(meta.id, msg('conflict'))).rejects.toThrow('active writer');
    const { log } = await files(meta.id);
    await appendFile(log, '{"partial crash tail":');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    await manager.append(meta.id, msg('recovered'));
    expect((await manager.load(meta.id))?.messages).toEqual([msg('recovered')]);
  });
  it('allows exactly one simultaneous successor without stale-lock unlink races', async () => {
    const meta = await manager.create('/work');
    const results = await Promise.all([
      childWriter(meta.id, 'release'),
      childWriter(meta.id, 'release'),
    ]);
    expect(results.filter((result) => result.output.includes('owned'))).toHaveLength(1);
    expect(results.filter((result) => result.output.includes('blocked'))).toHaveLength(1);
    await Promise.all(
      results
        .filter((result) => result.child.exitCode === null)
        .map((result) => once(result.child, 'exit')),
    );
    await manager.append(meta.id, msg('next'));
  });
  it('serializes writes within a held scope and rejects late callbacks from released scopes', async () => {
    const meta = await manager.create('/work');
    let late!: () => Promise<void>;
    await manager.withWriter(meta.id, async () => {
      await Promise.all([manager.append(meta.id, msg('a')), manager.append(meta.id, msg('b'))]);
      const { AsyncResource } = await import('node:async_hooks');
      const resource = new AsyncResource('late');
      late = () => resource.runInAsyncScope(() => manager.append(meta.id, msg('late')));
    });
    await expect(late()).rejects.toThrow('scope has ended');
    expect((await manager.load(meta.id))?.messages).toHaveLength(2);
  });
});
describe('read-only legacy import', () => {
  it.each(['core-v0', 'desktop-v0', 'canonical-v1'])(
    'migrates %s idempotently without changing sources',
    async (format) => {
      const id = 'old';
      const meta = { id, cwd: '/work', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
      await mkdir(manager.root, { recursive: true });
      if (format === 'canonical-v1') {
        await writeMeta(manager.root, meta);
        await appendMessage(manager.root, id, msg('original'));
      } else if (format === 'core-v0') {
        await writeFile(join(manager.root, `${id}.meta.json`), JSON.stringify(meta));
        await writeFile(join(manager.root, `${id}.jsonl`), JSON.stringify(msg('original')) + '\n');
      } else
        await writeFile(
          join(manager.root, `${id}.jsonl`),
          JSON.stringify({ type: 'session_meta', ...meta }) +
            '\n' +
            JSON.stringify({ type: 'message', ...msg('original') }) +
            '\n',
        );
      const names = await readdir(manager.root);
      const before = await Promise.all(names.map((name) => readFile(join(manager.root, name))));
      expect((await manager.load(id))?.messages).toHaveLength(1);
      await manager.append(id, msg('v2 only'));
      expect(await importLegacySession(manager.root, manager.journal(id))).toBe(true);
      expect((await manager.load(id))?.messages).toHaveLength(2);
      expect(await Promise.all(names.map((name) => readFile(join(manager.root, name))))).toEqual(
        before,
      );
      expect(
        (await manager.journal(id).read())!.filter((event) => event.type === 'session.imported'),
      ).toHaveLength(1);
      // Downgrade source remains readable and unaware of v2 continuation.
      expect((await import('./storage.js')).readMessages).toBeDefined();
    },
  );
  it('does not publish interrupted imports; retry sees the original source', async () => {
    const meta = { id: 'old', cwd: '/work', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    await writeMeta(manager.root, meta);
    const journal = manager.journal(meta.id);
    const append = vi
      .spyOn(journal, 'append')
      .mockRejectedValueOnce(new Error('injected crash before commit'));
    await expect(importLegacySession(manager.root, journal)).rejects.toThrow('injected');
    expect(await journal.read()).toBeNull();
    append.mockRestore();
    await expect(importLegacySession(manager.root, journal)).resolves.toBe(true);
  });
  it('respects the shared Rust/TS writer barrier and rejects unknown engine versions', async () => {
    const meta = { id: 'old', cwd: '/work', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    await writeMeta(manager.root, meta);
    const lock = join(manager.root, 'old.writer.lock');
    await writeFile(lock, 'pid=123');
    await expect(manager.append(meta.id, msg('no'))).rejects.toThrow('active writer');
    await rm(lock);
    await mkdir(join(manager.root, 'old'));
    await writeFile(
      join(manager.root, 'old', 'engine.json'),
      JSON.stringify({ version: 99, engine: 'native' }),
    );
    await expect(manager.append(meta.id, msg('no'))).rejects.toThrow('Unknown legacy engine');
    expect(await manager.journal(meta.id).read()).toBeNull();
  });
  it('rejects future legacy formats and private SDK continuation migration', async () => {
    await mkdir(manager.root, { recursive: true });
    await writeFile(
      join(manager.root, 'future.v1.jsonl'),
      JSON.stringify({ type: 'session_meta', schema_version: 99, meta: { id: 'future' } }) + '\n',
    );
    await expect(manager.load('future')).rejects.toThrow('Unsupported');
    await writeMeta(manager.root, { id: 'sdk', cwd: '/work', createdAt: 'now', updatedAt: 'now' });
    await mkdir(join(manager.root, 'sdk/claude-sdk'), { recursive: true });
    await writeFile(join(manager.root, 'sdk/claude-sdk/binding.json'), '{}');
    await expect(manager.append('sdk', msg('no'))).rejects.toThrow('read-only');
  });
  it('explicit deletion removes private payloads and leaves only a non-content tombstone', async () => {
    await writeMeta(manager.root, { id: 'old', cwd: '/work', createdAt: 'now', updatedAt: 'now' });
    await manager.append('old', msg('private-payload'));
    await manager.delete('old');
    expect(await manager.load('old')).toBeNull();
    expect(await manager.list()).toEqual([]);
    await expect(readFile(join(manager.root, 'old.v1.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const { log } = await files('old');
    expect(await readFile(log, 'utf8')).not.toContain('private-payload');
    await expect(manager.append('old', msg('no'))).rejects.toThrow('deleted');
  });
});

it('copies and validates legacy snapshot resources while preserving the source manifest', async () => {
  const { captureSnapshot } = await import('./snapshots.js');
  const meta = { id: 'snapshot-old', cwd: directory, createdAt: 'now', updatedAt: 'now' };
  await writeMeta(manager.root, meta);
  const file = join(directory, 'source');
  await writeFile(file, 'original');
  const original = await captureSnapshot({
    sessionsRoot: manager.root,
    sessionId: meta.id,
    cwd: directory,
    filePath: file,
    reason: 'pre-Edit',
    seq: 1,
  });
  const sourceManifest = join(manager.root, meta.id, 'snapshots/manifest.jsonl');
  const before = await readFile(sourceManifest);
  await manager.append(meta.id, msg('continue'));
  expect(await manager.fileSnapshots(meta.id, file)).toMatchObject([
    { content: 'original', seq: 1 },
  ]);
  expect(await readFile(sourceManifest)).toEqual(before);
  expect((await manager.snapshots(meta.id))[0]?.blobPath).not.toBe(original?.blobPath);
});
it('rejects orphaned empty SDK directories and snapshot checksum mismatch before publication', async () => {
  const { captureSnapshot } = await import('./snapshots.js');
  await writeMeta(manager.root, {
    id: 'empty-sdk',
    cwd: directory,
    createdAt: 'now',
    updatedAt: 'now',
  });
  await mkdir(join(manager.root, 'empty-sdk/claude-sdk'), { recursive: true });
  await expect(manager.append('empty-sdk', msg('no'))).rejects.toThrow('read-only');
  const id = 'bad-blob';
  await writeMeta(manager.root, { id, cwd: directory, createdAt: 'now', updatedAt: 'now' });
  const file = join(directory, 'source');
  await writeFile(file, 'original');
  const snapshot = await captureSnapshot({
    sessionsRoot: manager.root,
    sessionId: id,
    cwd: directory,
    filePath: file,
    reason: 'pre-Edit',
    seq: 1,
  });
  await writeFile(snapshot!.blobPath, 'corrupt');
  await expect(manager.append(id, msg('no'))).rejects.toThrow('checksum');
  expect(await manager.journal(id).read()).toBeNull();
});

it.each(['different', 'same', 'missing'])(
  'does not reuse a previous call result for a pending call ID (turn IDs: %s)',
  async (turnIds) => {
    const meta = await manager.create(directory);
    const oldTurn = turnIds === 'missing' ? undefined : 'old';
    const nextTurn = turnIds === 'same' ? oldTurn : turnIds === 'missing' ? undefined : 'new';
    const toolUse = {
      role: 'assistant' as const,
      content: [{ type: 'tool_use' as const, id: 'reused', name: 'Write', input: {} }],
    };
    await manager.record(meta.id, [
      {
        type: 'message.appended',
        turnId: oldTurn,
        payload: { message: toolUse },
      },
      {
        type: 'tool.intent',
        turnId: oldTurn,
        callId: 'reused',
        payload: { name: 'Write' },
      },
      {
        type: 'tool.result',
        turnId: oldTurn,
        callId: 'reused',
        payload: { name: 'Write', result: { content: 'old success', isError: false } },
      },
      {
        type: 'message.appended',
        turnId: oldTurn,
        payload: {
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'reused', content: 'old success' }],
          },
        },
      },
      {
        type: 'message.appended',
        turnId: nextTurn,
        payload: { message: toolUse },
      },
    ]);
    await manager.recoverInterrupted(meta.id);
    expect((await manager.load(meta.id))!.messages.at(-1)?.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'reused',
      is_error: true,
      content: expect.stringContaining('Execution outcome unknown'),
    });
  },
);
