import { describe, expect, it } from 'vitest';

import { decodeProtocolRequest, encodeProtocolMessage } from './codec.js';

describe('protocol codec', () => {
  it('has a stable line-oriented JSON representation', () => {
    const request = {
      id: 1,
      method: 'initialize' as const,
      params: { client: 'protocol-test' },
    };

    expect(encodeProtocolMessage(request)).toBe(
      '{"id":1,"method":"initialize","params":{"client":"protocol-test"}}',
    );
    expect(decodeProtocolRequest(encodeProtocolMessage(request))).toEqual(request);
  });

  it('encodes event notifications without a request id', () => {
    expect(
      encodeProtocolMessage({
        method: 'event',
        params: {
          type: 'item.delta',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'item-1',
          delta: 'hello',
        },
      }),
    ).toBe(
      '{"method":"event","params":{"type":"item.delta","threadId":"thread-1","turnId":"turn-1","itemId":"item-1","delta":"hello"}}',
    );
  });

  it.each([
    'approval/respond',
    'user-input/respond',
    'config/diagnostics',
    'diagnostics/export',
    'workspace/diff',
    'review/apply',
  ] as const)('accepts the interactive response method %s', (method) => {
    expect(decodeProtocolRequest(JSON.stringify({ id: 2, method, params: {} }))).toEqual({
      id: 2,
      method,
      params: {},
    });
  });

  it.each(['{}', '{"id":1,"method":"unknown"}', '{"id":1,"method":"initialize","params":[]}'])(
    'rejects an invalid request: %s',
    (raw) => {
      expect(() => decodeProtocolRequest(raw)).toThrow('invalid protocol request');
    },
  );
});
