import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { VERSION } from '@deepcode/core';
import { PROTOCOL_VERSION, } from '@deepcode/protocol';
import { sanitizeStructuredLogRecord } from './structured-logger.js';
/** Create a support bundle that contains no raw paths, settings values, prompts, or tool payloads. */
export async function exportDiagnosticBundle(options) {
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
function sanitizeConfiguration(config) {
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
async function readSafeLogRecords(path, max) {
    if (!path || max <= 0)
        return [];
    let contents;
    try {
        contents = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    return contents
        .split('\n')
        .filter(Boolean)
        .slice(-max)
        .flatMap((line) => {
        try {
            const value = JSON.parse(line);
            return [sanitizeStructuredLogRecord(value)];
        }
        catch {
            return [];
        }
    });
}
function pathId(path) {
    return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 16);
}
function safeToken(value) {
    if (typeof value !== 'string')
        return 'unknown';
    return value.replace(/[^a-zA-Z0-9._:/-]/g, '_').slice(0, 160) || 'unknown';
}
//# sourceMappingURL=diagnostic-export.js.map