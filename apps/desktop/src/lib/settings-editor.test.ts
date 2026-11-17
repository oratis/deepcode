import { describe, expect, it } from 'vitest';
import { parseSettingsJson } from './settings-editor.js';

describe('settings editor input boundary', () => {
  it('preserves nested objects and arrays within a settings object', () => {
    const settings = { model: 'deepseek-chat', permissions: { deny: ['Bash'] }, plugins: [] };
    expect(parseSettingsJson(JSON.stringify(settings))).toEqual(settings);
    expect(parseSettingsJson('{}')).toEqual({});
  });

  it.each(['[]', '[{"model":"deepseek-chat"}]', 'null', 'true', '42', '"model"'])(
    'rejects top-level %s before it can be saved',
    (input) => {
      expect(() => parseSettingsJson(input)).toThrow('Top-level settings must be a JSON object.');
    },
  );

  it('rejects malformed JSON', () => {
    expect(() => parseSettingsJson('{"model":')).toThrow();
  });
});
