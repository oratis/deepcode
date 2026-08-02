import type { ConfigDiagnosticsResult } from '@deepcode/protocol';

export function formatConfigDiagnostics(report: ConfigDiagnosticsResult): string[] {
  const lines = [`DeepCode configuration · ${report.cwd}`, `Trust: ${report.trustStatus}`, ''];
  lines.push('Layers:');
  for (const layer of report.layers) {
    const state = layer.present ? (layer.trusted ? 'active' : 'untrusted') : 'missing';
    lines.push(`  ${layer.layer.padEnd(8)} ${state.padEnd(9)} ${layer.path}`);
  }
  lines.push('', `Gated fields: ${report.gated.length ? report.gated.join(', ') : 'none'}`);
  lines.push(`Issues: ${report.issues.length}`);
  for (const issue of report.issues) {
    lines.push(`  ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
  }
  return lines;
}
