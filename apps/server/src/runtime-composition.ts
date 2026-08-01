import type { Effort, Mode, Provider } from '@deepcode/core';
import type {
  DeepCodeSettings,
  McpServerConfig,
  PermissionRules,
  SandboxConfig,
} from '@deepcode/core/config';
import { dispatchToolCall } from '@deepcode/core/harness';
import { HookDispatcher } from '@deepcode/core/hooks';
import { loadMemory } from '@deepcode/core/memory';
import {
  closeAllMcpServers,
  connectAllMcpServers,
  expandMcpResourceRefs,
  type McpClientHandle,
} from '@deepcode/core/mcp';
import { applyStyle, findStyle, loadOutputStyles } from '@deepcode/core/output-styles';
import {
  collectPluginContributions,
  wirePlugins,
  type PluginCapabilityBridge,
  type WireResult,
} from '@deepcode/core/plugins';
import { buildSkillsDescriptionBlock, loadSkills, makeSkillTool } from '@deepcode/core/skills';
import {
  BashTool,
  BUILTIN_TOOLS,
  installToolSearch,
  ReadTool,
  RestoreReviewActionTool,
  ToolRegistry,
  WebFetchTool,
  WriteTool,
  type ToolHandler,
  type ToolResult,
} from '@deepcode/core/tools';

export const DEFAULT_APP_SERVER_SYSTEM_PROMPT =
  'You are DeepCode, an AI coding assistant powered by DeepSeek. Help the user with their ' +
  'codebase using the available tools. Be concise and accurate. When you modify files, briefly ' +
  'explain what you changed and why. For code review, call SubmitReviewFinding once for each ' +
  'actionable issue, using a precise workspace-relative path and line range.';

export interface RuntimeCompositionDiagnostic {
  source: 'mcp' | 'plugin';
  code: string;
  severity: 'warning' | 'error';
  message: string;
}

export interface RuntimePreparedMessage {
  text: string;
  diagnostics: RuntimeCompositionDiagnostic[];
}

export interface RuntimeCompositionServices {
  collectPluginContributions: typeof collectPluginContributions;
  connectAllMcpServers: typeof connectAllMcpServers;
  closeAllMcpServers: typeof closeAllMcpServers;
  expandMcpResourceRefs: typeof expandMcpResourceRefs;
  wirePlugins: typeof wirePlugins;
}

const DEFAULT_SERVICES: RuntimeCompositionServices = {
  collectPluginContributions,
  connectAllMcpServers,
  closeAllMcpServers,
  expandMcpResourceRefs,
  wirePlugins,
};

export interface RuntimeCompositionOptions {
  cwd: string;
  directory?: string;
  settings: DeepCodeSettings;
  mode?: Mode;
  provider?: Provider;
  requestApproval?: (toolName: string, reason: string) => Promise<'allow' | 'deny' | 'always'>;
  signal?: AbortSignal;
  services?: Partial<RuntimeCompositionServices>;
  includeReviewRestore?: boolean;
}

export interface RuntimeComposition {
  tools: ToolRegistry;
  hooks: HookDispatcher;
  systemPrompt: string;
  model: string;
  effort: Effort;
  pluginDirs: string[];
  diagnostics: RuntimeCompositionDiagnostic[];
  prepareUserMessage: (text: string) => Promise<RuntimePreparedMessage>;
  close: () => Promise<void>;
}

export function resolveComposedMode(
  requested: Mode,
  modeExplicit: boolean,
  settings: DeepCodeSettings,
): Mode {
  return modeExplicit ? requested : (settings.permissions?.defaultMode ?? requested);
}

/** Compose trusted filesystem context and turn-scoped external resources. */
export async function composeRuntime(
  options: RuntimeCompositionOptions,
): Promise<RuntimeComposition> {
  const { cwd, directory, settings } = options;
  const services = { ...DEFAULT_SERVICES, ...options.services };
  const diagnostics: RuntimeCompositionDiagnostic[] = [];
  const pluginsEnabled = settings.plugins?.globalEnabled !== false;
  let pluginDiscoverySucceeded = true;
  let pluginDirs: string[] = [];
  let pluginMcpServers: Record<string, McpServerConfig> = {};

  if (pluginsEnabled) {
    try {
      const contribution = await services.collectPluginContributions({
        directory,
        disabled: settings.disabledPlugins,
      });
      pluginDirs = contribution.dirs;
      pluginMcpServers = contribution.mcpServers;
    } catch (error) {
      pluginDiscoverySucceeded = false;
      diagnostics.push({
        source: 'plugin',
        code: 'plugin_discovery_failed',
        severity: 'error',
        message: `Plugin discovery failed: ${(error as Error).message}`,
      });
    }
  }

  const [memory, skills, styles] = await Promise.all([
    loadMemory({
      cwd,
      directory,
      maxBytes: (settings.memoryLoadCapKB ?? 100) * 1024,
    }),
    loadSkills({
      cwd,
      directory,
      pluginDirs,
      overrides: settings.skillOverrides,
    }),
    loadOutputStyles({ cwd, directory }),
  ]);

  const tools = new ToolRegistry(BUILTIN_TOOLS);
  if (options.includeReviewRestore) tools.register(RestoreReviewActionTool);
  if (skills.length > 0) tools.register(makeSkillTool(skills));
  const hooks = new HookDispatcher({
    hooks: settings.hooks,
    disableAllHooks: settings.disableAllHooks,
    allowedHttpHookUrls: settings.allowedHttpHookUrls,
  });

  const allMcpServers = { ...pluginMcpServers, ...(settings.mcpServers ?? {}) };
  let mcpServers: McpClientHandle[] = [];
  if (Object.keys(allMcpServers).length > 0) {
    try {
      const connected = await services.connectAllMcpServers(allMcpServers, {
        enabledOnly: settings.enabledMcpjsonServers,
        disabled: settings.disabledMcpjsonServers ?? [],
        directory,
      });
      mcpServers = connected.handles;
      for (const error of connected.errors) {
        diagnostics.push({
          source: 'mcp',
          code: 'mcp_connect_failed',
          severity: 'warning',
          message: `MCP server "${error.serverName}" failed: ${error.error}`,
        });
      }
      const deferred = [];
      for (const handle of mcpServers) {
        const defer = allMcpServers[handle.serverName]?.alwaysLoad === false;
        for (const tool of handle.tools) {
          if (defer) {
            deferred.push({
              name: tool.name,
              description: tool.definition.description,
              expand: () => tool,
            });
          } else {
            tools.register(tool);
          }
        }
      }
      installToolSearch(tools, deferred);
    } catch (error) {
      diagnostics.push({
        source: 'mcp',
        code: 'mcp_composition_failed',
        severity: 'error',
        message: `MCP composition failed: ${(error as Error).message}`,
      });
    }
  }

  let pluginsWire: WireResult | null = null;
  if (pluginsEnabled && pluginDiscoverySucceeded) {
    try {
      pluginsWire = await services.wirePlugins({
        directory,
        disabled: settings.disabledPlugins,
        hooks,
        capabilities: buildPluginCapabilityBridge({
          cwd,
          mode: options.mode ?? 'default',
          permissions: settings.permissions,
          hooks,
          provider: options.provider,
          autoMode: settings.autoMode,
          sandboxConfig: settings.sandbox,
          requestApproval: options.requestApproval,
          signal: options.signal,
        }),
        sandbox: settings.sandbox,
        log: () => undefined,
      });
      for (const plugin of pluginsWire.plugins) {
        for (const tool of plugin.contributedTools) {
          if (!tools.get(tool.name)) tools.register(tool);
        }
      }
      for (const mismatch of pluginsWire.hashMismatches) {
        diagnostics.push({
          source: 'plugin',
          code: 'plugin_hash_mismatch',
          severity: 'warning',
          message: mismatch,
        });
      }
      for (const name of pluginsWire.spawnFailures) {
        diagnostics.push({
          source: 'plugin',
          code: 'plugin_start_failed',
          severity: 'warning',
          message: `Plugin "${name}" failed to start`,
        });
      }
    } catch (error) {
      diagnostics.push({
        source: 'plugin',
        code: 'plugin_wire_failed',
        severity: 'error',
        message: `Plugin wire-up failed: ${(error as Error).message}`,
      });
    }
  }

  let systemPrompt = DEFAULT_APP_SERVER_SYSTEM_PROMPT;
  if (memory.text) systemPrompt += `\n\n${memory.text}`;
  const skillsBlock = buildSkillsDescriptionBlock(skills);
  if (skillsBlock) systemPrompt += `\n\n${skillsBlock}`;
  systemPrompt = applyStyle(systemPrompt, findStyle(styles, settings.outputStyle ?? 'default'));

  let closed = false;
  return {
    tools,
    hooks,
    systemPrompt,
    model: settings.model ?? 'deepseek-chat',
    effort: settings.effortLevel ?? 'medium',
    pluginDirs,
    diagnostics,
    prepareUserMessage: async (text) => {
      if (mcpServers.length === 0) return { text, diagnostics: [] };
      const expanded = await services.expandMcpResourceRefs(text, mcpServers);
      return {
        text: expanded.text,
        diagnostics: expanded.errors.map((error) => ({
          source: 'mcp' as const,
          code: 'mcp_resource_failed',
          severity: 'warning' as const,
          message: `MCP resource @${error.ref.server}:${error.ref.uri} failed: ${error.error}`,
        })),
      };
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([
        pluginsWire?.shutdown() ?? Promise.resolve(),
        services.closeAllMcpServers(mcpServers),
      ]);
    },
  };
}

interface PluginBridgeOptions {
  cwd: string;
  mode: Mode;
  permissions?: PermissionRules;
  hooks: HookDispatcher;
  provider?: Provider;
  autoMode?: DeepCodeSettings['autoMode'];
  sandboxConfig?: SandboxConfig;
  requestApproval?: RuntimeCompositionOptions['requestApproval'];
  signal?: AbortSignal;
}

/** Route plugin subprocess capabilities through the same policy and hook gates as agent tools. */
export function buildPluginCapabilityBridge(options: PluginBridgeOptions): PluginCapabilityBridge {
  const execute = async (
    handler: ToolHandler,
    input: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const verdict = await dispatchToolCall({
      tool: handler.name,
      input,
      mode: options.mode,
      rules: options.permissions,
      hooks: options.hooks,
      cwd: options.cwd,
      autoMode: options.autoMode,
      autoModeProvider: options.provider,
    });
    let allowed = verdict.decision === 'allow';
    if (verdict.decision === 'ask' && options.requestApproval) {
      const decision = await options.requestApproval(
        handler.name,
        `Plugin requested ${handler.name}: ${verdict.reason}`,
      );
      allowed = decision === 'allow' || decision === 'always';
    }
    if (!allowed) throw new Error(`Plugin capability blocked: ${verdict.reason}`);

    const result = await handler.execute(input, {
      cwd: options.cwd,
      signal: options.signal,
      sandboxConfig: options.sandboxConfig,
    });
    await options.hooks.dispatch({
      event: 'PostToolUse',
      cwd: options.cwd,
      triggeredAt: new Date().toISOString(),
      payload: {
        tool: handler.name,
        input,
        result_content: result.content.slice(0, 1000),
        is_error: result.isError ?? false,
        source: 'plugin',
      },
    });
    if (result.isError) throw new Error(result.content);
    return result;
  };

  return {
    fs_read: async (path) => (await execute(ReadTool, { file_path: path })).content,
    fs_write: async (path, content) => {
      await execute(WriteTool, { file_path: path, content });
    },
    bash: async (command) => {
      const result = await execute(BashTool, { command });
      const data = (result.data ?? {}) as { stderr?: string; exitCode?: number };
      return {
        stdout: result.content,
        stderr: data.stderr ?? '',
        exitCode: data.exitCode ?? 0,
      };
    },
    fetch: async (url) => (await execute(WebFetchTool, { url })).content,
  };
}
