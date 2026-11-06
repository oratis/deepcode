import type { ProtocolNotification, ProtocolRequest, ProtocolResponse } from './types.js';
export declare function encodeProtocolMessage(message: ProtocolRequest | ProtocolResponse | ProtocolNotification): string;
export declare function decodeProtocolRequest(raw: string): ProtocolRequest;
//# sourceMappingURL=codec.d.ts.map