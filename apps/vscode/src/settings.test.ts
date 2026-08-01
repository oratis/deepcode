import { describe, expect, it } from 'vitest';

import { explicitConfigValue } from './settings.js';

describe('explicitConfigValue', () => {
  it('ignores extension manifest defaults', () => {
    expect(explicitConfigValue(undefined)).toBeUndefined();
    expect(explicitConfigValue({})).toBeUndefined();
  });

  it('prefers the narrowest explicit language and resource scopes', () => {
    expect(
      explicitConfigValue({
        globalValue: 'global',
        workspaceValue: 'workspace',
        workspaceFolderValue: 'folder',
        globalLanguageValue: 'language-global',
        workspaceLanguageValue: 'language-workspace',
        workspaceFolderLanguageValue: 'language-folder',
      }),
    ).toBe('language-folder');
    expect(
      explicitConfigValue({
        globalValue: 'global',
        workspaceValue: 'workspace',
        workspaceFolderValue: 'folder',
      }),
    ).toBe('folder');
  });
});
