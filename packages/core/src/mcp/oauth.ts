// MCP OAuth — authorization-code + PKCE for http/sse servers, with dynamic
// client registration. The SDK (@modelcontextprotocol/sdk client/auth) drives
// the protocol; we supply an OAuthClientProvider that:
//   · persists tokens / client registration / PKCE verifier under
//     ~/.deepcode/mcp-auth/<server>.json (auto-refresh thereafter), and
//   · catches the browser redirect on a localhost loopback server.
// Spec: docs/DEVELOPMENT_PLAN.md §3.3 (MCP OAuth)

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

interface AuthRecord {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformationFull;
  codeVerifier?: string;
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

export function mcpAuthPath(serverName: string, home: string = homedir()): string {
  return join(home, '.deepcode', 'mcp-auth', `${sanitizeName(serverName)}.json`);
}

/** File-backed persistence for one server's OAuth state. */
export class McpAuthStore {
  constructor(
    private readonly serverName: string,
    private readonly home: string = homedir(),
  ) {}

  path(): string {
    return mcpAuthPath(this.serverName, this.home);
  }

  async read(): Promise<AuthRecord> {
    try {
      return JSON.parse(await fs.readFile(this.path(), 'utf8')) as AuthRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async patch(partial: Partial<AuthRecord>): Promise<void> {
    const current = await this.read();
    const next = { ...current, ...partial };
    await fs.mkdir(dirname(this.path()), { recursive: true });
    await fs.writeFile(this.path(), JSON.stringify(next, null, 2) + '\n', 'utf8');
  }

  /** Drop persisted state. `scope` mirrors OAuthClientProvider.invalidateCredentials. */
  async clear(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery' = 'all',
  ): Promise<void> {
    if (scope === 'all') {
      await fs.rm(this.path(), { force: true });
      return;
    }
    const rec = await this.read();
    if (scope === 'tokens') delete rec.tokens;
    if (scope === 'client') delete rec.clientInformation;
    if (scope === 'verifier') delete rec.codeVerifier;
    await fs.mkdir(dirname(this.path()), { recursive: true });
    await fs.writeFile(this.path(), JSON.stringify(rec, null, 2) + '\n', 'utf8');
  }
}

// ── Loopback receiver ───────────────────────────────────────────────────
// A one-shot localhost HTTP server that captures the `?code=` (and `state`)
// from the OAuth redirect, so the CLI doesn't need a public callback URL.

export interface LoopbackReceiver {
  /** The redirect URL to register with the authorization server. */
  redirectUrl: string;
  /** Resolves with the authorization code once the browser redirects back. */
  waitForCode(): Promise<string>;
  close(): void;
}

export async function startLoopbackReceiver(
  opts: { expectedState?: string; path?: string } = {},
): Promise<LoopbackReceiver> {
  const callbackPath = opts.path ?? '/callback';
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== callbackPath) {
      res.writeHead(404).end('Not found');
      return;
    }
    const err = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (err) {
      res
        .writeHead(400, { 'content-type': 'text/html' })
        .end(`<h1>Authorization failed</h1><p>${err}</p>`);
      rejectCode(new Error(`authorization error: ${err}`));
      return;
    }
    if (opts.expectedState && state !== opts.expectedState) {
      res.writeHead(400, { 'content-type': 'text/html' }).end('<h1>State mismatch</h1>');
      rejectCode(new Error('OAuth state mismatch (possible CSRF)'));
      return;
    }
    if (!code) {
      res
        .writeHead(400, { 'content-type': 'text/html' })
        .end('<h1>Missing authorization code</h1>');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(
        '<!doctype html><meta charset=utf-8><title>DeepCode</title>' +
          '<body style="font-family:system-ui;padding:3rem"><h1>✓ Authorized</h1>' +
          '<p>You can close this tab and return to DeepCode.</p></body>',
      );
    resolveCode(code);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    redirectUrl: `http://127.0.0.1:${port}${callbackPath}`,
    waitForCode: () => codePromise,
    close: () => server.close(),
    // expose rejecter for timeout callers
  } as LoopbackReceiver & { _reject?: typeof rejectCode };
}

/** Open a URL in the system browser (best-effort; logs the URL on failure). */
export function openBrowser(url: string, log: (msg: string) => void): void {
  const p = platform();
  const cmd = p === 'darwin' ? 'open' : p === 'win32' ? 'cmd' : 'xdg-open';
  const args = p === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => log(`Open this URL to authorize:\n  ${url}`));
    child.unref();
  } catch {
    log(`Open this URL to authorize:\n  ${url}`);
  }
}

// ── Provider ──────────────────────────────────────────────────────────────

export interface OAuthProviderOpts {
  clientName?: string;
  scopes?: string[];
  /** Override the browser opener (tests). */
  openBrowser?: (url: string) => void;
  /** Where redirect/instruction lines go. */
  log?: (msg: string) => void;
}

/**
 * OAuthClientProvider backed by McpAuthStore + a loopback receiver. Construct
 * via {@link createMcpOAuthProvider} (it starts the receiver so `redirectUrl`
 * is valid before the SDK reads it). Call `waitForCode()` after the SDK throws
 * `UnauthorizedError`, then `transport.finishAuth(code)` and reconnect.
 */
export class DeepCodeOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly store: McpAuthStore,
    private readonly receiver: LoopbackReceiver,
    private readonly opts: OAuthProviderOpts = {},
  ) {}

  get redirectUrl(): string {
    return this.receiver.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.opts.clientName ?? 'DeepCode',
      redirect_uris: [this.receiver.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: this.opts.scopes?.join(' '),
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.store.read()).clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.store.patch({ clientInformation: info as OAuthClientInformationFull });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.read()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.patch({ tokens });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const log = this.opts.log ?? (() => undefined);
    log(`Opening browser to authorize MCP access…`);
    (this.opts.openBrowser ?? ((u) => openBrowser(u, log)))(authorizationUrl.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.patch({ codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const v = (await this.store.read()).codeVerifier;
    if (!v) throw new Error('no PKCE code_verifier saved');
    return v;
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    await this.store.clear(scope);
  }

  /** Await the authorization code captured by the loopback receiver. */
  waitForCode(): Promise<string> {
    return this.receiver.waitForCode();
  }

  closeReceiver(): void {
    this.receiver.close();
  }
}

export async function createMcpOAuthProvider(
  serverName: string,
  opts: OAuthProviderOpts & { home?: string } = {},
): Promise<DeepCodeOAuthProvider> {
  const store = new McpAuthStore(serverName, opts.home);
  const receiver = await startLoopbackReceiver();
  return new DeepCodeOAuthProvider(store, receiver, opts);
}
