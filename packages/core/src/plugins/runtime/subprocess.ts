// Plugin subprocess host — runs each plugin in its own node process under sandbox.
// Spec: docs/design/plugin-security.md §3.5
//
// M5.1: subprocess + JSON-RPC stdio bridge + capability passing.
//
// What's protected:
//   · Plugin code runs in a SEPARATE node process
//   · stdin/stdout is the ONLY communication channel (JSON-RPC framed)
//   · The host implements `PluginContext` — fs/net/bash go THROUGH the host,
//     subject to mode/permission/sandbox checks
//   · No `require()` for fs/net modules in plugin code (lint enforced; not runtime sandbox)
//
// What's NOT protected (acknowledged):
//   · Plugin code on Mac/Linux still has full process permissions absent
//     OS sandbox-exec/bwrap wrapping. The wrapping is M5.1-ext.
//   · A truly malicious plugin can still exfiltrate via DNS resolution etc.
//   · We rely on hash-pin (M5) to detect tampering.

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { InstalledPlugin } from '../manifest.js';
import type { ToolHandler, ToolResult } from '../../types.js';

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
  /** Token the host generates and verifies on every RPC. */
  token: string;
  /** Bridge to host's existing tool dispatcher / fs primitives. */
  host: {
    fs_read: (path: string) => Promise<string>;
    fs_write: (path: string, content: string) => Promise<void>;
    bash: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    fetch: (url: string, opts?: { method?: string; body?: string }) => Promise<string>;
  };
}

/**
 * Spawn a plugin's `index.js` entry point as a subprocess.
 * Plugin's main reads RPC requests from stdin (one JSON object per line)
 * and writes results to stdout.
 *
 * Returns a handle exposing the tools the plugin contributes.
 */
export class PluginSubprocess {
  private readonly opts: PluginSubprocessOpts;
  private child: ChildProcess | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = '';
  private nextId = 1;
  private alive = false;

  constructor(opts: PluginSubprocessOpts) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    const entry = resolve(
      this.opts.plugin.path,
      this.opts.plugin.manifest.contributes ? 'index.js' : 'index.js',
    );
    // For M5.1, we use a simple node spawn — no sandbox-exec/bwrap wrap yet
    // (that's M5.2 once we have hardened SBPL/bwrap rules for arbitrary JS).
    this.child = spawn('node', [entry], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DEEPCODE_PLUGIN_TOKEN: this.opts.token,
        // Strip auth env vars so plugin can't read DEEPSEEK keys
        DEEPSEEK_API_KEY: '',
        DEEPSEEK_AUTH_TOKEN: '',
      },
    });
    this.alive = true;

    this.child.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      this.drainBuffer();
    });

    this.child.stderr!.on('data', (chunk: Buffer) => {
      // Surface plugin stderr to host log
      process.stderr.write(`[plugin ${this.opts.plugin.manifest.name}] ${chunk.toString('utf8')}`);
    });

    this.child.on('exit', () => {
      this.alive = false;
      // Reject any pending requests
      for (const p of this.pendingRequests.values()) {
        p.reject(new Error('plugin subprocess exited'));
      }
      this.pendingRequests.clear();
    });
  }

  async stop(): Promise<void> {
    if (this.child && this.alive) {
      this.child.kill('SIGTERM');
      this.alive = false;
    }
  }

  /**
   * Send an RPC request to the plugin and await its response.
   * Used to drive plugin code from the host (e.g. invoke a plugin-contributed tool).
   */
  async invoke<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.child || !this.alive) throw new Error('plugin not running');
    const id = `req-${this.nextId++}`;
    const request: RpcRequest = { id, method, params };
    const responsePromise = new Promise<T>((resolveResult, rejectResult) => {
      this.pendingRequests.set(id, {
        resolve: (r) => resolveResult(r as T),
        reject: rejectResult,
      });
    });
    this.child.stdin!.write(JSON.stringify(request) + '\n');
    return responsePromise;
  }

  /**
   * Convert plugin-contributed tool definitions (loaded from skills/) into
   * ToolHandler instances that proxy invocation through this subprocess.
   */
  toolHandlers(): ToolHandler[] {
    // For M5.1, plugin tools are surfaced via SKILL.md files in the plugin's
    // skills/ subdir (loaded by skills/loader.ts), not as bespoke tools. The
    // subprocess primarily serves hook handlers + future first-class plugin
    // tools (M5.2).
    return [];
  }

  private drainBuffer(): void {
    let nl = this.buffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.handleLine(line);
      nl = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let msg: RpcRequest | RpcResponse;
    try {
      msg = JSON.parse(line) as RpcRequest | RpcResponse;
    } catch {
      process.stderr.write(`[plugin ${this.opts.plugin.manifest.name}] malformed: ${line}\n`);
      return;
    }
    // If it has a `method`, it's a request FROM the plugin — handle via capability bridge
    if ('method' in msg) {
      this.handlePluginRequest(msg).catch((err: Error) => {
        this.respond(msg.id, undefined, { code: -32000, message: err.message });
      });
      return;
    }
    // Otherwise it's a response to OUR request
    const pending = this.pendingRequests.get(msg.id);
    if (pending) {
      this.pendingRequests.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    }
  }

  private async handlePluginRequest(req: RpcRequest): Promise<void> {
    if ((req.params['token'] as string) !== this.opts.token) {
      this.respond(req.id, undefined, { code: -32001, message: 'invalid token' });
      return;
    }
    try {
      let result: unknown;
      switch (req.method) {
        case 'fs_read':
          result = await this.opts.host.fs_read(req.params['path'] as string);
          break;
        case 'fs_write':
          await this.opts.host.fs_write(
            req.params['path'] as string,
            req.params['content'] as string,
          );
          result = { ok: true };
          break;
        case 'bash':
          result = await this.opts.host.bash(req.params['command'] as string);
          break;
        case 'fetch':
          result = await this.opts.host.fetch(req.params['url'] as string, {
            method: req.params['method'] as string | undefined,
            body: req.params['body'] as string | undefined,
          });
          break;
        case 'log':
          process.stdout.write(
            `[plugin ${this.opts.plugin.manifest.name}] ${req.params['msg'] as string}\n`,
          );
          result = { ok: true };
          break;
        default:
          this.respond(req.id, undefined, {
            code: -32601,
            message: `unknown method: ${req.method}`,
          });
          return;
      }
      this.respond(req.id, result);
    } catch (err) {
      this.respond(req.id, undefined, {
        code: -32000,
        message: (err as Error).message,
      });
    }
  }

  private respond(id: string, result?: unknown, error?: { code: number; message: string }): void {
    if (!this.child || !this.alive) return;
    const response: RpcResponse = { id, result, error };
    this.child.stdin!.write(JSON.stringify(response) + '\n');
  }
}

/**
 * Trivial unguessable token for host↔plugin RPC validation.
 */
export function generatePluginToken(): string {
  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join('-');
}

/**
 * Convenience: spawn all enabled plugins from settings.
 * `host` provides the capability bridge — typically wired by the agent loop
 * owner so plugin calls go through mode/permission/sandbox gates.
 */
export interface SpawnAllOpts {
  plugins: InstalledPlugin[];
  host: PluginSubprocessOpts['host'];
}

export async function spawnAllPlugins(opts: SpawnAllOpts): Promise<PluginSubprocess[]> {
  const out: PluginSubprocess[] = [];
  for (const plugin of opts.plugins) {
    if (!plugin.enabled) continue;
    const token = generatePluginToken();
    const sub = new PluginSubprocess({ plugin, token, host: opts.host });
    try {
      await sub.start();
      out.push(sub);
    } catch (err) {
      process.stderr.write(
        `[plugin ${plugin.manifest.name}] start failed: ${(err as Error).message}\n`,
      );
    }
  }
  return out;
}

export async function shutdownAllPlugins(handles: PluginSubprocess[]): Promise<void> {
  await Promise.allSettled(handles.map((h) => h.stop()));
}
