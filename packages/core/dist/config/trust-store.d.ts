import type { TrustStatus } from './trust-gate.js';
export interface DirectoryTrustState {
    dirs: Record<string, {
        trustedAt: string;
        mode: 'full' | 'plan-only';
    }>;
}
export interface DirectoryTrustStoreOptions {
    /** User home. Ignored when `directory` is supplied. */
    home?: string;
    /** Direct DeepCode data directory, for app-server sidecars and tests. */
    directory?: string;
}
/** Canonical directory-trust store shared by every runtime host. */
export declare class DirectoryTrustStore {
    private readonly directory;
    constructor(options?: DirectoryTrustStoreOptions);
    filePath(): string;
    load(): Promise<DirectoryTrustState>;
    save(state: DirectoryTrustState): Promise<void>;
    statusFor(cwd: string): Promise<TrustStatus>;
    trust(cwd: string, mode: 'full' | 'plan-only'): Promise<void>;
    untrust(cwd: string): Promise<void>;
}
//# sourceMappingURL=trust-store.d.ts.map