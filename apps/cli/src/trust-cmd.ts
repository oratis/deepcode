// `deepcode trust [--plan-only | --remove | --list]` — manage directory trust.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.10
//
// Trusting a directory lets its project-local settings.json run code (hooks,
// MCP servers, apiKeyHelper, statusLine). Until trusted, those are gated (see
// core/config/trust-gate). The user-global layer is always trusted.

import type { Writable } from 'node:stream';
import { TrustStore } from './trust.js';

export interface TrustCmdDeps {
  cwd: string;
  home?: string;
  output?: Writable;
}

export async function runTrustCommand(args: string[], deps: TrustCmdDeps): Promise<number> {
  const out = deps.output ?? process.stdout;
  const store = new TrustStore({ home: deps.home });

  if (args.includes('--list')) {
    const state = await store.load();
    const entries = Object.entries(state.dirs);
    if (entries.length === 0) {
      out.write('No trusted directories.\n');
      return 0;
    }
    for (const [dir, info] of entries) {
      const label = info.mode === 'plan-only' ? 'plan-only' : 'full';
      out.write(`${label.padEnd(9)}  ${dir}\n`);
    }
    return 0;
  }

  if (args.includes('--remove')) {
    await store.untrust(deps.cwd);
    out.write(`Removed trust for ${deps.cwd}\n`);
    return 0;
  }

  const mode = args.includes('--plan-only') ? 'plan-only' : 'full';
  await store.trust(deps.cwd, mode);
  out.write(
    mode === 'plan-only'
      ? `Trusted ${deps.cwd} (plan-only — project config can run, but the session starts in plan mode).\n`
      : `Trusted ${deps.cwd} — project hooks, MCP servers, apiKeyHelper, and statusLine are now enabled here.\n`,
  );
  return 0;
}
