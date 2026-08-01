#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { glob, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionBundle = join(root, 'apps/vscode/dist/extension.cjs');
const appServerBundle = join(root, 'apps/vscode/dist/app-server.cjs');
const vsixBundle = join(root, 'apps/vscode/dist/deepcode-release-gate.vsix');
const reportPath = join(root, 'apps/vscode/dist/release-gate-report.json');

const budgets = {
  extensionBytes: 64 * 1024,
  appServerBytes: 768 * 1024,
  vsixBytes: 256 * 1024,
  initializeMs: 5_000,
  metadataRequestMs: 2_000,
  workspaceDiffMs: 10_000,
};

const report = {
  status: 'failed',
  platform: `${process.platform}-${process.arch}`,
  budgets,
  bundles: {},
  journeys: [],
  architectureScan: {},
};

let temporaryHome;

try {
  report.bundles = await verifyBundleBudgets();
  report.architectureScan = await verifyThinClients();
  temporaryHome = await mkdtemp(join(tmpdir(), 'deepcode-release-gate-'));

  const first = await runJourney(temporaryHome, async (server) => {
    const initialized = await server.request('initialize', {}, budgets.initializeMs);
    verifyCapabilities(initialized.result);
    const thread = await server.request('thread/start', { cwd: root }, budgets.metadataRequestMs);
    const threadId = requiredString(thread.result, 'id');
    const read = await server.request('thread/read', { threadId }, budgets.metadataRequestMs);
    assert(read.result?.id === threadId, 'thread/read did not return the created thread');
    const diagnostics = await server.request(
      'config/diagnostics',
      { cwd: root },
      budgets.metadataRequestMs,
    );
    assert(
      ['trusted', 'plan-only', 'untrusted'].includes(diagnostics.result?.trustStatus),
      'config/diagnostics returned an invalid trust state',
    );
    const diff = await server.request('workspace/diff', { threadId }, budgets.workspaceDiffMs);
    assert(typeof diff.result?.repository === 'boolean', 'workspace/diff shape is invalid');
    return {
      threadId,
      timings: {
        initializeMs: initialized.durationMs,
        threadStartMs: thread.durationMs,
        threadReadMs: read.durationMs,
        configDiagnosticsMs: diagnostics.durationMs,
        workspaceDiffMs: diff.durationMs,
      },
    };
  });
  report.journeys.push({ name: 'create-and-read', ...first });

  const second = await runJourney(temporaryHome, async (server) => {
    const initialized = await server.request('initialize', {}, budgets.initializeMs);
    verifyCapabilities(initialized.result);
    const read = await server.request(
      'thread/read',
      { threadId: first.threadId },
      budgets.metadataRequestMs,
    );
    assert(read.result?.id === first.threadId, 'thread was not durable across app-server restart');
    const resumed = await server.request(
      'thread/resume',
      { threadId: first.threadId },
      budgets.metadataRequestMs,
    );
    assert(resumed.result?.id === first.threadId, 'thread/resume failed after restart');
    return {
      threadId: first.threadId,
      timings: {
        initializeMs: initialized.durationMs,
        threadReadMs: read.durationMs,
        threadResumeMs: resumed.durationMs,
      },
    };
  });
  report.journeys.push({ name: 'restart-and-resume', ...second });
  report.status = 'ok';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (temporaryHome) await rm(temporaryHome, { recursive: true, force: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {});
  const output = `${JSON.stringify(report, null, 2)}\n`;
  (process.exitCode ? process.stderr : process.stdout).write(output);
}

async function verifyBundleBudgets() {
  const [extension, appServer, vsix, vsixContent] = await Promise.all([
    stat(extensionBundle),
    stat(appServerBundle),
    stat(vsixBundle),
    readFile(vsixBundle),
  ]);
  assert(
    extension.size <= budgets.extensionBytes,
    `extension bundle is ${extension.size} bytes; budget is ${budgets.extensionBytes}`,
  );
  assert(
    appServer.size <= budgets.appServerBytes,
    `app-server bundle is ${appServer.size} bytes; budget is ${budgets.appServerBytes}`,
  );
  assert(
    vsix.size <= budgets.vsixBytes,
    `VSIX is ${vsix.size} bytes; budget is ${budgets.vsixBytes}`,
  );
  for (const entry of ['extension/dist/extension.cjs', 'extension/dist/app-server.cjs']) {
    assert(vsixContent.includes(Buffer.from(entry)), `VSIX is missing ${entry}`);
  }
  return {
    extensionBytes: extension.size,
    appServerBytes: appServer.size,
    vsixBytes: vsix.size,
  };
}

async function verifyThinClients() {
  const violations = [];
  const patterns = [
    {
      label: 'sensitive core runtime import',
      pattern:
        /(?:from\s+|require\()['"]@deepcode\/core(?:\/dist)?\/(?:agent|runtime|providers\/deepseek|credentials)(?:\.js)?['"]/,
    },
    {
      label: 'bare core runtime import',
      pattern: /(?:from\s+|require\()['"]@deepcode\/core['"]/,
    },
    {
      label: 'runtime or credential implementation',
      pattern:
        /\b(?:new\s+DeepSeekProvider|new\s+RuntimeHost|dangerouslyAllowBrowser|DEEPSEEK_API_KEY)\b/,
    },
  ];
  const roots = ['apps/desktop/src', 'apps/vscode/src', 'apps/lsp/src'];
  let filesChecked = 0;
  for (const sourceRoot of roots) {
    for await (const path of glob(`${sourceRoot}/**/*.{ts,tsx}`, { cwd: root })) {
      if (/\.(?:test|spec)\.[^.]+$/.test(path) || path.includes('/preview-')) continue;
      filesChecked++;
      const source = await readFile(join(root, path), 'utf8');
      for (const candidate of patterns) {
        if (candidate.pattern.test(source)) violations.push(`${path}: ${candidate.label}`);
      }
    }
  }
  assert(violations.length === 0, `thin-client boundary violations:\n${violations.join('\n')}`);
  return { filesChecked, violations };
}

function verifyCapabilities(result) {
  assert(result?.protocolVersion === 1, `unsupported protocol version: ${result?.protocolVersion}`);
  for (const capability of [
    'threadResume',
    'turnInterrupt',
    'completedItemPersistence',
    'transientDeltas',
    'structuredToolEvents',
    'interactiveRequests',
    'configDiagnostics',
    'diagnosticExport',
    'workspaceDiff',
    'reviewActions',
  ]) {
    assert(result.capabilities?.[capability] === true, `missing capability: ${capability}`);
  }
}

async function runJourney(home, task) {
  const server = startServer(home);
  try {
    return await task(server);
  } finally {
    await server.close();
  }
}

function startServer(home) {
  const startedAt = performance.now();
  const child = spawn(process.execPath, [appServerBundle], {
    cwd: root,
    env: sanitizedEnvironment(home),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  let sequence = 0;
  let stderr = '';
  let disconnected;
  const exited = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => {
      disconnected = new Error(`app-server exited (code=${code}, signal=${signal})`);
      for (const request of pending.values()) request.reject(disconnected);
      pending.clear();
      resolveExit({ code, signal });
    });
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_192);
  });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      disconnected = new Error('app-server emitted invalid JSON');
      return;
    }
    if (message.method === 'event') return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else
      request.resolve({
        result: message.result,
        durationMs: round(performance.now() - request.at),
      });
  });

  return {
    request(method, params, timeoutMs) {
      if (disconnected) return Promise.reject(disconnected);
      const id = ++sequence;
      return new Promise((resolveRequest, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} exceeded ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, {
          at: method === 'initialize' ? startedAt : performance.now(),
          resolve: resolveRequest,
          reject,
          timeout,
        });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end();
      const result = await Promise.race([
        exited,
        new Promise((resolveExit) =>
          setTimeout(() => resolveExit({ code: null, signal: 'timeout' }), 5_000),
        ),
      ]);
      if (result.signal === 'timeout') child.kill('SIGKILL');
      assert(result.code === 0, `app-server shutdown failed: ${stderr || JSON.stringify(result)}`);
    },
  };
}

function sanitizedEnvironment(home) {
  const env = { ...process.env, DEEPCODE_HOME: home, HOME: home };
  for (const key of [
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ]) {
    delete env[key];
  }
  return env;
}

function requiredString(value, key) {
  const candidate = value?.[key];
  assert(typeof candidate === 'string' && candidate.length > 0, `missing string field: ${key}`);
  return candidate;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
