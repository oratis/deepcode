import { type LoadSettingsOpts, type SettingsLayerName } from './loader.js';
import { type TrustStatus } from './trust-gate.js';
export type SettingsDiagnosticSeverity = 'info' | 'warning' | 'error';
export interface SettingsDiagnosticIssue {
    severity: SettingsDiagnosticSeverity;
    code: 'schema_validation' | 'untrusted_setting_gated' | 'hook_review_required';
    message: string;
    pointer?: string;
    source?: {
        layer: SettingsLayerName;
        path: string;
    };
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
    provenance: Record<string, {
        layer: SettingsLayerName;
        path: string;
    }>;
    gated: string[];
    issues: SettingsDiagnosticIssue[];
}
export interface DiagnoseSettingsOptions extends LoadSettingsOpts {
    trustStatus: TrustStatus;
}
/** Build a value-free diagnostic report suitable for protocol/UI/log export. */
export declare function diagnoseSettings(options: DiagnoseSettingsOptions): Promise<SettingsDiagnostics>;
//# sourceMappingURL=diagnostics.d.ts.map