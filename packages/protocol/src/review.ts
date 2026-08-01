import type { ReviewFindingPayload } from './types.js';

/**
 * Applying a finding is intentionally a new agent turn, never a direct write
 * endpoint, so the normal permission/hook/sandbox/snapshot pipeline remains in force.
 */
export function reviewApplyPrompt(finding: ReviewFindingPayload): string {
  return reviewApplyManyPrompt([finding]);
}

/** Build a turn that can only perform the conflict-safe snapshot restore tool. */
export function reviewRevertPrompt(actionTurnId: string, findingIds: string[]): string {
  if (
    !/^[a-zA-Z0-9._-]{1,200}$/.test(actionTurnId) ||
    !Array.isArray(findingIds) ||
    findingIds.length === 0 ||
    findingIds.length > 20 ||
    findingIds.some((findingId) => !/^[a-zA-Z0-9._-]{1,200}$/.test(findingId))
  ) {
    throw new Error('A valid review action is required');
  }
  return (
    `Revert review action ${actionTurnId}, which applied findings: ${findingIds.join(', ')}.\n\n` +
    `Call RestoreReviewAction exactly once with action_turn_id=${JSON.stringify(actionTurnId)}. ` +
    'Do not use Edit, Write, Bash, or any other mutation tool. If the restore tool reports a ' +
    'conflict or unavailable snapshot, do not work around it; explain that the action could not be safely reverted.'
  );
}

/** Build one canonical, permission-gated turn for a bounded set of findings. */
export function reviewApplyManyPrompt(findings: ReviewFindingPayload[]): string {
  if (!Array.isArray(findings) || findings.length === 0 || findings.length > 20) {
    throw new Error('Between 1 and 20 valid review findings are required');
  }
  const seen = new Set<string>();
  for (const finding of findings) {
    assertReviewFinding(finding);
    if (seen.has(finding.findingId)) throw new Error('Review finding ids must be unique');
    seen.add(finding.findingId);
  }
  const sections = findings.map((finding) => {
    const replacement = finding.replacement
      ? `\nSuggested replacement:\n${finding.replacement}`
      : '';
    return (
      `Review finding ${finding.findingId}: ${finding.title}\n` +
      `Location: ${JSON.stringify(finding.path)}:${finding.startLine}-${finding.endLine}\n` +
      `${finding.body}${replacement}`
    );
  });
  const prompt =
    (findings.length === 1
      ? `Apply review finding ${findings[0]!.findingId}: ${findings[0]!.title}\n` +
        sections[0]!.split('\n').slice(1).join('\n')
      : `Apply these ${findings.length} review findings in one focused pass:\n\n${sections.join('\n\n')}`) +
    (findings.length === 1
      ? '\n\nRe-read the file and verify the finding is still current. Make only the minimal safe change, ' +
        'using the normal editing tools. If the code has changed or the finding is invalid, explain and do not edit.'
      : '\n\nRe-read every file and verify each finding is still current. Make only the minimal safe changes, ' +
        'using the normal editing tools. If code has changed or a finding is invalid, explain and skip it.');
  if (prompt.length > 128 * 1024) throw new Error('Review apply prompt is too large');
  return prompt;
}

export function isReviewFindingPayload(value: unknown): value is ReviewFindingPayload {
  try {
    assertReviewFinding(value);
    return true;
  } catch {
    return false;
  }
}

function assertReviewFinding(finding: unknown): asserts finding is ReviewFindingPayload {
  if (!finding || typeof finding !== 'object') {
    throw new Error('A valid review finding is required');
  }
  const candidate = finding as Partial<ReviewFindingPayload>;
  if (
    typeof candidate.findingId !== 'string' ||
    !/^[a-zA-Z0-9._-]{1,200}$/.test(candidate.findingId) ||
    typeof candidate.title !== 'string' ||
    candidate.title.length === 0 ||
    candidate.title.length > 160 ||
    hasControlCharacter(candidate.title) ||
    typeof candidate.body !== 'string' ||
    candidate.body.length === 0 ||
    candidate.body.length > 4000 ||
    typeof candidate.path !== 'string' ||
    !safeRelativePath(candidate.path) ||
    !Number.isInteger(candidate.startLine) ||
    !Number.isInteger(candidate.endLine) ||
    candidate.startLine! < 1 ||
    candidate.endLine! < candidate.startLine! ||
    candidate.endLine! - candidate.startLine! > 200 ||
    ![0, 1, 2, 3].includes(candidate.priority as number) ||
    (candidate.replacement !== undefined &&
      (typeof candidate.replacement !== 'string' ||
        utf8ByteLength(candidate.replacement) > 32 * 1024))
  ) {
    throw new Error('A valid review finding is required');
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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
