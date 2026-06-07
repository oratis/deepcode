// Tests for the parity slash commands: /recap, /login, /logout, /pr_comments.
// Credentials tests use a forceFile store under a temp HOME (never the keychain,
// never real creds). /recap uses a mock provider; /pr_comments' renderer is pure.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialsStore, SessionManager } from '@deepcode/core';
import { CommandRegistry, formatPrComments, type SessionContext } from './commands.js';

const reg = new CommandRegistry();
const tmps: string[] = [];
async function tmpHome(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'dc-parity-'));
  tmps.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(tmps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    cwd: '/tmp/x',
    model: 'deepseek-chat',
    mode: 'default',
    effort: 'medium',
    settings: {},
    creds: { apiKey: 'sk-test' },
    sessionId: 's1',
    sessions: new SessionManager({ root: '/tmp/x' }),
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 },
    ...overrides,
  };
}

const mockProvider = {
  runTurn: async () => ({
    content: [{ type: 'text', text: '- explored repo\n- decided on plan' }],
    stopReason: 'end_turn',
    usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0 },
  }),
} as unknown as SessionContext['provider'];

describe('/recap', () => {
  it('summarizes the conversation via the provider', async () => {
    const out = await reg.match('/recap')!.cmd.run(
      [],
      ctx({
        provider: mockProvider,
        history: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    );
    expect(out.join('\n')).toContain('explored repo');
  });

  it('reports an empty conversation', async () => {
    const out = await reg
      .match('/recap')!
      .cmd.run([], ctx({ provider: mockProvider, history: [] }));
    expect(out.join('\n')).toMatch(/nothing to recap/i);
  });

  it('needs a provider', async () => {
    const out = await reg
      .match('/recap')!
      .cmd.run([], ctx({ history: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }));
    expect(out.join('\n')).toMatch(/requires a provider/i);
  });
});

describe('/login + /logout', () => {
  it('/logout clears stored credentials and requests exit', async () => {
    const home = await tmpHome();
    const store = new CredentialsStore({ home, forceFile: true });
    await store.save({ apiKey: 'sk-willbecleared' });
    const c = ctx({ credsStore: store, creds: { apiKey: 'sk-willbecleared' } });
    const out = await reg.match('/logout')!.cmd.run([], c);
    expect(out.join('\n')).toMatch(/logged out/i);
    expect(c.exitRequested).toBe(true);
    expect((await store.load()).apiKey).toBeFalsy();
  });

  it('/login <key> saves a new key', async () => {
    const home = await tmpHome();
    const store = new CredentialsStore({ home, forceFile: true });
    const out = await reg
      .match('/login')!
      .cmd.run(['sk-brandnew456'], ctx({ credsStore: store, creds: {} }));
    expect(out.join('\n')).toMatch(/saved/i);
    expect((await store.load()).apiKey).toBe('sk-brandnew456');
  });

  it('/login with no arg shows status + usage', async () => {
    const home = await tmpHome();
    const store = new CredentialsStore({ home, forceFile: true });
    const out = await reg
      .match('/login')!
      .cmd.run([], ctx({ credsStore: store, creds: { apiKey: 'sk-existing' } }));
    expect(out.join('\n')).toMatch(/authenticated/i);
    expect(out.join('\n')).toMatch(/usage: \/login/i);
  });
});

describe('/pr_comments', () => {
  it('formatPrComments renders comments with author + body', () => {
    const lines = formatPrComments({
      number: 42,
      title: 'My PR',
      comments: [
        {
          author: { login: 'alice' },
          body: 'looks good\nship it',
          createdAt: '2026-06-04T01:00:00Z',
        },
      ],
    }).join('\n');
    expect(lines).toContain('PR #42 — My PR');
    expect(lines).toContain('@alice');
    expect(lines).toContain('looks good');
    expect(lines).toContain('ship it');
  });

  it('formatPrComments handles a PR with no comments', () => {
    const lines = formatPrComments({ number: 7, title: 'Quiet PR', comments: [] }).join('\n');
    expect(lines).toMatch(/no comments/i);
  });

  it('reports gracefully outside a PR / without gh', async () => {
    const dir = await tmpHome();
    const out = (await reg.match('/pr_comments')!.cmd.run([], ctx({ cwd: dir }))).join('\n');
    // Whether gh is installed or not, we must not throw and must say something sane.
    expect(out).toMatch(/no open pull request|needs the github cli|failed/i);
  });
});

describe('/upgrade + /privacy-settings', () => {
  it('/upgrade shows the version + update instructions', async () => {
    const out = (await reg.match('/upgrade')!.cmd.run([], ctx())).join('\n');
    expect(out).toMatch(/DeepCode CLI v\d/);
    expect(out).toMatch(/npm i -g deepcode-cli@latest/);
  });

  it('/privacy-settings shows data locations + the DeepSeek endpoint', async () => {
    const out = (
      await reg
        .match('/privacy-settings')!
        .cmd.run([], ctx({ creds: { apiKey: 'x', baseURL: 'https://api.deepseek.com/v1' } }))
    ).join('\n');
    expect(out).toMatch(/credentials\.json/);
    expect(out).toMatch(/sessions/);
    expect(out).toMatch(/api\.deepseek\.com/);
    expect(out).toMatch(/security-model\.md/);
  });
});

describe('/config set', () => {
  it('writes a dotted key to the user settings file', async () => {
    const path = join(await tmpHome(), 'settings.json');
    const out = await reg
      .match('/config')!
      .cmd.run(['set', 'permissions.defaultMode', 'plan'], ctx({ userSettingsPath: path }));
    expect(out.join('\n')).toMatch(/Set permissions\.defaultMode/);
    const written = JSON.parse(await readFile(path, 'utf8')) as {
      permissions?: { defaultMode?: string };
    };
    expect(written.permissions?.defaultMode).toBe('plan');
  });

  it('parses a JSON value (number, not string)', async () => {
    const path = join(await tmpHome(), 'settings.json');
    await reg
      .match('/config')!
      .cmd.run(['set', 'memoryLoadCapKB', '200'], ctx({ userSettingsPath: path }));
    const written = JSON.parse(await readFile(path, 'utf8')) as { memoryLoadCapKB?: number };
    expect(written.memoryLoadCapKB).toBe(200);
  });

  it('shows usage for `/config set` with no key/value', async () => {
    const out = await reg.match('/config')!.cmd.run(['set'], ctx());
    expect(out.join('\n')).toMatch(/Usage: \/config set/);
  });
});

describe('/add-dir', () => {
  it('persists a validated directory to permissions.additionalDirectories', async () => {
    const home = await tmpHome(); // a real, existing directory
    const path = join(home, 'settings.json');
    const out = await reg.match('/add-dir')!.cmd.run([home], ctx({ userSettingsPath: path }));
    expect(out.join('\n')).toMatch(/Added .* writable directory/i);
    const written = JSON.parse(await readFile(path, 'utf8')) as {
      permissions?: { additionalDirectories?: string[] };
    };
    expect(written.permissions?.additionalDirectories).toContain(home);
  });

  it('rejects a non-existent directory', async () => {
    const home = await tmpHome();
    const out = await reg
      .match('/add-dir')!
      .cmd.run([join(home, 'nope')], ctx({ userSettingsPath: join(home, 'settings.json') }));
    expect(out.join('\n')).toMatch(/no such directory/i);
  });

  it('lists current directories with no args', async () => {
    const out = await reg
      .match('/add-dir')!
      .cmd.run([], ctx({ settings: { permissions: { additionalDirectories: ['/x/y'] } } }));
    expect(out.join('\n')).toContain('/x/y');
  });
});
