import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Mode, ServeMcpStdioOpts } from '@deepcode/core';
import { runMcpCommand } from './mcp-cmd.js';

function sink(): { stream: Writable; text: () => string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => buf };
}

describe('runMcpCommand', () => {
  it('prints help and returns 0 with no subcommand', async () => {
    const out = sink();
    const code = await runMcpCommand([], { cwd: '/tmp', output: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toMatch(/Usage: deepcode mcp/);
    expect(out.text()).toContain('"mcp", "serve"');
  });

  it('prints help and returns 2 for an unknown subcommand', async () => {
    const out = sink();
    const code = await runMcpCommand(['bogus'], { cwd: '/tmp', output: out.stream });
    expect(code).toBe(2);
    expect(out.text()).toMatch(/Usage: deepcode mcp/);
  });

  it('serve logs readiness to stderr (not stdout) and forwards cwd', async () => {
    const out = sink();
    const err = sink();
    let receivedCwd = '';
    const code = await runMcpCommand(['serve'], {
      cwd: '/my/project',
      output: out.stream,
      errOutput: err.stream,
      // Fake serve: record cwd, fire onReady, return immediately (no real stdio).
      serve: async (opts) => {
        receivedCwd = opts.cwd;
        opts.onReady?.(['Read', 'Write']);
      },
    });
    expect(code).toBe(0);
    expect(receivedCwd).toBe('/my/project');
    // stdout must stay clean — it's the JSON-RPC channel.
    expect(out.text()).toBe('');
    expect(err.text()).toMatch(/exposing \d+ tools over stdio in \/my\/project/);
    expect(err.text()).toMatch(/\[mcp\] ready: Read, Write/);
  });
});

// The served tools are Read/Write/Edit/Bash in a real project, and nobody is on
// the other end of the pipe to approve anything.
describe('runMcpCommand serve — permission posture', () => {
  let home: string;
  let cwd: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-mcp-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-mcp-cwd-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  async function serve(opts: { mode?: Mode } = {}): Promise<{
    err: string;
    captured: ServeMcpStdioOpts | undefined;
  }> {
    const out = sink();
    const err = sink();
    let captured: ServeMcpStdioOpts | undefined;
    await runMcpCommand(['serve'], {
      cwd,
      home,
      output: out.stream,
      errOutput: err.stream,
      mode: opts.mode,
      serve: async (o) => {
        captured = o;
      },
    });
    return { err: err.text(), captured };
  }

  async function writeUserSettings(settings: Record<string, unknown>): Promise<void> {
    await mkdir(join(home, '.deepcode'), { recursive: true });
    await writeFile(join(home, '.deepcode', 'settings.json'), JSON.stringify(settings));
  }

  it('passes a gate at all — the server cannot be built without one', async () => {
    const { captured } = await serve();
    expect(captured?.gate).toBeTypeOf('function');
  });

  it('refuses a call that would need approval', async () => {
    const { captured } = await serve();
    const verdict = await captured!.gate({
      tool: 'Write',
      input: { file_path: join(cwd, 'x.txt'), content: 'x' },
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/no attached user/);
  });

  it('clamps a permissive ambient mode and says so', async () => {
    // `bypassPermissions` in settings.json is a choice about sitting at a REPL.
    // Inheriting it here would hand "never ask me" to whatever connected.
    await writeUserSettings({ permissions: { defaultMode: 'bypassPermissions' } });
    const { err, captured } = await serve();
    expect(err).toMatch(/was not applied to this unattended run/);
    expect(err).toMatch(/mode=default/);

    const verdict = await captured!.gate({
      tool: 'Bash',
      input: { command: 'rm -rf /' },
    });
    expect(verdict.allowed).toBe(false);
  });

  it('--mode is the explicit opt-in back out of the clamp', async () => {
    await writeUserSettings({ permissions: { defaultMode: 'bypassPermissions' } });
    const { err, captured } = await serve({ mode: 'bypassPermissions' });
    expect(err).not.toMatch(/was not applied/);
    expect(err).toMatch(/mode=bypassPermissions/);
    expect((await captured!.gate({ tool: 'Bash', input: { command: 'echo hi' } })).allowed).toBe(
      true,
    );
  });

  it('honours permissions.allow without any mode change', async () => {
    await writeUserSettings({ permissions: { allow: ['Read'] } });
    const { captured } = await serve();
    expect(
      (await captured!.gate({ tool: 'Read', input: { file_path: join(cwd, 'a') } })).allowed,
    ).toBe(true);
    expect(
      (await captured!.gate({ tool: 'Write', input: { file_path: join(cwd, 'a'), content: '' } }))
        .allowed,
    ).toBe(false);
  });
});
