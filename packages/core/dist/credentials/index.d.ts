export interface Credentials {
    /** X-Api-Key — primary credential. */
    apiKey?: string;
    /** Bearer token alternative. If both set, Bearer wins. */
    authToken?: string;
    /** Custom DeepSeek API base URL (e.g. for proxies). */
    baseURL?: string;
}
export interface CredentialsStoreOpts {
    home?: string;
    /** Direct DeepCode data directory override (contains credentials.json). */
    directory?: string;
    /** Force file-backend (skip Keychain) — useful for tests. */
    forceFile?: boolean;
}
export declare class CredentialsStore {
    private readonly directory;
    private readonly useKeychain;
    constructor(opts?: CredentialsStoreOpts);
    filePath(): string;
    load(): Promise<Credentials>;
    save(creds: Credentials): Promise<void>;
    clear(): Promise<void>;
    private loadFile;
    private saveFile;
    private loadKeychain;
    private saveKeychain;
    private kcRead;
    private kcWrite;
}
/**
 * Resolve credentials at runtime: apiKeyHelper (if set) overrides stored creds.
 * One-shot resolution — use `ApiKeyHelperRefresher` for periodic refresh on
 * 401 / TTL expiry.
 * Spec: docs/DEVELOPMENT_PLAN.md §3.4
 */
export declare function resolveCredentials(args: {
    store: CredentialsStore;
    apiKeyHelper?: string;
}): Promise<Credentials>;
/**
 * Periodic apiKeyHelper refresher.
 *
 * Spec: docs/DEVELOPMENT_PLAN.md §3.4 — re-execute apiKeyHelper on a TTL and
 * on 401-class failures. Caller wires `.invalidate()` to whenever provider
 * sees auth-failure response.
 *
 * TTL is controlled by env var DEEPCODE_API_KEY_HELPER_TTL_MS (default 300_000).
 */
export interface ApiKeyHelperOpts {
    store: CredentialsStore;
    apiKeyHelper: string;
    ttlMs?: number;
}
export declare class ApiKeyHelperRefresher {
    private readonly opts;
    private readonly ttlMs;
    private cached;
    constructor(opts: ApiKeyHelperOpts);
    /** Get the current key — refresh if expired. */
    get(): Promise<Credentials>;
    /** Force a refresh (e.g. on 401). */
    refresh(): Promise<Credentials>;
    /** Mark the cache stale so next .get() refreshes. */
    invalidate(): void;
}
/** Display-safe redacted form of a credential — first 4 + last 4. */
export declare function redact(value: string | undefined): string;
//# sourceMappingURL=index.d.ts.map