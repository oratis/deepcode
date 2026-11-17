import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { mkdir, open, readFile, readdir, link, unlink, lstat } from 'node:fs/promises';
import { SessionWriterConflictError } from './storage.js';

export function assertSessionId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id)) throw new Error('Invalid session ID');
}
export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory())
    throw new Error('Session directory must not be a symlink');
}
export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function durableFile(path: string, data: string | Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
interface Owner {
  version: 1;
  token: string;
  pid: number;
  host: string;
  epoch: number;
}
/**
 * Immutable lease succession, for a local filesystem. No lock file is ever unlinked
 * or replaced on takeover: competing successors race on the SAME exclusive slot.
 * This avoids the stale-lock unlink/ABA race. Ambiguous/live owners always block.
 */
export async function acquireSessionLease(
  directory: string,
  sessionId: string,
): Promise<{ epoch: number; release(): Promise<void> }> {
  const leases = join(directory, 'leases');
  await privateDirectory(leases);
  const epochs = (await readdir(leases))
    .filter((name) => /^\d+\.json$/.test(name))
    .map((name) => Number(name.slice(0, -5)));
  const previous = epochs.length ? Math.max(...epochs) : 0;
  if (!Number.isSafeInteger(previous)) throw new Error('Invalid lease epoch');
  if (previous) {
    const owner = JSON.parse(await readFile(join(leases, `${previous}.json`), 'utf8')) as Owner;
    if (
      owner.version !== 1 ||
      owner.epoch !== previous ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid < 1 ||
      !/^[a-f0-9-]{36}$/.test(owner.token)
    )
      throw new Error('Unknown session writer ownership');
    let released = false;
    try {
      released = (await readFile(join(leases, `${previous}.released`), 'utf8')) === owner.token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!released) {
      if (owner.host !== hostname()) throw new SessionWriterConflictError(sessionId);
      try {
        process.kill(owner.pid, 0);
        throw new SessionWriterConflictError(sessionId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }
  const epoch = previous + 1;
  const owner: Owner = {
    version: 1,
    token: randomUUID(),
    pid: process.pid,
    host: hostname(),
    epoch,
  };
  const temporary = join(leases, `${owner.token}.pending`);
  await durableFile(temporary, JSON.stringify(owner));
  try {
    // link publishes a fully written owner atomically, unlike open('wx') + write.
    await link(temporary, join(leases, `${epoch}.json`));
    await syncDirectory(leases);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new SessionWriterConflictError(sessionId);
    throw error;
  } finally {
    await unlink(temporary);
  }
  let released = false;
  return {
    epoch,
    async release() {
      if (released) return;
      // Only after all writes and drains finish. A crash here remains recoverable by PID death.
      await durableFile(join(leases, `${epoch}.released`), owner.token);
      await syncDirectory(leases);
      released = true;
    },
  };
}
