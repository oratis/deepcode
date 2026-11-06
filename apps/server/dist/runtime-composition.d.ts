import type { Effort, Mode, Provider } from '@deepcode/core';
import { type DeepCodeSettings, type FileContract, type PermissionRules, type SandboxConfig } from '@deepcode/core/config';
import { HookDispatcher } from '@deepcode/core/hooks';
import { closeAllMcpServers, connectAllMcpServers, expandMcpResourceRefs } from '@deepcode/core/mcp';
import { collectPluginContributions, wirePlugins, type PluginCapabilityBridge } from '@deepcode/core/plugins';
import { ToolRegistry } from '@deepcode/core/tools';
export declare const DEFAULT_APP_SERVER_SYSTEM_PROMPT: string;
export interface RuntimeCompositionDiagnostic {
    source: 'mcp' | 'plugin' | 'config';
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
export declare function resolveComposedMode(requested: Mode, modeExplicit: boolean, settings: DeepCodeSettings): Mode;
/** Compose trusted filesystem context and turn-scoped external resources. */
export declare function composeRuntime(options: RuntimeCompositionOptions): Promise<RuntimeComposition>;
interface PluginBridgeOptions {
    cwd: string;
    mode: Mode;
    permissions?: PermissionRules;
    /** Path-axis rules — a plugin subprocess must not be a way around them. */
    contract?: FileContract;
    hooks: HookDispatcher;
    provider?: Provider;
    autoMode?: DeepCodeSettings['autoMode'];
    sandboxConfig?: SandboxConfig;
    requestApproval?: RuntimeCompositionOptions['requestApproval'];
    signal?: AbortSignal;
}
/** Route plugin subprocess capabilities through the same policy and hook gates as agent tools. */
export declare function buildPluginCapabilityBridge(options: PluginBridgeOptions): PluginCapabilityBridge;
export {};
//# sourceMappingURL=runtime-composition.d.ts.map