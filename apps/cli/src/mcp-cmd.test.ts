import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
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
