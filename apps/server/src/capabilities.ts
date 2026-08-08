// Server-side answer to `runtime/capabilities`.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.C
//
// Resolves the same inputs the CLI resolves and hands them to the same builder
// in `@deepcode/core`. Shaping the object here instead would be the exact drift
// this method exists to make visible.

import {
  buildRuntimeCapabilities,
  ledgerPath,
  loadFileContract,
  loadSettings,
  withAdditionalWritableDirs,
  type Mode,
} from '@deepcode/core';
import type { RuntimeCapabilitiesResult } from '@deepcode/protocol';

export async function capabilitiesFor(
  cwd: string,
  home: string,
): Promise<RuntimeCapabilitiesResult> {
  const { merged } = await loadSettings({ cwd, directory: home });
  const contract = await loadFileContract({ cwd, directory: home });

  return buildRuntimeCapabilities({
    cwd,
    mode: (merged.permissions?.defaultMode ?? 'default') as Mode,
    permissions: merged.permissions,
    sandboxConfig: withAdditionalWritableDirs(
      merged.sandbox,
      merged.permissions?.additionalDirectories,
      cwd,
    ),
    sandboxDefaultMode: 'workspace-write',
    fileContract: contract.status,
    ledger: { enabled: true, path: ledgerPath(cwd, 'changes', home) },
    modules: {
      hooks: !!merged.hooks,
      plugins: merged.plugins?.globalEnabled !== false,
      ledger: true,
      fileContract: contract.status === 'loaded',
    },
  });
}
