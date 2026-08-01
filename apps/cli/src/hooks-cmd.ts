import type { Writable } from 'node:stream';

import {
  DirectoryTrustStore,
  gateUntrustedSettings,
  HookTrustStore,
  loadSettings,
} from '@deepcode/core';

export async function runHooksCommand(
  args: string[],
  deps: { cwd: string; home?: string; output?: Writable; errOutput?: Writable },
): Promise<number> {
  const out = deps.output ?? process.stdout;
  const err = deps.errOutput ?? process.stderr;
  const directoryTrust = new DirectoryTrustStore({ home: deps.home });
  const trustStatus = await directoryTrust.statusFor(deps.cwd);
  if (trustStatus !== 'trusted') {
    err.write('Trust this directory with `deepcode trust` before reviewing project hooks.\n');
    return 2;
  }
  const loaded = await loadSettings({ cwd: deps.cwd, home: deps.home });
  const gate = gateUntrustedSettings(loaded, trustStatus);
  const store = new HookTrustStore({ home: deps.home });
  const result = await store.review(deps.cwd, loaded, gate.settings.hooks);
  const action = args[0] ?? 'list';

  if (action === 'trust') {
    const pending = result.reviews.filter((review) => !review.trusted);
    const requested = args.slice(1);
    if (requested.length === 0) {
      for (const review of pending) {
        out.write(`pending  ${review.hash}  ${review.event}  ${review.command}\n`);
      }
      err.write('Pass one or more hook hashes, or `--all`, after reviewing the definitions.\n');
      return 2;
    }
    const selected = requested.includes('--all')
      ? pending
      : pending.filter((review) => requested.includes(review.hash));
    const unknown = requested.filter(
      (value) => value !== '--all' && !pending.some((review) => review.hash === value),
    );
    if (unknown.length > 0) {
      err.write(`Unknown or already-trusted hook hash: ${unknown.join(', ')}\n`);
      return 2;
    }
    await store.trust(deps.cwd, selected);
    out.write(`Trusted ${selected.length} project command hook definition(s) in ${deps.cwd}.\n`);
    return 0;
  }
  if (action === 'revoke') {
    await store.revoke(deps.cwd);
    out.write(`Revoked project command hook trust in ${deps.cwd}.\n`);
    return 0;
  }
  if (action !== 'list') {
    err.write('Usage: deepcode hooks [list | trust <hash...|--all> | revoke]\n');
    return 2;
  }
  if (result.reviews.length === 0) {
    out.write('No project command hooks require review.\n');
    return 0;
  }
  for (const review of result.reviews) {
    out.write(
      `${review.trusted ? 'trusted' : 'pending'}  ${review.hash}  ${review.event}  ${review.command}\n`,
    );
  }
  return 0;
}
