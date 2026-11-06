import type { LoadedSettings } from './loader.js';
import type { HookEventName, HookHandler, Hooks } from './types.js';
export interface HookReview {
    hash: string;
    event: HookEventName;
    matcher?: string;
    command: string;
    source: {
        layer: 'project' | 'local';
        path: string;
    };
    trusted: boolean;
}
interface HookTrustState {
    version: 1;
    directories: Record<string, Record<string, {
        trustedAt: string;
        sourcePath: string;
    }>>;
}
export declare class HookTrustStore {
    private readonly directory;
    constructor(options?: {
        home?: string;
        directory?: string;
    });
    filePath(): string;
    load(): Promise<HookTrustState>;
    save(state: HookTrustState): Promise<void>;
    review(cwd: string, loaded: LoadedSettings, hooks: Hooks | undefined): Promise<{
        hooks: Hooks | undefined;
        reviews: HookReview[];
    }>;
    trust(cwd: string, reviews: HookReview[]): Promise<void>;
    revoke(cwd: string): Promise<void>;
}
export declare function hookDefinitionHash(event: HookEventName, matcher: string | undefined, handler: HookHandler): string;
export {};
//# sourceMappingURL=hook-trust.d.ts.map