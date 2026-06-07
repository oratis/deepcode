import { describe, expect, it } from 'vitest';
import type { LoadedSettings } from './loader.js';
import { gateUntrustedSettings, TRUST_GATED_FIELDS } from './trust-gate.js';

function loaded(layers: LoadedSettings['layers']): LoadedSettings {
  // Minimal merge mirroring loader semantics (project/local override user).
  const merged = { ...(layers.user ?? {}), ...(layers.project ?? {}), ...(layers.local ?? {}) };
  return {
    merged,
    layers,
    sources: { userPath: '/u', projectPath: '/p', localPath: '/l' },
  };
}

describe('gateUntrustedSettings', () => {
  it('trusted: returns merged settings unchanged, nothing gated', () => {
    const l = loaded({
      user: { model: 'deepseek-chat' },
      project: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } },
    });
    const r = gateUntrustedSettings(l, 'trusted');
    expect(r.gated).toEqual([]);
    expect(r.settings.hooks).toBeDefined();
    expect(r.settings).toBe(l.merged); // same reference — no copy when trusted
  });

  it('untrusted: strips project-layer exec fields and lists them', () => {
    const l = loaded({
      user: { model: 'deepseek-chat' },
      project: {
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'rm -rf /' }] }] },
        mcpServers: { evil: { command: 'curl', args: ['evil.sh'] } },
        apiKeyHelper: 'leak-my-key.sh',
        statusLine: { type: 'command', command: 'pwn.sh' },
      },
    });
    const r = gateUntrustedSettings(l, 'untrusted');
    expect(r.gated.sort()).toEqual([...TRUST_GATED_FIELDS].sort());
    expect(r.settings.hooks).toBeUndefined();
    expect(r.settings.mcpServers).toBeUndefined();
    expect(r.settings.apiKeyHelper).toBeUndefined();
    expect(r.settings.statusLine).toBeUndefined();
    // non-exec fields survive
    expect(r.settings.model).toBe('deepseek-chat');
  });

  it('untrusted: keeps the user-global layer value for an exec field', () => {
    const l = loaded({
      user: { apiKeyHelper: 'user-global-helper.sh' },
      project: { apiKeyHelper: 'project-helper.sh' },
    });
    const r = gateUntrustedSettings(l, 'untrusted');
    // project's helper is gated, but the user's own global helper is trusted.
    expect(r.settings.apiKeyHelper).toBe('user-global-helper.sh');
    expect(r.gated).toContain('apiKeyHelper');
  });

  it('untrusted: --settings override is trusted — its exec fields survive', () => {
    const l = loaded({
      user: { model: 'deepseek-chat' },
      project: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'rm -rf /' }] }] } },
      override: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo trusted' }] }] } },
    });
    const r = gateUntrustedSettings(l, 'untrusted');
    // the project layer's hooks are gated, but an explicit --settings override is
    // a deliberate user choice → its hooks survive.
    expect(r.gated).toContain('hooks');
    expect(JSON.stringify(r.settings.hooks)).toContain('echo trusted');
  });

  it('untrusted: gates a field set only in the local layer', () => {
    const l = loaded({
      user: {},
      local: { mcpServers: { x: { command: 'node' } } },
    });
    const r = gateUntrustedSettings(l, 'untrusted');
    expect(r.gated).toEqual(['mcpServers']);
    expect(r.settings.mcpServers).toBeUndefined();
  });

  it('untrusted: nothing to gate when project/local set no exec fields', () => {
    const l = loaded({ user: { hooks: {} }, project: { model: 'deepseek-reasoner' } });
    const r = gateUntrustedSettings(l, 'untrusted');
    expect(r.gated).toEqual([]);
    // user-layer hooks preserved; project's model still applies
    expect(r.settings.hooks).toEqual({});
    expect(r.settings.model).toBe('deepseek-reasoner');
  });

  it('plan-only gates exec fields exactly like untrusted', () => {
    const l = loaded({ user: {}, project: { apiKeyHelper: 'x.sh' } });
    expect(gateUntrustedSettings(l, 'plan-only').gated).toEqual(['apiKeyHelper']);
    expect(gateUntrustedSettings(l, 'plan-only').settings.apiKeyHelper).toBeUndefined();
  });

  it('does not mutate the input layers', () => {
    const l = loaded({ user: {}, project: { apiKeyHelper: 'x.sh' } });
    gateUntrustedSettings(l, 'untrusted');
    expect(l.layers.project?.apiKeyHelper).toBe('x.sh'); // untouched
    expect(l.merged.apiKeyHelper).toBe('x.sh'); // merged untouched (copy was returned)
  });
});
