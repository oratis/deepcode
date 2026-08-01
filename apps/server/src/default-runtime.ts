import { CredentialsStore, resolveCredentials } from '@deepcode/core/credentials';
import { DeepSeekProvider } from '@deepcode/core/dist/providers/deepseek.js';
import { RuntimeHost, SAFE_READONLY_TOOLS } from '@deepcode/core/runtime';
import { BUILTIN_TOOLS, ToolRegistry } from '@deepcode/core/tools';

import { RuntimeHostExecutor } from './runtime-executor.js';

export function createDefaultTurnExecutor(): RuntimeHostExecutor {
  return new RuntimeHostExecutor({
    createHost: async (cwd) => {
      const credentials = await resolveCredentials({ store: new CredentialsStore() });
      if (!credentials.apiKey && !credentials.authToken) {
        throw new Error(
          'No DeepSeek credentials. Run `deepcode` once to onboard, or set DEEPSEEK_API_KEY.',
        );
      }
      return new RuntimeHost({
        provider: new DeepSeekProvider({
          apiKey: credentials.apiKey ?? '',
          authToken: credentials.authToken,
          baseURL: credentials.baseURL,
        }),
        tools: new ToolRegistry(BUILTIN_TOOLS),
        cwd,
        mode: 'default',
        permissions: { allow: [...SAFE_READONLY_TOOLS] },
      });
    },
  });
}
