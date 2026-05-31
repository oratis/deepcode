import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMcpOAuthProvider,
  mcpAuthPath,
  McpAuthStore,
  startLoopbackReceiver,
} from './oauth.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

const TOKENS: OAuthTokens = { access_token: 'at-123', token_type: 'Bearer', refresh_token: 'rt-9' };

describe('McpAuthStore', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-oauth-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('path is under ~/.deepcode/mcp-auth and sanitizes the server name', () => {
    expect(mcpAuthPath('git/hub', home)).toBe(join(home, '.deepcode', 'mcp-auth', 'git_hub.json'));
  });

  it('read() returns {} when absent; patch persists + merges', async () => {
    const s = new McpAuthStore('srv', home);
    expect(await s.read()).toEqual({});
    await s.patch({ tokens: TOKENS });
    await s.patch({ codeVerifier: 'verifier-abc' });
    const rec = await s.read();
    expect(rec.tokens).toEqual(TOKENS);
    expect(rec.codeVerifier).toBe('verifier-abc');
  });

  it('clear(scope) drops only the targeted slice; clear(all) removes the file', async () => {
    const s = new McpAuthStore('srv', home);
    await s.patch({ tokens: TOKENS, codeVerifier: 'v' });
    await s.clear('tokens');
    expect((await s.read()).tokens).toBeUndefined();
    expect((await s.read()).codeVerifier).toBe('v');
    await s.clear('all');
    expect(await s.read()).toEqual({});
  });
});

describe('startLoopbackReceiver', () => {
  it('captures the authorization code from the redirect', async () => {
    const r = await startLoopbackReceiver();
    try {
      expect(r.redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const codeP = r.waitForCode();
      const res = await fetch(`${r.redirectUrl}?code=THE_CODE&state=s1`);
      expect(res.status).toBe(200);
      expect(await codeP).toBe('THE_CODE');
    } finally {
      r.close();
    }
  });

  it('rejects on an error redirect', async () => {
    const r = await startLoopbackReceiver();
    try {
      // Attach the rejection expectation BEFORE triggering it, so the rejection
      // never lands without a handler (avoids an unhandled-rejection warning).
      const assertion = expect(r.waitForCode()).rejects.toThrow(/access_denied/);
      await fetch(`${r.redirectUrl}?error=access_denied`);
      await assertion;
    } finally {
      r.close();
    }
  });

  it('rejects on a state mismatch', async () => {
    const r = await startLoopbackReceiver({ expectedState: 'expected' });
    try {
      const assertion = expect(r.waitForCode()).rejects.toThrow(/state mismatch/i);
      await fetch(`${r.redirectUrl}?code=x&state=wrong`);
      await assertion;
    } finally {
      r.close();
    }
  });
});

describe('DeepCodeOAuthProvider', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-oauthp-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('builds PKCE client metadata pointing at the loopback redirect', async () => {
    const p = await createMcpOAuthProvider('srv', { home, scopes: ['read', 'write'] });
    try {
      const meta = p.clientMetadata;
      expect(meta.redirect_uris[0]).toBe(p.redirectUrl);
      expect(meta.redirect_uris[0]).toMatch(/127\.0\.0\.1/);
      expect(meta.grant_types).toContain('authorization_code');
      expect(meta.response_types).toContain('code');
      expect(meta.token_endpoint_auth_method).toBe('none');
      expect(meta.scope).toBe('read write');
    } finally {
      p.closeReceiver();
    }
  });

  it('persists tokens + verifier through the store', async () => {
    const p = await createMcpOAuthProvider('srv', { home });
    try {
      expect(await p.tokens()).toBeUndefined();
      await p.saveTokens(TOKENS);
      await p.saveCodeVerifier('pkce-verifier');
      expect(await p.tokens()).toEqual(TOKENS);
      expect(await p.codeVerifier()).toBe('pkce-verifier');
      // a fresh provider (new receiver) still reads persisted state
      const p2 = await createMcpOAuthProvider('srv', { home });
      try {
        expect(await p2.tokens()).toEqual(TOKENS);
      } finally {
        p2.closeReceiver();
      }
    } finally {
      p.closeReceiver();
    }
  });

  it('codeVerifier() throws if none saved; redirectToAuthorization opens the URL', async () => {
    const opened: string[] = [];
    const p = await createMcpOAuthProvider('srv', { home, openBrowser: (u) => opened.push(u) });
    try {
      await expect(p.codeVerifier()).rejects.toThrow(/code_verifier/);
      await p.redirectToAuthorization(new URL('https://auth.example.com/authorize?x=1'));
      expect(opened).toEqual(['https://auth.example.com/authorize?x=1']);
    } finally {
      p.closeReceiver();
    }
  });
});
