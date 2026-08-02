import { CredentialsStore, resolveCredentials } from '@deepcode/core/credentials';
import {
  DirectoryTrustStore,
  gateUntrustedSettings,
  HookTrustStore,
  loadSettings,
} from '@deepcode/core/config';
import { DeepSeekProvider } from '@deepcode/core/dist/providers/deepseek.js';
import { RuntimeHost, SAFE_READONLY_TOOLS } from '@deepcode/core/runtime';
import { SessionManager } from '@deepcode/core/sessions';

import { RuntimeHostExecutor } from './runtime-executor.js';
import { composeRuntime, resolveComposedMode } from './runtime-composition.js';

export function createDefaultTurnExecutor(
  home?: string,
  options: { forceFileCredentials?: boolean } = {},
): RuntimeHostExecutor {
  const trustStore = new DirectoryTrustStore({ directory: home });
  const hookTrustStore = new HookTrustStore({ directory: home });
  const sessionManager = new SessionManager({
    root: home ? `${home}/sessions` : undefined,
  });
  return new RuntimeHostExecutor({
    createHost: async (cwd, mode, context) => {
      const loaded = await loadSettings({ cwd, directory: home });
      const trustStatus = await trustStore.statusFor(cwd);
      const gate = gateUntrustedSettings(loaded, trustStatus);
      const hookReview = await hookTrustStore.review(cwd, loaded, gate.settings.hooks);
      const settings = { ...gate.settings, hooks: hookReview.hooks };
      const effectiveMode = resolveComposedMode(mode, context.modeExplicit, settings);
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
      const provider = new DeepSeekProvider({
        apiKey: credentials.apiKey ?? '',
        authToken: credentials.authToken,
        baseURL: credentials.baseURL ?? settings.baseURL,
      });
      const composition = await composeRuntime({
        cwd,
        directory: home,
        settings,
        mode: effectiveMode,
        provider,
        requestApproval: context.requestApproval,
        signal: context.signal,
        includeReviewRestore: context.reviewAction?.kind === 'revert',
      });
      return {
        host: new RuntimeHost({
          provider,
          tools: composition.tools,
          cwd,
          mode: effectiveMode,
          permissions: settings.permissions ?? { allow: [...SAFE_READONLY_TOOLS] },
          hooks: composition.hooks,
          autoMode: settings.autoMode,
          sandboxConfig: settings.sandbox,
          pluginDirs: composition.pluginDirs,
        }),
        systemPrompt: composition.systemPrompt,
        model: composition.model,
        effort: composition.effort,
        diagnostics: composition.diagnostics,
        prepareUserMessage: composition.prepareUserMessage,
        close: composition.close,
      };
    },
    sessionManager,
  });
}
