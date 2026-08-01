import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { VERSION } from '@deepcode/core';
import {
  PROTOCOL_VERSION,
  type ConfigDiagnosticsResult,
  type DiagnosticExportResult,
} from '@deepcode/protocol';

import { sanitizeStructuredLogRecord } from './structured-logger.js';

export interface DiagnosticExportOptions {
  home: string;
  cwd: string;
  config: ConfigDiagnosticsResult;
  generatedAt?: string;
  logPath?: string;
  maxLogRecords?: number;
}

/** Create a support bundle that contains no raw paths, settings values, prompts, or tool payloads. */
export async function exportDiagnosticBundle(
  options: DiagnosticExportOptions,
): Promise<DiagnosticExportResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const records = await readSafeLogRecords(options.logPath, options.maxLogRecords ?? 1000);
  const bundle = {
    schemaVersion: 1,
    generatedAt,
    deepcodeVersion: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    workspace: { id: pathId(resolve(options.cwd)) },
    configuration: sanitizeConfiguration(options.config),
    logs: records,
  };

  const directory = join(options.home, 'diagnostics');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = generatedAt.replace(/[^0-9]/g, '').slice(0, 14) || 'unknown';
  const path = join(directory, `deepcode-diagnostics-${stamp}-${randomUUID().slice(0, 8)}.json`);
  await writeFile(path, `${JSON.stringify(bundle, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  return { path, generatedAt, recordCount: records.length };
}

function sanitizeConfiguration(config: ConfigDiagnosticsResult) {
  return {
    trustStatus: config.trustStatus,
    layers: config.layers.map((layer) => ({
      layer: layer.layer,
      present: layer.present,
      trusted: layer.trusted,
      sourceId: pathId(layer.path),
    })),
    provenance: Object.entries(config.provenance).map(([pointer, source]) => ({
      pointer,
      layer: source.layer,
      sourceId: pathId(source.path),
    })),
    gated: [...config.gated],
    issues: config.issues.map((issue) => ({
      severity: issue.severity,
      code: safeToken(issue.code),
      pointer: issue.pointer,
      sourceLayer: issue.source?.layer,
      sourceId: issue.source ? pathId(issue.source.path) : undefined,
    })),
  };
}

async function readSafeLogRecords(path: string | undefined, max: number): Promise<unknown[]> {
  if (!path || max <= 0) return [];
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return contents
    .split('\n')
    .filter(Boolean)
    .slice(-max)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        return [sanitizeStructuredLogRecord(value)];
      } catch {
        return [];
      }
    });
}

function pathId(path: string): string {
  return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 16);
}

function safeToken(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  return value.replace(/[^a-zA-Z0-9._:/-]/g, '_').slice(0, 160) || 'unknown';
}
