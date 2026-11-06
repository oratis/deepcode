export interface ImageContentBlock {
    type: 'image';
    /** One of: data URL, file path, or http(s) URL. */
    source: string;
    /** Optional alt-text — useful for accessibility + provider hints. */
    altText?: string;
}
export interface VisionProvider {
    readonly name: string;
    /** Whether this provider can handle the image (e.g. some only accept JPEG). */
    supports(block: ImageContentBlock): boolean;
    /**
     * Convert an ImageContentBlock to the provider-specific shape. Most APIs
     * accept either base64 data URLs or remote URLs.
     */
    encode(block: ImageContentBlock): Promise<ProviderImagePayload>;
}
/** What the provider's chat API wants for an image attachment. */
export interface ProviderImagePayload {
    /** Provider-native shape. The agent loop treats this opaquely. */
    payload: unknown;
    /** Provider-reported size in bytes (for cost accounting). */
    byteSize: number;
}
/**
 * Resolve any of (data URL | file path | http URL) into a normalized
 * { contentType, base64, byteSize } tuple. Used by providers that want
 * to upload as base64 vs link directly.
 */
export declare function loadImage(block: ImageContentBlock): Promise<{
    contentType: string;
    base64: string;
    byteSize: number;
}>;
export declare function parseDataUrl(dataUrl: string): {
    contentType: string;
    base64: string;
    byteSize: number;
};
export declare function guessContentType(path: string): string;
export declare class StubVisionProvider implements VisionProvider {
    readonly name = "stub";
    supports(): boolean;
    encode(): Promise<ProviderImagePayload>;
}
export declare class OpenAICompatVisionProvider implements VisionProvider {
    readonly name = "openai-compat";
    /** Max image bytes the provider accepts; default 20 MB. */
    maxBytes: number;
    supports(block: ImageContentBlock): boolean;
    encode(block: ImageContentBlock): Promise<ProviderImagePayload>;
}
//# sourceMappingURL=index.d.ts.map