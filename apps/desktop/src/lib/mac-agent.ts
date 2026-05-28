// Mac agent driver — runs @deepcode/core's `runAgent` in the renderer.
// Owns the per-conversation state: history, provider, in-flight turns.
//
// The Tauri webview can run runAgent directly because:
//   1. The agent loop itself is IO-agnostic (just calls tool.execute)
//   2. We swap in MAC_TOOLS that route fs/bash through Tauri commands
//   3. DeepSeek's `openai` SDK supports browser environments
//
// Events from the agent flow into a callback the UI subscribes to.

// Import from specific submodules — NOT from @deepcode/core's index — to
// avoid pulling BUILTIN_TOOLS / SessionManager / etc. at module-load time.
// The renderer can't link against node:fs / node:child_process.
import { runAgent } from '@deepcode/core/dist/agent.js';
import { DeepSeekProvider } from '@deepcode/core/dist/providers/deepseek.js';
import type {
  AgentEvent,
  Mode,
  ToolHandler,
} from '@deepcode/core/dist/types.js';
import { MAC_TOOLS } from './mac-tools.js';
import { readCredentials } from './tauri-api.js';

// Local minimal ToolRegistry — same shape as @deepcode/core's, without
// the BUILTIN_TOOLS top-level import that drags in fs.
class LocalToolRegistry {
  private readonly tools = new Map<string, ToolHandler>();
  constructor(initial: ToolHandler[]) {
    for (const t of initial) this.tools.set(t.name, t);
  }
  register(t: ToolHandler): void {
    this.tools.set(t.name, t);
  }
  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }
  list(): ToolHandler[] {
    return [...this.tools.values()];
  }
  definitions() {
    return this.list().map((t) => t.definition);
  }
}

const SYSTEM_PROMPT = `You are DeepCode, an AI coding assistant powered by DeepSeek. \
Help the user with their codebase using the available tools (Read, Write, Edit, Bash, Grep, Glob). \
Be concise and accurate. When you modify files, briefly explain what you changed and why.`;

/** A single in-flight turn. */
interface ActiveTurn {
  turnId: string;
  abortController: AbortController;
}

const turns = new Map<string, ActiveTurn>();
let history: import('@deepcode/core/dist/types.js').StoredMessage[] = [];
let provider: DeepSeekProvider | null = null;

async function ensureProvider(): Promise<DeepSeekProvider> {
  if (provider) return provider;
  const creds = await readCredentials();
  if (!creds.apiKey && !creds.authToken) {
    throw new Error(
      'No DeepSeek credentials. Set your API key in onboarding or via ~/.deepcode/credentials.json.',
    );
  }
  provider = new DeepSeekProvider({
    apiKey: creds.apiKey ?? '',
    authToken: creds.authToken,
    baseURL: creds.baseURL,
  });
  return provider;
}

export interface StartTurnArgs {
  userMessage: string;
  model?: string;
  mode?: Mode;
  onEvent: (e: AgentEvent) => void;
  onDone: (reason: 'end_turn' | 'max_turns' | 'aborted' | 'error') => void;
  /** Called when the agent needs user approval for a tool call. Resolves to allow/deny. */
  onApproval?: (toolName: string, reason: string) => Promise<boolean>;
}

export interface StartTurnResult {
  turnId: string;
}

export async function startAgentTurn(args: StartTurnArgs): Promise<StartTurnResult> {
  const turnId = `mac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const abort = new AbortController();
  turns.set(turnId, { turnId, abortController: abort });

  const prov = await ensureProvider();
  // Cast: nominal-typing on the private `tools` field makes TS reject the
  // structural match. Runtime shape is identical.
  const tools = new LocalToolRegistry(MAC_TOOLS) as unknown as Parameters<
    typeof runAgent
  >[0]['tools'];

  // Run the agent loop in the background. Errors are surfaced via onEvent.
  (async () => {
    try {
      const result = await runAgent({
        provider: prov,
        tools,
        systemPrompt: SYSTEM_PROMPT,
        userMessage: args.userMessage,
        history,
        model: args.model ?? 'deepseek-chat',
        cwd: '/', // Renderer doesn't know real cwd; tools accept absolute paths
        signal: abort.signal,
        mode: args.mode,
        // Disable system reminders in the renderer — they require node:fs
        // (reads todos.json + stats files). The Mac UI surfaces those
        // contextually elsewhere.
        systemReminders: false,
        approval: args.onApproval
          ? async (toolName, _input, verdict) => {
              const reason = verdict.reason ?? `Approve ${toolName}?`;
              return await args.onApproval!(toolName, reason);
            }
          : undefined,
        onEvent: args.onEvent,
        // No hook dispatcher, no sessions persistence, no autoCompact in v1 Mac MVP.
      });
      history = result.history;
      args.onDone(result.stopReason);
    } catch (err) {
      args.onEvent({ type: 'error', error: (err as Error).message ?? String(err) });
      args.onDone('error');
    } finally {
      turns.delete(turnId);
    }
  })();

  return { turnId };
}

export function abortAgentTurn(turnId: string): boolean {
  const t = turns.get(turnId);
  if (!t) return false;
  t.abortController.abort();
  return true;
}

export function clearHistory(): void {
  history = [];
}

export function getHistoryLength(): number {
  return history.length;
}
