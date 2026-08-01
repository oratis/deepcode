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

  it.each(['{}', '{"id":1,"method":"unknown"}', '{"id":1,"method":"initialize","params":[]}'])(
    'rejects an invalid request: %s',
    (raw) => {
      expect(() => decodeProtocolRequest(raw)).toThrow('invalid protocol request');
    },
  );
});
