// External plugin code is isolated by default and talks only through a revocable broker.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SandboxConfig } from '../../config/types.js';
import type { InstalledPlugin } from '../manifest.js';
import type { ToolHandler } from '../../types.js';
import type { PluginCapabilityBridge } from '../wireup.js';
import { pluginSpawnPlan } from './isolation.js';

export interface RpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}
export interface RpcResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}
export interface PluginSubprocessOpts {
  plugin: InstalledPlugin;
  token: string;
  host: PluginCapabilityBridge;
  /** Default isolation; only explicit danger-full-access / enabled:false opts out. */
  sandbox?: SandboxConfig;
}
const FRAME_LIMIT = 1024 * 1024;
const REQUEST_LIMIT = 64;
const STARTUP_MS = 5_000;
const CLEANUP_MS = 1_500;
const BOOTSTRAP = `process.stdout.write(JSON.stringify({id:'__deepcode_ready__',result:true})+'\\n');
import(require('node:url').pathToFileURL(process.argv[1]).href).catch(e=>{console.error(e.message);process.exitCode=1;});`;

export class PluginSubprocess {
  private child: ChildProcess | undefined;
  private readonly controller = new AbortController();
  private readonly pendingRequests = new Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly inbound = new Set<Promise<void>>();
  private buffer = '';
  private nextId = 1;
  private alive = false;
  private groupKilled = false;
  private killFailure: Error | undefined;
  private scratch: string | undefined;
  private stopping: Promise<void> | undefined;
  private exited: Promise<void> = Promise.resolve();

  constructor(private readonly opts: PluginSubprocessOpts) {}
  get plugin(): InstalledPlugin {
    return this.opts.plugin;
  }
  get isAlive(): boolean {
    return this.alive;
  }

  async start(): Promise<void> {
    if (this.child || this.controller.signal.aborted)
      throw new Error('Plugin subprocess cannot be restarted');
    this.scratch = await mkdtemp(join(tmpdir(), 'deepcode-plugin-'));
    try {
      const plan = await pluginSpawnPlan(this.opts.plugin.path, this.scratch, this.opts.sandbox);
      const child = (this.child = spawn(
        plan.command,
        [
          ...plan.args,
          '--input-type=commonjs',
          '-e',
          BOOTSTRAP,
          resolve(this.opts.plugin.path, 'index.js'),
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: plan.cwd,
          detached: process.platform !== 'win32',
          env: { ...plan.env, DEEPCODE_PLUGIN_TOKEN: this.opts.token },
        },
      ));
      const ready = new Promise<void>((resolveReady, rejectReady) => {
        this.pendingRequests.set('__deepcode_ready__', {
          resolve: () => resolveReady(),
          reject: rejectReady,
        });
      });
      this.alive = true;
      this.exited = new Promise<void>((resolveExit) => {
        child.once('error', (error) => {
          this.revoke(error);
          resolveExit();
        });
        child.once('exit', () => {
          this.revoke(new Error('plugin subprocess exited'));
          this.killGroup('SIGKILL'); // Even a completed leader must not leave descendants.
        });
        child.once('close', () => resolveExit());
      });
      child.stdin!.on('error', () => {
        /* peer closed its input */
      });
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        this.buffer += chunk;
        if (Buffer.byteLength(this.buffer) > FRAME_LIMIT) {
          this.failProtocol();
          return;
        }
        for (let nl = this.buffer.indexOf('\n'); nl !== -1; nl = this.buffer.indexOf('\n')) {
          const line = this.buffer.slice(0, nl);
          this.buffer = this.buffer.slice(nl + 1);
          if (line.trim()) this.handleLine(line);
        }
      });
      child.stderr!.on('data', (chunk: Buffer) => {
        process.stderr.write(`[plugin ${this.plugin.manifest.name}] ${chunk.toString('utf8')}`);
      });
      await bounded(ready, STARTUP_MS, 'Plugin failed to start under isolation');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private revoke(error = new Error('plugin stopped')): void {
    this.alive = false;
    this.controller.abort();
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
  }
  private killGroup(signal: NodeJS.Signals): void {
    const child = this.child;
    if (!child?.pid || this.groupKilled) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, signal);
      else child.kill(signal);
      if (signal === 'SIGKILL') this.groupKilled = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') this.groupKilled = true;
      else
        this.killFailure = new Error(
          'cleanup_incomplete: plugin process group could not be stopped',
          { cause: error },
        );
    }
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.revoke();
    this.stopping = this.cleanup();
    return this.stopping;
  }
  private async cleanup(): Promise<void> {
    this.killGroup('SIGTERM');
    // Escalation is independent of leader exit: inherited pipes/descendants may survive it.
    const force = setTimeout(() => this.killGroup('SIGKILL'), 150);
    try {
      await bounded(
        Promise.all([this.exited, ...this.inbound]),
        CLEANUP_MS,
        'cleanup_incomplete: plugin requests/process did not stop',
      );
      this.killGroup('SIGKILL');
      if (this.killFailure) throw this.killFailure;
      if (this.scratch) await rm(this.scratch, { recursive: true, force: true });
    } finally {
      clearTimeout(force);
    }
  }
  async invoke<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (!this.child || !this.alive) throw new Error('plugin not running');
    if (this.pendingRequests.size >= REQUEST_LIMIT)
      throw new Error('plugin request limit exceeded');
    const id = `req-${this.nextId++}`;
    const abort = () => {
      void this.stop().catch(() => undefined);
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await new Promise<T>((resolveResult, reject) => {
        this.pendingRequests.set(id, { resolve: (r) => resolveResult(r as T), reject });
        this.child!.stdin!.write(JSON.stringify({ id, method, params }) + '\n');
      });
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  toolHandlers(): ToolHandler[] {
    return [];
  }

  private failProtocol(): void {
    process.stderr.write(`[plugin ${this.plugin.manifest.name}] invalid or oversized RPC frame\n`);
    void this.stop().catch((error: unknown) =>
      process.stderr.write(`${(error as Error).message}\n`),
    );
  }
  private handleLine(line: string): void {
    if (!this.alive) return;
    let msg: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('invalid frame');
      msg = value as Record<string, unknown>;
      if (typeof msg.id !== 'string') throw new Error('invalid id');
    } catch {
      this.failProtocol();
      return;
    }
    const id = msg.id as string;
    if ('method' in msg) {
      if (
        typeof msg.method !== 'string' ||
        !msg.params ||
        typeof msg.params !== 'object' ||
        Array.isArray(msg.params) ||
        this.inbound.size >= REQUEST_LIMIT
      ) {
        this.failProtocol();
        return;
      }
      const work = this.handlePluginRequest(msg as unknown as RpcRequest);
      this.inbound.add(work);
      void work.finally(() => this.inbound.delete(work));
      return;
    }
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    this.pendingRequests.delete(id);
    if (msg.error) pending.reject(new Error('plugin RPC error'));
    else pending.resolve(msg.result);
  }
  private async handlePluginRequest(req: RpcRequest): Promise<void> {
    if (req.params.token !== this.opts.token) {
      this.respond(req.id, undefined, { code: -32001, message: 'invalid token' });
      return;
    }
    const str = (key: string) => {
      const value = req.params[key];
      if (typeof value !== 'string') throw new Error(`Invalid ${key}`);
      return value;
    };
    try {
      this.controller.signal.throwIfAborted();
      let result: unknown;
      const signal = this.controller.signal;
      switch (req.method) {
        case 'fs_read':
          result = await this.opts.host.fs_read(str('path'), signal);
          break;
        case 'fs_write':
          await this.opts.host.fs_write(str('path'), str('content'), signal);
          result = { ok: true };
          break;
        case 'bash':
          result = await this.opts.host.bash(str('command'), signal);
          break;
        case 'fetch':
          result = await this.opts.host.fetch(
            str('url'),
            {
              method: req.params.method === undefined ? undefined : str('method'),
              body: req.params.body === undefined ? undefined : str('body'),
            },
            signal,
          );
          break;
        case 'log':
          process.stderr.write(`[plugin ${this.plugin.manifest.name}] ${str('msg')}\n`);
          result = { ok: true };
          break;
        default:
          throw new Error(`Unknown plugin method: ${req.method}`);
      }
      this.respond(req.id, result);
    } catch (error) {
      this.respond(req.id, undefined, { code: -32000, message: (error as Error).message });
    }
  }
  private respond(id: string, result?: unknown, error?: RpcResponse['error']): void {
    if (this.alive) this.child!.stdin!.write(JSON.stringify({ id, result, error }) + '\n');
  }
}
async function bounded<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function generatePluginToken(): string {
  return randomBytes(32).toString('hex');
}
export interface SpawnAllOpts {
  plugins: InstalledPlugin[];
  host: PluginSubprocessOpts['host'];
  sandbox?: SandboxConfig;
}
export async function spawnAllPlugins(opts: SpawnAllOpts): Promise<PluginSubprocess[]> {
  const out: PluginSubprocess[] = [];
  for (const plugin of opts.plugins) {
    if (!plugin.enabled) continue;
    const sub = new PluginSubprocess({
      plugin,
      token: generatePluginToken(),
      host: opts.host,
      sandbox: opts.sandbox,
    });
    try {
      await sub.start();
      out.push(sub);
    } catch (error) {
      process.stderr.write(
        `[plugin ${plugin.manifest.name}] start failed: ${(error as Error).message}\n`,
      );
    }
  }
  return out;
}
export async function shutdownAllPlugins(handles: PluginSubprocess[]): Promise<void> {
  const results = await Promise.allSettled(handles.map((h) => h.stop()));
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (errors.length)
    throw new AggregateError(
      errors.map((r) => r.reason),
      'cleanup_incomplete: plugins',
    );
}
