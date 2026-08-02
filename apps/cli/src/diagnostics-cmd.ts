import { join, resolve } from 'node:path';
import type { Writable } from 'node:stream';

import { exportDiagnosticBundle } from '@deepcode/app-server/diagnostics';
import { diagnoseSettings } from '@deepcode/core';

import { TrustStore } from './trust.js';

export interface DiagnosticsCommandOptions {
  cwd: string;
  home: string;
  output: Writable;
  errOutput: Writable;
}

export async function runDiagnosticsCommand(
  args: string[],
  options: DiagnosticsCommandOptions,
): Promise<number> {
  if (args[0] !== 'export') {
    options.errOutput.write('Usage: deepcode diagnostics export\n');
    return 2;
  }
  const cwd = resolve(options.cwd);
  const trustStatus = await new TrustStore({ directory: options.home }).statusFor(cwd);
  const config = await diagnoseSettings({ cwd, directory: options.home, trustStatus });
  const result = await exportDiagnosticBundle({
    home: options.home,
    cwd,
    config,
    logPath: join(options.home, 'logs', 'app-server.ndjson'),
  });
  options.output.write(`Wrote redacted diagnostic bundle: ${result.path}\n`);
  return 0;
}
