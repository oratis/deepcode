import { describe, expect, it, vi } from 'vitest';

import { ProtocolClient, type ProtocolClientConnection } from './client.js';
import type { ProtocolRequest } from './types.js';

class FakeConnection implements ProtocolClientConnection {
  onMessage?: (message: string) => void;
  onDisconnect?: (error: Error) => void;
  opened = 0;
  closed = 0;
  requests: ProtocolRequest[] = [];

  async open(onMessage: (message: string) => void, onDisconnect: (error: Error) => void) {
    this.opened++;
    this.onMessage = onMessage;
    this.onDisconnect = onDisconnect;
  }

  async send(raw: string) {
    const request = JSON.parse(raw) as ProtocolRequest;
    this.requests.push(request);
    queueMicrotask(() => {
      this.onMessage?.(
        JSON.stringify({
          id: request.id,
          result:
            request.method === 'initialize'
              ? {
                  protocolVersion: 1,
                  capabilities: {
                    threadResume: true,
                    turnInterrupt: true,
                    completedItemPersistence: true,
                    transientDeltas: true,
                    structuredToolEvents: true,
                    interactiveRequests: true,
                    configDiagnostics: true,
                  },
                }
              : { ok: true },
        }),
      );
    });
  }

  async close() {
    this.closed++;
  }
}

describe('ProtocolClient', () => {
  it('opens once, negotiates v1, and correlates requests', async () => {
    const connection = new FakeConnection();
    const client = new ProtocolClient(connection);

    await expect(client.connect()).resolves.toEqual(
      expect.objectContaining({ protocolVersion: 1 }),
    );
    await client.connect();
    await expect(client.request('thread/read', { threadId: 'thread-1' })).resolves.toEqual({
      ok: true,
    });

    expect(connection.opened).toBe(1);
    expect(connection.requests.map((request) => request.method)).toEqual([
      'initialize',
      'thread/read',
    ]);
    await client.close();
    expect(connection.closed).toBe(1);
  });

  it('fans protocol events out to subscribers', async () => {
    const connection = new FakeConnection();
    const client = new ProtocolClient(connection);
    const subscriber = vi.fn();
    client.subscribe(subscriber);
    await client.connect();

    connection.onMessage?.(
      JSON.stringify({
        method: 'event',
        params: {
          type: 'item.delta',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'item-1',
          delta: 'hello',
        },
      }),
    );

    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ type: 'item.delta' }));
  });

  it('rejects pending requests on disconnect and can reconnect', async () => {
    const connection = new FakeConnection();
    const client = new ProtocolClient(connection, 1_000);
    await client.connect();
    connection.send = async (raw) => {
      connection.requests.push(JSON.parse(raw) as ProtocolRequest);
    };

    const pending = client.request('thread/read', { threadId: 'thread-1' });
    connection.onDisconnect?.(new Error('sidecar exited'));
    await expect(pending).rejects.toThrow('sidecar exited');

    connection.send = FakeConnection.prototype.send.bind(connection);
    await expect(client.connect()).resolves.toEqual(
      expect.objectContaining({ protocolVersion: 1 }),
    );
    expect(connection.opened).toBe(2);
  });
});
