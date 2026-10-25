import { configuredEngine } from './engines/claude-sdk.js';
import { CredentialsStore } from '@deepcode/core/credentials';
import {
  DirectoryTrustStore,
  gateUntrustedSettings,
  HookTrustStore,
  loadSettings,
} from '@deepcode/core/config';
import { ConfiguredProvider, defaultModel } from '@deepcode/core';
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
      const provider = new ConfiguredProvider({
        settings,
        store: new CredentialsStore({ directory: home, forceFile: options.forceFileCredentials }),
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
          engine: configuredEngine(
            settings,
            new CredentialsStore({ directory: home, forceFile: options.forceFileCredentials }),
          ),
          provider,
          tools: composition.tools,
          cwd,
          mode: effectiveMode,
          permissions: settings.permissions ?? { allow: [...SAFE_READONLY_TOOLS] },
          hooks: composition.hooks,
          autoMode: settings.autoMode,
          sandboxConfig: withAdditionalWritableDirs(
            settings.sandbox,
            settings.permissions?.additionalDirectories,
            cwd,
          ),
          pluginDirs: composition.pluginDirs,
        }),
        systemPrompt: composition.systemPrompt,
        model: defaultModel(settings),
        effort: composition.effort,
        parameters: (model, effort) => provider.parameters(model, effort),
        diagnostics: composition.diagnostics,
        prepareUserMessage: composition.prepareUserMessage,
        close: composition.close,
      };
    },
    sessionManager,
  });
}
import { withAdditionalWritableDirs } from '@deepcode/core';
