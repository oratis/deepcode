import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import type { ThreadSnapshot, ThreadStore } from '@deepcode/protocol';

function validThreadId(threadId: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(threadId);
}

export class FileThreadStore implements ThreadStore {
  private sequence = 0;

  constructor(readonly directory: string) {}

  async load(threadId: string): Promise<ThreadSnapshot | null> {
    const path = this.pathFor(threadId);
    try {
      return JSON.parse(await readFile(path, 'utf8')) as ThreadSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(thread: ThreadSnapshot): Promise<void> {
    const path = this.pathFor(thread.id);
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${++this.sequence}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(thread)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  }

  private pathFor(threadId: string): string {
    if (!validThreadId(threadId)) throw new Error(`Invalid thread id: ${threadId}`);
    return join(this.directory, `${threadId}.json`);
  }
}
