import type { CredentialsStore, DeepCodeSettings, McpClientHandle, Provider, SessionManager, StoredMessage, ShellRegistry, TaskManager, VoiceStatus } from '@deepcode/core';
import { type Credentials } from '@deepcode/core';
/** PR comments payload from `gh pr view --json`. */
interface PrCommentsData {
    number: number;
    title: string;
    comments?: Array<{
        author?: {
            login?: string;
        };
        body?: string;
        createdAt?: string;
    }>;
}
/** Render the `gh pr view` comments JSON into display lines (pure — unit-tested). */
export declare function formatPrComments(data: PrCommentsData): string[];
export interface SessionContext {
    cwd: string;
    model: string;
    mode: string;
    effort: string;
    settings: DeepCodeSettings;
    creds: Credentials;
    /** Credentials store (REPL-injected) — backs /login and /logout. */
    credsStore?: CredentialsStore;
    /** User settings.json path (REPL-injected, honors --home) — backs /config set. */
    userSettingsPath?: string;
    /** Home dir override (REPL-injected from --home) — backs default-path lookups
     *  like /voice's `~/.deepcode/models/...` model probe. Defaults to os.homedir(). */
    home?: string;
    /**
     * Interactive voice capture, wired by the REPL (it owns readline + the mic):
     * record → press Enter to stop → transcribe → return the text + display lines.
     * `transcript` is null on cancel / not-ready / error. Absent in headless mode.
     */
    voiceCapture?: () => Promise<{
        transcript: string | null;
        lines: string[];
    }>;
    /** Set by /voice — the REPL pre-fills the next input line with this text. */
    prefillInput?: string;
    sessionId: string;
    sessions: SessionManager;
    usage: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        cacheReadTokens: number;
    };
    /** Set true to terminate the REPL after this command. */
    exitRequested?: boolean;
    /** Replace history entirely (used by /clear, /resume). */
    clearHistory?: boolean;
    /** Connected MCP server handles (M3c). */
    mcpServers?: McpClientHandle[];
    /** MCP servers that failed to connect on startup (M3c). */
    mcpErrors?: Array<{
        serverName: string;
        error: string;
    }>;
    /** Plugins that successfully wired up (M5.2). */
    wiredPlugins?: Array<{
        name: string;
        version: string;
        contributedHookEvents: string[];
    }>;
    /** Plugin discover/wire warnings (hash drift, spawn failure). */
    pluginWarnings?: string[];
    /**
     * Optional initFlow callback — wired by REPL bootstrap so the /init slash
     * command can drive a multi-phase interactive flow (explore → propose →
     * approve → write). Returns the path written, or null if user cancelled.
     */
    initFlow?: () => Promise<string | null>;
    /** Current conversation history — REPL refreshes this before each command call. */
    history?: StoredMessage[];
    /** Provider for commands that need to call the LLM (e.g. /rewind summarize). */
    provider?: Provider;
    /** Set by /rewind to request history replacement. REPL applies after run. */
    newHistory?: StoredMessage[];
    /** Session-scoped background-task manager (REPL-injected) — backs /tasks and
     *  /background. Same instance the agent loop uses, so tasks the agent starts
     *  are visible here and vice-versa. */
    tasks?: TaskManager;
    /** Session-scoped persistent shells (REPL-injected) — backs /shells. Same
     *  instance the agent loop uses, so a shell the agent opened is listed here
     *  and closing one here really closes it. */
    shells?: ShellRegistry;
}
export interface SlashCommand {
    name: string;
    aliases?: string[];
    description: string;
    /** Returns the lines to print after the command runs (or empty array). */
    run(args: string[], ctx: SessionContext): Promise<string[]> | string[];
}
export declare const HelpCommand: SlashCommand;
export declare const ClearCommand: SlashCommand;
export declare const ExitCommand: SlashCommand;
export declare const StatusCommand: SlashCommand;
export declare const ModelCommand: SlashCommand;
export declare const ModeCommand: SlashCommand;
export declare const EffortCommand: SlashCommand;
export declare const CostCommand: SlashCommand;
export declare const ContextCommand: SlashCommand;
export declare const ConfigCommand: SlashCommand;
export declare const AddDirCommand: SlashCommand;
export declare const ResumeCommand: SlashCommand;
export declare const InitCommand: SlashCommand;
export declare const McpCommand: SlashCommand;
export declare const TodosCommand: SlashCommand;
export declare const KeybindingsCommand: SlashCommand;
export declare const VimCommand: SlashCommand;
export declare const PluginsCommand: SlashCommand;
export declare const RewindCommand: SlashCommand;
export declare const HooksCommand: SlashCommand;
export declare const PermissionsCommand: SlashCommand;
export declare const AgentsCommand: SlashCommand;
export declare const SkillsCommand: SlashCommand;
export declare const ExportCommand: SlashCommand;
export declare const CompactCommand: SlashCommand;
export declare const DiffCommand: SlashCommand;
export declare const ReleaseNotesCommand: SlashCommand;
export declare const BugCommand: SlashCommand;
export declare const RecapCommand: SlashCommand;
export declare const LoginCommand: SlashCommand;
export declare const LogoutCommand: SlashCommand;
export declare const PrCommentsCommand: SlashCommand;
export declare const UpgradeCommand: SlashCommand;
export declare const PrivacySettingsCommand: SlashCommand;
export declare const BtwCommand: SlashCommand;
export declare const TasksCommand: SlashCommand;
export declare const ShellsCommand: SlashCommand;
/** "Ready" status lines for /voice (non-interactive / headless fallback). */
export declare function voiceReadyLines(status: VoiceStatus): string[];
/** Setup/troubleshooting instructions for /voice, driven by a detection result. */
export declare function voiceSetupLines(status: VoiceStatus): string[];
export declare const VoiceCommand: SlashCommand;
export declare const BackgroundCommand: SlashCommand;
/**
 * `/combo [name]` — distil the current thread into a SKILL.md draft.
 *
 * Two properties this deliberately keeps:
 *
 *   - `allowed-tools` comes from what the thread actually called, not from a
 *     guess. Hand-written skills are almost always broader than needed.
 *   - Nothing is written without the user seeing the draft first, and a second
 *     `/combo <name> --write` is what commits it. `/combo` alone previews.
 */
export declare const ComboCommand: SlashCommand;
export declare const BUILTIN_COMMANDS: SlashCommand[];
export declare class CommandRegistry {
    private readonly byName;
    constructor(initial?: SlashCommand[]);
    register(cmd: SlashCommand): void;
    list(): SlashCommand[];
    match(line: string): {
        cmd: SlashCommand;
        args: string[];
    } | null;
}
export {};
//# sourceMappingURL=commands.d.ts.map