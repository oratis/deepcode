import process from 'node:process';

import { ProtocolClient } from '@deepcode/protocol';
import { describe, expect, it } from 'vitest';

import { SpawnedAppServerConnection } from './client.js';

const fixture = String.raw`
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  const result = request.method === 'initialize'
    ? { protocolVersion: 1, capabilities: {
        threadResume: true, turnInterrupt: true, completedItemPersistence: true,
        transientDeltas: true, structuredToolEvents: true, interactiveRequests: true
      } }
    : { echoed: request.method };
  process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
});
`;

describe('SpawnedAppServerConnection', () => {
  it('carries correlated protocol requests over a real child stdio stream', async () => {
    const client = new ProtocolClient(
      new SpawnedAppServerConnection({ command: process.execPath, args: ['-e', fixture] }),
    );

    await expect(client.connect()).resolves.toEqual(
      expect.objectContaining({ protocolVersion: 1 }),
    );
    await expect(client.request('thread/read', { threadId: 'thread-1' })).resolves.toEqual({
      echoed: 'thread/read',
    });
    await client.close();
  });

  it('surfaces child termination with bounded stderr context', async () => {
    const connection = new SpawnedAppServerConnection({
      command: process.execPath,
      args: ['-e', "process.stderr.write('fixture failed'); process.exit(7)"],
    });
    const disconnected = new Promise<Error>((resolve) => {
      void connection.open(() => undefined, resolve);
    });

    await expect(disconnected).resolves.toEqual(
      expect.objectContaining({ message: expect.stringMatching(/code=7.*fixture failed/) }),
    );
  });
});
