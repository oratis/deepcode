import { type ConfigDiagnosticsResult, type DiagnosticExportResult } from '@deepcode/protocol';
export interface DiagnosticExportOptions {
    home: string;
    cwd: string;
    config: ConfigDiagnosticsResult;
    generatedAt?: string;
    logPath?: string;
    maxLogRecords?: number;
}
/** Create a support bundle that contains no raw paths, settings values, prompts, or tool payloads. */
export declare function exportDiagnosticBundle(options: DiagnosticExportOptions): Promise<DiagnosticExportResult>;
//# sourceMappingURL=diagnostic-export.d.ts.map