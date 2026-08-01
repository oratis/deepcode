export interface ConfigurationInspection<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
}

/** Return only a value explicitly configured by the user or workspace. */
export function explicitConfigValue<T>(
  inspection: ConfigurationInspection<T> | undefined,
): T | undefined {
  return (
    inspection?.workspaceFolderLanguageValue ??
    inspection?.workspaceLanguageValue ??
    inspection?.globalLanguageValue ??
    inspection?.workspaceFolderValue ??
    inspection?.workspaceValue ??
    inspection?.globalValue
  );
}
