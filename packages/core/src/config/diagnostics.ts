import { resolve } from 'node:path';

import { loadSettings, type LoadSettingsOpts, type SettingsLayerName } from './loader.js';
import { validateSettingsShallow } from './validation.js';
import { gateUntrustedSettings, type TrustStatus } from './trust-gate.js';

export type SettingsDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface SettingsDiagnosticIssue {
  severity: SettingsDiagnosticSeverity;
  code: 'schema_validation' | 'untrusted_setting_gated';
  message: string;
  pointer?: string;
  source?: { layer: SettingsLayerName; path: string };
}

export interface SettingsLayerDiagnostic {
  layer: SettingsLayerName;
  path: string;
  present: boolean;
  trusted: boolean;
}

export interface SettingsDiagnostics {
  cwd: string;
  trustStatus: TrustStatus;
  layers: SettingsLayerDiagnostic[];
  /** Winning sources before trust gating. Values are deliberately omitted. */
  provenance: Record<string, { layer: SettingsLayerName; path: string }>;
  gated: string[];
  issues: SettingsDiagnosticIssue[];
}

export interface DiagnoseSettingsOptions extends LoadSettingsOpts {
  trustStatus: TrustStatus;
}

/** Build a value-free diagnostic report suitable for protocol/UI/log export. */
export async function diagnoseSettings(
  options: DiagnoseSettingsOptions,
): Promise<SettingsDiagnostics> {
  const loaded = await loadSettings(options);
  const gate = gateUntrustedSettings(loaded, options.trustStatus);
  const issues: SettingsDiagnosticIssue[] = validateSettingsShallow(
    loaded.merged as Record<string, unknown>,
  ).map((message) => ({ severity: 'error', code: 'schema_validation', message }));

  for (const field of gate.gated) {
    const pointer = `/${field}`;
    issues.push({
      severity: 'warning',
      code: 'untrusted_setting_gated',
      message: `Ignored project setting ${pointer} until this directory is trusted`,
      pointer,
      source: sourceForPrefix(loaded.provenance, pointer),
    });
  }

  const layerPaths: Record<SettingsLayerName, string | undefined> = {
    user: loaded.sources.userPath,
    project: loaded.sources.projectPath,
    local: loaded.sources.localPath,
    override: loaded.sources.overridePath,
  };
  return {
    cwd: resolve(options.cwd),
    trustStatus: options.trustStatus,
    layers: (['user', 'project', 'local', 'override'] as const)
      .filter((layer) => layerPaths[layer] !== undefined)
      .map((layer) => ({
        layer,
        path: layerPaths[layer]!,
        present: loaded.layers[layer] !== undefined,
        trusted: layer === 'user' || layer === 'override' || options.trustStatus === 'trusted',
      })),
    provenance: loaded.provenance,
    gated: [...gate.gated],
    issues,
  };
}

function sourceForPrefix(
  provenance: SettingsDiagnostics['provenance'],
  pointer: string,
): SettingsDiagnostics['provenance'][string] | undefined {
  return Object.entries(provenance).find(
    ([candidate]) => candidate === pointer || candidate.startsWith(`${pointer}/`),
  )?.[1];
}
