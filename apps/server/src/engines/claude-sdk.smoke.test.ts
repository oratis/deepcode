import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RuntimeHost, ToolRegistry, SessionManager, WriteTool } from '@deepcode/core';
import { CredentialsStore } from '@deepcode/core/credentials';
import { ClaudeSdkEngine } from './claude-sdk.js';

// Real SDK/native executable, loopback model endpoint, fake key. No vendor traffic.
const smoke = process.env.DEEPCODE_SDK_SMOKE === '1' ? describe : describe.skip;
smoke('installed Claude SDK executable', () => {
  it.each(['kimi-k2.5', 'glm-4.7'])(
    'runs gated tools and resumes %s using a loopback Messages fixture',
    async (model) => {
      const cwd = await mkdtemp(join(tmpdir(), 'dc-sdk-smoke-'));
      let calls = 0;
      const server = createServer(async (req, res) => {
        let data = '';
        for await (const chunk of req) data += chunk;
        if (req.url?.includes('count_tokens')) {
          res.setHeader('content-type', 'application/json');
          res.end('{"input_tokens":10}');
          return;
        }
        if (!req.url?.includes('/messages')) {
          res.writeHead(404);
          res.end();
          return;
        }
        const body = JSON.parse(data);
        expect(body.model).toBe(model);
        expect(body.max_tokens).toBeLessThanOrEqual(8192);
        const hasTool = (body.tools as Array<{ name: string }>).some(
          (tool) => tool.name === 'mcp__deepcode__Write',
        );
        expect(hasTool).toBe(true);
        const useTool = calls++ === 0;
        res.setHeader('content-type', 'text/event-stream');
        const event = (type: string, value: object) =>
          res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
        event('message_start', {
          message: {
            id: `msg_${calls}`,
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        });
        if (useTool) {
          event('content_block_start', {
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'call_write',
              name: 'mcp__deepcode__Write',
              input: {},
            },
          });
          event('content_block_delta', {
            index: 0,
            delta: {
              type: 'input_json_delta',
              partial_json: JSON.stringify({ file_path: 'proof.txt', content: 'verified' }),
            },
          });
        } else {
          event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
          event('content_block_delta', {
            index: 0,
            delta: { type: 'text_delta', text: 'SDK fixture complete' },
          });
        }
        event('content_block_stop', { index: 0 });
        event('message_delta', {
          delta: { stop_reason: useTool ? 'tool_use' : 'end_turn', stop_sequence: null },
          usage: { output_tokens: 10 },
        });
        event('message_stop', {});
        res.end();
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      try {
        const settings = {
          engine: 'claude-sdk' as const,
          providers: { kimi: { anthropicURL: endpoint }, glm: { anthropicURL: endpoint } },
        };
        const engine = new ClaudeSdkEngine({
          settings,
          store: new CredentialsStore({ directory: join(cwd, 'keys'), forceFile: true }),
          env: { MOONSHOT_API_KEY: 'fake-loopback-key', GLM_API_KEY: 'fake-loopback-key' },
        });
        const host = new RuntimeHost({
          engine,
          provider: {
            name: 'unused',
            runTurn: async () => {
              throw new Error('native called');
            },
          },
          tools: new ToolRegistry([WriteTool]),
          cwd,
          mode: 'default',
          disableLedger: true,
        });
        const manager = new SessionManager({ root: join(cwd, 'sessions') });
        const session = await manager.create(cwd);
        const events: unknown[] = [];
        const input = {
          model,
          systemPrompt: 'Use the provided tools.',
          userMessage: 'Write proof.txt',
          session: { manager, id: session.id },
          approval: async () => true,
          maxTurns: 3,
          onEvent: (event: unknown) => events.push(event),
        };
        const first = await host.run(input);
        expect(first.stopReason, JSON.stringify(events)).toBe('end_turn');
        expect(await readFile(join(cwd, 'proof.txt'), 'utf8')).toBe('verified');
        const second = await host.run({
          ...input,
          history: first.history,
          userMessage: 'Continue',
        });
        expect(second.stopReason, JSON.stringify(events)).toBe('end_turn');
        expect(calls).toBeGreaterThanOrEqual(3);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(cwd, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
