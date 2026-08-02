import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import type { ProtocolNotification } from '@deepcode/protocol';

import { createDefaultTurnExecutor } from './default-runtime.js';
import { AppServer, type TurnExecutor } from './server.js';
import { FileThreadStore } from './store.js';
import { ProtocolLineWriter, serveStdio } from './stdio.js';

export interface RunAppServerOptions {
  input: Readable;
  output: Writable;
  home: string;
  executor?: TurnExecutor;
}

export async function runAppServer(options: RunAppServerOptions): Promise<void> {
  const writer = new ProtocolLineWriter(options.output);
  const server = new AppServer({
    executor: options.executor ?? createDefaultTurnExecutor(),
    store: new FileThreadStore(join(options.home, 'threads-v1')),
    onEvent: (event) => {
      const notification: ProtocolNotification = { method: 'event', params: event };
      void writer.enqueue(notification);
    },
  });
  await serveStdio(server, options.input, writer);
}
