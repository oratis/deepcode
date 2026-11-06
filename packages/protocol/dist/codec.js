const protocolMethods = new Set([
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
export function encodeProtocolMessage(message) {
    return JSON.stringify(message);
}
export function decodeProtocolRequest(raw) {
    const value = JSON.parse(raw);
    const validParams = value.params === undefined ||
        (typeof value.params === 'object' && value.params !== null && !Array.isArray(value.params));
    if ((typeof value.id !== 'string' && typeof value.id !== 'number') ||
        typeof value.method !== 'string' ||
        !protocolMethods.has(value.method) ||
        !validParams) {
        throw new Error('invalid protocol request');
    }
    return { id: value.id, method: value.method, params: value.params ?? {} };
}
//# sourceMappingURL=codec.js.map