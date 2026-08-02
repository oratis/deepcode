import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConfigDiagnosticsResult } from '@deepcode/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { exportDiagnosticBundle } from './diagnostic-export.js';
import { StructuredLogger } from './structured-logger.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'deepcode-trace-'));
  roots.push(root);
  return root;
}

describe('StructuredLogger', () => {
  it('persists only allowlisted metadata even when a caller passes secrets', async () => {
    const root = await temporaryRoot();
    const logger = new StructuredLogger({
      directory: join(root, 'logs'),
      now: () => '2026-08-01T00:00:00.000Z',
    });
    logger.record({
      event: 'protocol.request.failed',
      traceId: 'trace-1',
      method: 'turn/start',
      code: 'internal_error',
      prompt: 'SECRET_PROMPT',
      command: 'curl -H Authorization:SECRET_HEADER',
      message: 'SECRET_ERROR',
    } as never);
    logger.recordProtocolEvent({
      type: 'tool.started',
      traceId: 'trace-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      name: 'Bash',
      input: { command: 'SECRET_TOOL_INPUT' },
    });
    await logger.flush();

    const contents = await readFile(logger.path, 'utf8');
    expect(contents).toContain('trace-1');
    expect(contents).toContain('tool.started');
    expect(contents).not.toMatch(/SECRET_|Authorization|curl/);
    expect((await stat(logger.path)).mode & 0o777).toBe(0o600);
  });

  it('rotates bounded log files', async () => {
    const root = await temporaryRoot();
    const logger = new StructuredLogger({
      directory: join(root, 'logs'),
      maxBytes: 1,
      retainedFiles: 2,
    });
    logger.record({ event: 'first', traceId: 'trace-1' });
    logger.record({ event: 'second', traceId: 'trace-2' });
    logger.record({ event: 'third', traceId: 'trace-3' });
    await logger.flush();

    await expect(readFile(logger.path, 'utf8')).resolves.toContain('trace-3');
    await expect(readFile(`${logger.path}.1`, 'utf8')).resolves.toContain('trace-2');
    await expect(readFile(`${logger.path}.2`, 'utf8')).resolves.toContain('trace-1');
  });
});

describe('exportDiagnosticBundle', () => {
  it('hashes paths and re-sanitizes stored log records', async () => {
    const root = await temporaryRoot();
    const cwd = join(root, 'secret-customer-workspace');
    const sourcePath = join(cwd, '.deepcode', 'settings.json');
    const logPath = join(root, 'malicious.ndjson');
    await writeFile(
      logPath,
      `${JSON.stringify({
        timestamp: '2026-08-01T00:00:00.000Z',
        level: 'info',
        event: 'protocol.event',
        traceId: 'trace-1',
        method: 'SECRET_METHOD',
        threadId: 'SECRET_THREAD_ID',
        status: 'SECRET_STATUS',
        message: 'SECRET_LOG_MESSAGE',
        payload: { token: 'SECRET_TOKEN' },
      })}\n`,
    );
    const config: ConfigDiagnosticsResult = {
      cwd,
      trustStatus: 'untrusted',
      layers: [{ layer: 'project', path: sourcePath, present: true, trusted: false }],
      provenance: { '/model': { layer: 'project', path: sourcePath } },
      gated: ['/permissions'],
      issues: [
        {
          severity: 'warning',
          code: 'secret_setting',
          message: 'SECRET_ISSUE_MESSAGE',
          source: { layer: 'project', path: sourcePath },
        },
      ],
    };

    const result = await exportDiagnosticBundle({
      home: root,
      cwd,
      config,
      logPath,
      generatedAt: '2026-08-01T00:00:00.000Z',
    });
    const contents = await readFile(result.path, 'utf8');
    expect(result.recordCount).toBe(1);
    expect(contents).toContain('secret_setting');
    expect(contents).not.toMatch(
      /secret-customer-workspace|settings\.json|SECRET_|SECRET_TOKEN|SECRET_ISSUE_MESSAGE/,
    );
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
  });
});
