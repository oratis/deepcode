import type { ProtocolRequest } from '@deepcode/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  DesktopProtocolClient,
  type AppServerOutput,
  type ProtocolClientBridge,
} from './protocol-client.js';

class FakeBridge implements ProtocolClientBridge {
  handler?: (output: AppServerOutput) => void;
  started = 0;
  stopped = 0;
  requests: ProtocolRequest[] = [];

  async listen(handler: (output: AppServerOutput) => void) {
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }

  async start() {
    this.started++;
  }

  async send(raw: string) {
    const request = JSON.parse(raw) as ProtocolRequest;
    this.requests.push(request);
    queueMicrotask(() => {
      this.handler?.({
        stream: 'stdout',
        line: JSON.stringify({
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
                    reviewActions: true,
                    configDiagnostics: true,
                  },
                }
              : { ok: true },
        }),
      });
    });
  }

  async stop() {
    this.stopped++;
  }
}

describe('DesktopProtocolClient', () => {
  it('starts the supervised process and negotiates protocol v1', async () => {
    const bridge = new FakeBridge();
    const client = new DesktopProtocolClient(bridge);

    await expect(client.connect()).resolves.toEqual(
      expect.objectContaining({ protocolVersion: 1 }),
    );
    expect(bridge.started).toBe(1);
    expect(bridge.requests[0]).toEqual({ id: 1, method: 'initialize', params: {} });
    await client.connect();
    expect(bridge.started).toBe(1);
    await client.close();
    expect(bridge.stopped).toBe(1);
  });

  it('routes durable and transient notifications to subscribers', async () => {
    const bridge = new FakeBridge();
    const client = new DesktopProtocolClient(bridge);
    const subscriber = vi.fn();
    client.subscribe(subscriber);
    await client.connect();

    bridge.handler?.({
      stream: 'stdout',
      line: JSON.stringify({
        method: 'event',
        params: {
          type: 'item.delta',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'item-1',
          delta: 'hello',
        },
      }),
    });

    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ type: 'item.delta' }));
    await client.close();
  });

  it('rejects pending requests when the supervised process terminates', async () => {
    const bridge = new FakeBridge();
    const client = new DesktopProtocolClient(bridge, 1000);
    await client.connect();
    bridge.send = async (raw) => {
      bridge.requests.push(JSON.parse(raw) as ProtocolRequest);
    };
    const pending = client.request('thread/read', { threadId: 'thread-1' });
    bridge.handler?.({ stream: 'terminated', line: '', code: 1 });

    await expect(pending).rejects.toThrow('app-server terminated');
  });
});
