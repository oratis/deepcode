#!/usr/bin/env node
// Exercise the actual signed Node and server, without a developer PATH or home.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';

const app = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: verify-mac-runtime.mjs /path/to/DeepCode.app');
const home = await mkdtemp(join(tmpdir(), 'deepcode-mac-smoke-'));
const workspace = join(home, 'workspace');
await mkdir(workspace);

async function journey(run) {
  const child = spawn(join(app, 'Contents/MacOS/deepcode-runtime'), [
    join(app, 'Contents/Resources/app-server.cjs'),
  ], {
    cwd: workspace,
    env: { PATH: '', HOME: home, DEEPCODE_HOME: join(home, 'data') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let sequence = 0;
  let stderr = '';
  let exited = false;
  const rejectPending = (error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  const exit = new Promise((resolveExit) => {
    child.once('error', (error) => { rejectPending(error); resolveExit({ error }); });
    child.once('exit', (code, signal) => {
      exited = true;
      rejectPending(new Error(`Runtime exited: ${code}/${signal}: ${stderr}`));
      resolveExit({ code, signal });
    });
  });
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-8000); });
  child.stdin.on('error', rejectPending);
  const reader = createInterface({ input: child.stdout });
  reader.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id === null && message.error) throw new Error(JSON.stringify(message.error));
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id);
      if (message.error) p.reject(new Error(JSON.stringify(message.error)));
      else p.resolve(message.result);
    } catch (error) { rejectPending(error); }
  });
  const request = (method, params = {}) => new Promise((resolveRequest, reject) => {
    if (exited) { reject(new Error('Runtime already exited')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout: ${method}`));
    }, 10000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolveRequest(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  try {
    const initialized = await request('initialize');
    assert.equal(initialized.protocolVersion, 1);
    assert.equal(initialized.capabilities.sessionJournal, true);
    await run(request);
    child.stdin.end();
    let timer;
    const result = await Promise.race([
      exit,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Shutdown timeout')), 10000);
      }),
    ]).finally(() => clearTimeout(timer));
    assert.equal(result.code, 0, stderr);
  } finally {
    if (!exited) child.kill('SIGKILL');
    await exit;
    reader.close();
  }
}

try {
  let id;
  await journey(async (request) => {
    const thread = await request('thread/start', { cwd: workspace });
    id = thread.id;
    assert.equal((await request('thread/read', { threadId: id })).id, id);
    await request('thread/rename', { threadId: id, title: 'Signed Mac release smoke' });
    assert.deepEqual(await request('session/snapshots', {
      threadId: id, path: join(workspace, 'file.txt'),
    }), []);
    const fork = await request('thread/fork', { threadId: id });
    await request('thread/delete', { threadId: fork.id });
    const archived = await request('thread/fork', { threadId: id });
    await request('thread/archive', { threadId: archived.id });
    const listed = await request('thread/list');
    assert.deepEqual(listed.threads.map((thread) => thread.id), [id]);
    await request('runtime/capabilities', { cwd: workspace });
  });
  await journey(async (request) => {
    const resumed = await request('thread/resume', { threadId: id });
    assert.equal(resumed.id, id);
    assert.equal(resumed.title, 'Signed Mac release smoke');
  });
  process.stdout.write(JSON.stringify({ status: 'passed', app, emptyPath: true, restart: true }) + '\n');
} finally {
  await rm(home, { recursive: true, force: true });
}
