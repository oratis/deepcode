import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationFull, OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
interface AuthRecord {
    tokens?: OAuthTokens;
    clientInformation?: OAuthClientInformationFull;
    codeVerifier?: string;
}
export declare function mcpAuthPath(serverName: string, home?: string, directory?: string): string;
/** File-backed persistence for one server's OAuth state. */
export declare class McpAuthStore {
    private readonly serverName;
    private readonly home;
    private readonly directory?;
    constructor(serverName: string, home?: string, directory?: string | undefined);
    path(): string;
    read(): Promise<AuthRecord>;
    patch(partial: Partial<AuthRecord>): Promise<void>;
    /** Drop persisted state. `scope` mirrors OAuthClientProvider.invalidateCredentials. */
    clear(scope?: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void>;
}
export interface LoopbackReceiver {
    /** The redirect URL to register with the authorization server. */
    redirectUrl: string;
    /** Resolves with the authorization code once the browser redirects back. */
    waitForCode(): Promise<string>;
    close(): void;
}
export declare function startLoopbackReceiver(opts?: {
    expectedState?: string;
    path?: string;
}): Promise<LoopbackReceiver>;
/** Open a URL in the system browser (best-effort; logs the URL on failure). */
export declare function openBrowser(url: string, log: (msg: string) => void): void;
export interface OAuthProviderOpts {
    clientName?: string;
    scopes?: string[];
    /** Override the browser opener (tests). */
    openBrowser?: (url: string) => void;
    /** Where redirect/instruction lines go. */
    log?: (msg: string) => void;
    /** Direct DeepCode data directory for persisted OAuth state. */
    directory?: string;
}
/**
 * OAuthClientProvider backed by McpAuthStore + a loopback receiver. Construct
 * via {@link createMcpOAuthProvider} (it starts the receiver so `redirectUrl`
 * is valid before the SDK reads it). Call `waitForCode()` after the SDK throws
 * `UnauthorizedError`, then `transport.finishAuth(code)` and reconnect.
 */
export declare class DeepCodeOAuthProvider implements OAuthClientProvider {
    private readonly store;
    private readonly receiver;
    private readonly opts;
    constructor(store: McpAuthStore, receiver: LoopbackReceiver, opts?: OAuthProviderOpts);
    get redirectUrl(): string;
    get clientMetadata(): OAuthClientMetadata;
    clientInformation(): Promise<OAuthClientInformationMixed | undefined>;
    saveClientInformation(info: OAuthClientInformationMixed): Promise<void>;
    tokens(): Promise<OAuthTokens | undefined>;
    saveTokens(tokens: OAuthTokens): Promise<void>;
    redirectToAuthorization(authorizationUrl: URL): Promise<void>;
    saveCodeVerifier(codeVerifier: string): Promise<void>;
    codeVerifier(): Promise<string>;
    invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void>;
    /** Await the authorization code captured by the loopback receiver. */
    waitForCode(): Promise<string>;
    closeReceiver(): void;
}
export declare function createMcpOAuthProvider(serverName: string, opts?: OAuthProviderOpts & {
    home?: string;
}): Promise<DeepCodeOAuthProvider>;
export {};
//# sourceMappingURL=oauth.d.ts.map