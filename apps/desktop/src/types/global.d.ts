// Window-attached API exposed by electron/preload.ts via contextBridge.

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

export interface DeepCodeAPI {
  version: () => Promise<string>;
  creds: {
    load: () => Promise<{ hasKey: boolean; baseURL?: string }>;
    save: (args: { apiKey: string; baseURL?: string }) => Promise<boolean>;
  };
  settings: {
    load: () => Promise<Record<string, unknown>>;
  };
  onUpdateDownloaded: (cb: (info: UpdateInfo) => void) => () => void;
}

declare global {
  interface Window {
    deepcode: DeepCodeAPI;
  }
}
export {};
