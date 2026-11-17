/** Parse editable settings without accepting arrays or scalar JSON as a file. */
export function parseSettingsJson(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Top-level settings must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
