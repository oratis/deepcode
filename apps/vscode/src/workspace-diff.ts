import type { WorkspaceDiffResult } from '@deepcode/protocol';

export function formatWorkspaceDiffForReview(diff: WorkspaceDiffResult): string {
  const lines: string[] = [];
  for (const file of diff.files) {
    const path = file.previousPath
      ? `${JSON.stringify(file.previousPath)} -> ${JSON.stringify(file.path)}`
      : JSON.stringify(file.path);
    lines.push(`diff -- ${file.status} ${path}`);
    if (file.binary) {
      lines.push('[binary content omitted]');
      continue;
    }
    for (const hunk of file.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
      for (const line of hunk.lines) {
        const marker = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' ';
        lines.push(`${marker}${line.text}`);
      }
    }
    if (file.truncated) lines.push('[file diff truncated]');
  }
  if (diff.truncated) lines.push('[workspace diff truncated]');
  return lines.join('\n');
}
