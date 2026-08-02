import { once } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

import type { ProtocolClientConnection } from '@deepcode/protocol';

export interface SpawnedAppServerOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  closeGraceMs?: number;
}

/** Node stdio adapter for a single-owner app-server child process. */
export class SpawnedAppServerConnection implements ProtocolClientConnection {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: ReadlineInterface;
  private closing = false;
  private stderr = '';

  constructor(private readonly options: SpawnedAppServerOptions = {}) {}

  async open(onMessage: (message: string) => void, onDisconnect: (error: Error) => void) {
    if (this.child) throw new Error('app-server connection is already open');
    this.closing = false;
    this.stderr = '';
    const args = this.options.args ?? [fileURLToPath(new URL('./cli.js', import.meta.url))];
    const child = spawn(this.options.command ?? process.execPath, args, {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        ...this.options.env,
        ...(this.options.home ? { DEEPCODE_HOME: this.options.home } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on('line', onMessage);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8_192);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const handleSpawn = () => {
          child.off('error', handleError);
          resolve();
        };
        const handleError = (error: Error) => {
          child.off('spawn', handleSpawn);
          reject(error);
        };
        child.once('spawn', handleSpawn);
        child.once('error', handleError);
      });
    } catch (error) {
      this.detach();
      throw error;
    }

    child.once('error', (error) => {
      if (!this.closing) onDisconnect(error);
      this.detach();
    });
    child.once('exit', (code, signal) => {
      const detail = this.stderr.trim();
      if (!this.closing) {
        onDisconnect(
          new Error(
            `app-server terminated (code=${code ?? 'none'}, signal=${signal ?? 'none'})${detail ? `: ${detail}` : ''}`,
          ),
        );
      }
      this.detach();
    });
  }

  async send(message: string): Promise<void> {
    const child = this.child;
    if (!child || child.stdin.destroyed) throw new Error('app-server connection is not open');
    if (!child.stdin.write(`${message}\n`)) await once(child.stdin, 'drain');
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.closing = true;
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      const grace = this.options.closeGraceMs ?? 5_000;
      const closed = once(child, 'close').then(() => true);
      const timedOut = new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), grace).unref();
      });
      if (!(await Promise.race([closed, timedOut]))) {
        child.kill('SIGTERM');
        await once(child, 'close').catch(() => undefined);
      }
    }
    this.detach();
  }

  private detach(): void {
    this.lines?.close();
    this.lines = undefined;
    this.child = undefined;
  }
}
