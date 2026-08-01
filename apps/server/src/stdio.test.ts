import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { AppServer } from './server.js';
import { ProtocolLineWriter, serveStdio } from './stdio.js';

describe('stdio transport', () => {
  it('continues after malformed input and writes one response per valid request', async () => {
    const input = new PassThrough();
    let output = '';
    const writer = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const server = new AppServer({ executor: { execute: async () => ({}) } });
    const serving = serveStdio(server, input, writer);

    input.end('not-json\n{"id":1,"method":"initialize","params":{}}\n');
    await serving;

    const messages = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(messages).toEqual([
      { id: null, error: { code: 'parse_error', message: expect.any(String) } },
      { id: 1, result: expect.objectContaining({ protocolVersion: 1 }) },
    ]);
  });

  it('honors writable backpressure and drops only excess transient deltas', async () => {
    let output = '';
    let release!: () => void;
    const destination = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        release = callback;
      },
    });
    const writer = new ProtocolLineWriter(destination, 1);
    const durable = writer.enqueue({ id: 1, result: { ok: true } });
    await Promise.resolve();
    await writer.enqueue({
      method: 'event',
      params: {
        type: 'item.delta',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: 'drop under pressure',
      },
    });
    release();
    await durable;
    await writer.flush();

    expect(output.trim()).toBe('{"id":1,"result":{"ok":true}}');
  });

  it('interrupts active work when the single owning client disconnects', async () => {
    const input = new PassThrough();
    const output = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    let aborted = false;
    let sequence = 0;
    const server = new AppServer({
      newId: (prefix) => `${prefix}-${++sequence}`,
      executor: {
        execute: ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new DOMException('aborted', 'AbortError'));
              },
              { once: true },
            );
          }),
      },
    });
    const serving = serveStdio(server, input, output);
    input.end(
      '{"id":1,"method":"thread/start","params":{"cwd":"/workspace"}}\n' +
        '{"id":2,"method":"turn/start","params":{"threadId":"thread-1","input":{"text":"wait"}}}\n',
    );

    await serving;
    expect(aborted).toBe(true);
    const read = await server.handle({
      id: 3,
      method: 'thread/read',
      params: { threadId: 'thread-1' },
    });
    expect(read).toEqual({
      id: 3,
      result: expect.objectContaining({
        turns: [expect.objectContaining({ status: 'interrupted' })],
      }),
    });
  });
});
