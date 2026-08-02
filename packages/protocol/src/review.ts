import type { ReviewFindingPayload } from './types.js';

/**
 * Applying a finding is intentionally a new agent turn, never a direct write
 * endpoint, so the normal permission/hook/sandbox/snapshot pipeline remains in force.
 */
export function reviewApplyPrompt(finding: ReviewFindingPayload): string {
  if (
    !finding ||
    typeof finding.findingId !== 'string' ||
    !finding.findingId ||
    typeof finding.title !== 'string' ||
    finding.title.length === 0 ||
    finding.title.length > 160 ||
    typeof finding.body !== 'string' ||
    finding.body.length === 0 ||
    finding.body.length > 4000 ||
    typeof finding.path !== 'string' ||
    !safeRelativePath(finding.path) ||
    !Number.isInteger(finding.startLine) ||
    !Number.isInteger(finding.endLine) ||
    finding.startLine < 1 ||
    finding.endLine < finding.startLine ||
    ![0, 1, 2, 3].includes(finding.priority) ||
    (finding.replacement !== undefined &&
      (typeof finding.replacement !== 'string' || finding.replacement.length > 32 * 1024))
  ) {
    throw new Error('A valid review finding is required');
  }
  const replacement = finding.replacement ? `\nSuggested replacement:\n${finding.replacement}` : '';
  return (
    `Apply review finding ${finding.findingId}: ${finding.title}\n` +
    `Location: ${JSON.stringify(finding.path)}:${finding.startLine}-${finding.endLine}\n` +
    `${finding.body}${replacement}\n\n` +
    'Re-read the file and verify the finding is still current. Make only the minimal safe change, ' +
    'using the normal editing tools. If the code has changed or the finding is invalid, explain and do not edit.'
  );
}

function safeRelativePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > 500 ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    hasControlCharacter(path)
  ) {
    return false;
  }
  return !path.split(/[\\/]/).some((part) => part === '..' || part === '');
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
