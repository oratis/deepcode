import type {
  ProtocolMethod,
  ProtocolNotification,
  ProtocolRequest,
  ProtocolResponse,
} from './types.js';

const protocolMethods = new Set<ProtocolMethod>([
  'initialize',
  'config/diagnostics',
  'diagnostics/export',
  'workspace/diff',
  'review/apply',
  'review/revert',
  'thread/start',
  'thread/read',
  'thread/resume',
  'turn/start',
  'turn/interrupt',
  'approval/respond',
  'user-input/respond',
]);

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
    !protocolMethods.has(value.method as ProtocolMethod) ||
    !validParams
  ) {
    throw new Error('invalid protocol request');
  }
  return { id: value.id, method: value.method, params: value.params ?? {} } as ProtocolRequest;
}
