export interface MarketplaceEntry {
    name: string;
    version: string;
    /** SHA-256 hash recorded by the publisher; we re-verify on local install. */
    sourceHash: string;
    /** Base64-encoded ed25519 signature over `${name}|${version}|${sourceHash}`. */
    sigBase64: string;
    /** Base64-encoded ed25519 public key of the publisher (DER SPKI form). */
    publisherPubKey: string;
    /** Free-form publisher label (display only — trust comes from pubkey). */
    publisher: string;
    downloadUrl: string;
    description?: string;
}
export interface MarketplaceIndex {
    version: '1';
    entries: MarketplaceEntry[];
}
export interface RevokedEntry {
    name: string;
    version: string;
    sourceHash: string;
    reason?: string;
}
export interface RevokedList {
    version: '1';
    entries: RevokedEntry[];
}
export declare function marketplacesPath(home?: string): string;
export interface MarketplaceConfig {
    /** URL → optional pubkey for that marketplace (so an entry's pubkey is verified to come FROM that source). */
    marketplaces: Record<string, {
        rootPubKey?: string;
    }>;
}
/**
 * Verify a marketplace entry's ed25519 signature.
 * Returns true on success; false on any tamper / invalid signature.
 */
export declare function verifyEntrySignature(entry: MarketplaceEntry): boolean;
export declare function isRevoked(entry: MarketplaceEntry, revoked: RevokedList): boolean;
/**
 * Fetch an index from a marketplace URL. Returns parsed entries.
 * Caller is responsible for verifying signatures (see verifyEntrySignature).
 */
export declare function fetchIndex(url: string): Promise<MarketplaceIndex>;
/**
 * Fetch revoked.json from the same marketplace base URL.
 * If the file is missing (404) we treat it as "no revocations" — silent.
 */
export declare function fetchRevoked(baseUrl: string): Promise<RevokedList>;
/**
 * Resolve a marketplace entry: fetch index + revoked, find by name (and
 * optional version), verify signature, ensure not revoked.
 */
export declare function resolveEntry(args: {
    marketplaceUrl: string;
    name: string;
    version?: string;
}): Promise<MarketplaceEntry>;
/**
 * Load the user's marketplace registry (~/.deepcode/marketplaces.json).
 * Returns { marketplaces: {} } if missing.
 */
export declare function loadMarketplaceConfig(home?: string): Promise<MarketplaceConfig>;
export declare function saveMarketplaceConfig(config: MarketplaceConfig, home?: string): Promise<void>;
/**
 * Adds a marketplace URL to the user's config. Validates by fetching the
 * index (must parse).
 */
export declare function addMarketplace(url: string, opts?: {
    home?: string;
    rootPubKey?: string;
}): Promise<MarketplaceConfig>;
//# sourceMappingURL=marketplace.d.ts.map