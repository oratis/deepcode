import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { once } from 'node:events';

import {
  decodeProtocolRequest,
  encodeProtocolMessage,
  type ProtocolNotification,
  type ProtocolRequest,
  type ProtocolResponse,
} from '@deepcode/protocol';

import type { AppServer } from './server.js';

type OutboundMessage = ProtocolResponse | ProtocolNotification;

export class ProtocolLineWriter {
  private tail = Promise.resolve();
  private failure: unknown;
  private pending = 0;

  constructor(
    private readonly output: Writable,
    private readonly maxPending = 1024,
  ) {}

  enqueue(message: OutboundMessage): Promise<void> {
    if (this.pending >= this.maxPending && isTransientDelta(message)) {
      return Promise.resolve();
    }
    this.pending++;
    const task = this.tail.then(async () => {
      if (this.failure) throw this.failure;
      const accepted = this.output.write(`${encodeProtocolMessage(message)}\n`);
      if (!accepted) await once(this.output, 'drain');
    });
    this.tail = task.catch((error) => {
      this.failure = error;
    });
    void task.then(
      () => this.pending--,
      () => this.pending--,
    );
    return task;
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }
}

export async function serveStdio(
  server: AppServer,
  input: Readable,
  destination: Writable | ProtocolLineWriter,
): Promise<void> {
  const writer =
    destination instanceof ProtocolLineWriter ? destination : new ProtocolLineWriter(destination);
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: ProtocolRequest;
    try {
      request = decodeProtocolRequest(line);
    } catch (error) {
      await writer.enqueue({
        id: null,
        error: { code: 'parse_error', message: (error as Error).message ?? String(error) },
      });
      continue;
    }
    await writer.enqueue(await server.handle(request));
  }
  await server.shutdown();
  await writer.flush();
}

function isTransientDelta(message: OutboundMessage): boolean {
  return 'method' in message && message.method === 'event' && message.params.type === 'item.delta';
}
