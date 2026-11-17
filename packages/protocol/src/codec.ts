import type {
  ProtocolMethod,
  ProtocolNotification,
  ProtocolRequest,
  ProtocolResponse,
} from './types.js';

// Exhaustive against the public contract: adding a method must update the wire
// decoder too, before a server can advertise a capability that stdio rejects.
const protocolMethods = {
  initialize: true,
  'runtime/capabilities': true,
  'config/diagnostics': true,
  'diagnostics/export': true,
  'workspace/diff': true,
  'review/apply': true,
  'review/revert': true,
  'thread/rename': true,
  'session/snapshots': true,
  'thread/start': true,
  'thread/read': true,
  'thread/resume': true,
  'thread/list': true,
  'thread/fork': true,
  'thread/archive': true,
  'thread/delete': true,
  'turn/start': true,
  'turn/interrupt': true,
  'approval/respond': true,
  'user-input/respond': true,
} satisfies Record<ProtocolMethod, true>;

export function encodeProtocolMessage(
  message: ProtocolRequest | ProtocolResponse | ProtocolNotification,
): string {
  return JSON.stringify(message);
}

export function decodeProtocolRequest(raw: string): ProtocolRequest {
  const value = JSON.parse(raw) as Partial<ProtocolRequest>;
  const validParams =
    value.params === undefined ||
    (typeof value.params === 'object' && value.params !== null && !Array.isArray(value.params));
  if (
    (typeof value.id !== 'string' && typeof value.id !== 'number') ||
    typeof value.method !== 'string' ||
    !Object.hasOwn(protocolMethods, value.method) ||
    !validParams
  ) {
    throw new Error('invalid protocol request');
  }
  return { id: value.id, method: value.method, params: value.params ?? {} } as ProtocolRequest;
}
