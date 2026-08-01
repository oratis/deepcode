import { CredentialsStore, resolveCredentials } from '@deepcode/core/credentials';
import { DirectoryTrustStore, gateUntrustedSettings, loadSettings } from '@deepcode/core/config';
import { DeepSeekProvider } from '@deepcode/core/dist/providers/deepseek.js';
import { RuntimeHost, SAFE_READONLY_TOOLS } from '@deepcode/core/runtime';
import { SessionManager } from '@deepcode/core/sessions';
import { BUILTIN_TOOLS, ToolRegistry } from '@deepcode/core/tools';

import { RuntimeHostExecutor } from './runtime-executor.js';

export function createDefaultTurnExecutor(
  home?: string,
  options: { forceFileCredentials?: boolean } = {},
): RuntimeHostExecutor {
  const trustStore = new DirectoryTrustStore({ directory: home });
  const sessionManager = new SessionManager({
    root: home ? `${home}/sessions` : undefined,
  });
  return new RuntimeHostExecutor({
    createHost: async (cwd, mode) => {
      const loaded = await loadSettings({ cwd, directory: home });
      const trustStatus = await trustStore.statusFor(cwd);
      const { settings } = gateUntrustedSettings(loaded, trustStatus);
      const credentials = await resolveCredentials({
        store: new CredentialsStore({
          directory: home,
          forceFile: options.forceFileCredentials,
        }),
        apiKeyHelper: settings.apiKeyHelper,
      });
      if (!credentials.apiKey && !credentials.authToken) {
        throw new Error(
          'No DeepSeek credentials. Run `deepcode` once to onboard, or set DEEPSEEK_API_KEY.',
        );
      }
      return new RuntimeHost({
        provider: new DeepSeekProvider({
          apiKey: credentials.apiKey ?? '',
          authToken: credentials.authToken,
          baseURL: credentials.baseURL ?? settings.baseURL,
        }),
        tools: new ToolRegistry(BUILTIN_TOOLS),
        cwd,
        mode,
        permissions: settings.permissions ?? { allow: [...SAFE_READONLY_TOOLS] },
        autoMode: settings.autoMode,
        sandboxConfig: settings.sandbox,
      });
    },
    sessionManager,
  });
}
