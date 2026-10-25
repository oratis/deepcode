import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunAgentOptions, RunAgentResult } from '../agent.js';
import { readMessages } from '../sessions/storage.js';

/** A user turn has exactly one loop owner. Engines share the host's policy and tools. */
export interface AgentEngine {
  readonly name: 'native' | 'claude-sdk';
  run(options: RunAgentOptions): Promise<RunAgentResult>;
}
export async function bindSessionEngine(options: RunAgentOptions, engine: AgentEngine['name']) {
  if (!options.session) return;
  const { id, manager } = options.session;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error('Invalid engine session ID');
  const directory = join(manager.root, id);
  const path = join(directory, 'engine.json');
  options.signal?.throwIfAborted();
  try {
    const binding = JSON.parse(await readFile(path, 'utf8')) as { version: number; engine: string };
    if (binding.version !== 1) throw new Error('Unsupported session engine binding version');
    if (binding.engine !== engine)
      throw new Error(
        `This session belongs to ${binding.engine}. Start a new session to use ${engine}.`,
      );
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (
    engine !== 'native' &&
    (options.history?.length || (await readMessages(manager.root, id)).length)
  )
    throw new Error(
      'Existing native history cannot be resumed by Claude SDK. Start a new session.',
    );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  options.signal?.throwIfAborted();
  // Exclusive creation: never silently replace another process's engine binding.
  try {
    await writeFile(path, JSON.stringify({ version: 1, engine }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const binding = JSON.parse(await readFile(path, 'utf8')) as { version: number; engine: string };
    if (binding.version !== 1 || binding.engine !== engine)
      throw new Error('Session engine changed concurrently', { cause: error });
  }
}
