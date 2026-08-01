import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import type { ProtocolNotification } from '@deepcode/protocol';
import { diagnoseSettings, DirectoryTrustStore } from '@deepcode/core/config';

import { createDefaultTurnExecutor } from './default-runtime.js';
import { AppServer, type TurnExecutor } from './server.js';
import { CanonicalThreadStore } from './store.js';
import { ProtocolLineWriter, serveStdio } from './stdio.js';

export interface RunAppServerOptions {
  input: Readable;
  output: Writable;
  home: string;
  executor?: TurnExecutor;
  forceFileCredentials?: boolean;
}

export async function runAppServer(options: RunAppServerOptions): Promise<void> {
  const writer = new ProtocolLineWriter(options.output);
  const trustStore = new DirectoryTrustStore({ directory: options.home });
  const server = new AppServer({
    executor:
      options.executor ??
      createDefaultTurnExecutor(options.home, {
        forceFileCredentials: options.forceFileCredentials,
      }),
    store: new CanonicalThreadStore(
      join(options.home, 'threads-v1'),
      join(options.home, 'sessions'),
    ),
    configDiagnostics: async (cwd) =>
      diagnoseSettings({
        cwd,
        directory: options.home,
        trustStatus: await trustStore.statusFor(cwd),
      }),
    onEvent: (event) => {
      const notification: ProtocolNotification = { method: 'event', params: event };
      void writer.enqueue(notification);
    },
  });
  await serveStdio(server, options.input, writer);
}
