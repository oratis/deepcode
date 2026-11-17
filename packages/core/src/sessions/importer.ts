import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { readFile, readdir, mkdir, lstat, access } from 'node:fs/promises';
import {
  readMessages,
  readMeta,
  readSessionRecords,
  sessionFiles,
  withLegacySessionLock,
  type SessionMeta,
} from './storage.js';
import { SessionJournal, type JournalInput } from './journal.js';
import { assertSessionId, durableFile, privateDirectory } from './lease.js';

async function sourceFiles(root: string, id: string): Promise<Array<[string, Buffer]>> {
  const files = sessionFiles(root, id);
  const result: Array<[string, Buffer]> = [];
  for (const name of [files.jsonlPath, files.legacyJsonlPath, files.metaPath]) {
    try {
      if (!(await lstat(name)).isFile())
        throw new Error('Legacy session source must be a regular file');
      result.push([name.slice(root.length + 1), await readFile(name)]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const walk = async (path: string): Promise<void> => {
    let entries;
    try {
      if (!(await lstat(path)).isDirectory())
        throw new Error('Legacy resource directory must not be a symlink');
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Legacy resources contain a symlink');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) result.push([file.slice(root.length + 1), await readFile(file)]);
      else throw new Error('Unsupported legacy resource');
    }
  };
  await walk(join(root, id));
  return result;
}
const digest = (files: Array<[string, Buffer]>) => {
  const h = createHash('sha256');
  for (const [name, bytes] of files) h.update(JSON.stringify([name, bytes.length])).update(bytes);
  return h.digest('hex');
};
/** Import only under the TS/Rust writer barrier. Source payloads remain byte-for-byte intact. */
export async function importLegacySession(
  legacyRoot: string,
  journal: SessionJournal,
): Promise<boolean> {
  assertSessionId(journal.id);
  return journal.withWriter(async () => {
    if (await journal.read()) return true;
    await mkdir(legacyRoot, { recursive: true, mode: 0o700 });
    return withLegacySessionLock(legacyRoot, journal.id, async () => {
      const meta = await readMeta(legacyRoot, journal.id);
      if (!meta) return false;
      const parsed = await readSessionRecords(legacyRoot, journal.id);
      const messages = await readMessages(legacyRoot, journal.id);
      const before = await sourceFiles(legacyRoot, journal.id);
      const sourceHash = digest(before);
      for (const [name, bytes] of before) {
        if (name.includes('/') || !name.endsWith('.jsonl')) continue;
        const lines = bytes.toString('utf8').split('\n');
        for (const [index, line] of lines.entries()) {
          if (!line.trim()) continue;
          let record: Record<string, unknown>;
          try {
            record = JSON.parse(line);
          } catch (error) {
            if (index === lines.length - 1 && !bytes.toString('utf8').endsWith('\n')) continue;
            throw error;
          }
          if (record.schema_version !== undefined && record.schema_version !== 1)
            throw new Error('Unsupported legacy record version');
          if (
            record.type !== undefined &&
            !['session_meta', 'message'].includes(String(record.type))
          )
            throw new Error('Unsupported legacy record semantics');
        }
      }
      let sdkDirectory = false;
      try {
        await access(join(legacyRoot, journal.id, 'claude-sdk'));
        sdkDirectory = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const bindingBytes = before.find(([name]) => name === `${journal.id}/engine.json`)?.[1];
      const binding = bindingBytes
        ? (JSON.parse(bindingBytes.toString('utf8')) as { version: number; engine: string })
        : { version: 1, engine: 'native' };
      if (binding.version !== 1 || !['native', 'claude-sdk'].includes(binding.engine))
        throw new Error('Unknown legacy engine binding');
      // The old SDK does not hold the JSONL writer lock throughout its private writes.
      // Copying its continuation without proving quiescence would manufacture resume safety.
      if (
        sdkDirectory ||
        binding.engine === 'claude-sdk' ||
        before.some(([name]) => name.startsWith(`${journal.id}/claude-sdk/`))
      )
        throw new Error(
          'Legacy SDK sessions are read-only; resume with the previous release or start a new session. Private continuation is not migrated automatically.',
        );
      for (const [name, sourceBytes] of before) {
        let bytes = sourceBytes;
        if (!name.startsWith(`${journal.id}/`)) continue;
        const relative = name.slice(journal.id.length + 1);
        const top = relative.split('/')[0]!;
        if (top === 'leases' || top.startsWith('manifest') || top.startsWith('journal-'))
          throw new Error('Reserved legacy resource name');
        if (relative === 'snapshots/manifest.jsonl') {
          bytes = Buffer.from(
            sourceBytes
              .toString('utf8')
              .trimEnd()
              .split('\n')
              .filter((line) => line.trim())
              .map((line) => {
                const row = JSON.parse(line) as { blobPath?: string; hash?: string };
                const prefix = join(legacyRoot, journal.id, 'snapshots') + '/';
                if (row.blobPath) {
                  if (
                    !row.blobPath.startsWith(prefix) ||
                    row.blobPath.slice(prefix.length).includes('/')
                  )
                    throw new Error('Invalid legacy snapshot reference');
                  const originalBlob = before.find(
                    ([name]) =>
                      name === `${journal.id}/snapshots/${row.blobPath!.slice(prefix.length)}`,
                  )?.[1];
                  if (
                    !originalBlob ||
                    createHash('sha256').update(originalBlob).digest('hex').slice(0, 16) !==
                      row.hash
                  )
                    throw new Error('Legacy snapshot checksum mismatch');
                  row.blobPath = join(
                    journal.directory,
                    'snapshots',
                    row.blobPath.slice(prefix.length),
                  );
                }
                return JSON.stringify(row);
              })
              .join('\n') + '\n',
          );
        }
        const target = join(journal.directory, relative);
        await privateDirectory(dirname(target));
        try {
          await durableFile(target, bytes);
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
            !(await readFile(target)).equals(bytes)
          )
            throw error;
        }
      }
      if (sourceHash !== digest(await sourceFiles(legacyRoot, journal.id)))
        throw new Error('Legacy source changed during migration');
      const events: JournalInput[] = [
        { type: 'session.created', payload: { meta: meta as unknown as Record<string, unknown> } },
        {
          type: 'session.imported',
          payload: {
            sourceId: journal.id,
            sourceHash,
            format: parsed.format,
            missingFacts: ['turn-lifecycle', 'approval-history', 'execution-intents'],
            engine: binding.engine,
          },
        },
        ...messages.map((message) => ({ type: 'message.appended', payload: { message } })),
      ];
      await journal.append(events);
      return true;
    });
  });
}
export function metadataPayload(meta: SessionMeta): Record<string, unknown> {
  return { meta };
}
