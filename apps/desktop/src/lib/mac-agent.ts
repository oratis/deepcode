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
import { DeepSeekProvider, EFFORT_PARAMS } from '@deepcode/core/dist/providers/deepseek.js';
import type { AgentEvent, Effort, Mode, ToolHandler } from '@deepcode/core/dist/types.js';
import { MAC_TOOLS } from './mac-tools.js';
import { setActiveSessionId } from './mac-session.js';
import { readCredentials, sessionAppend, sessionCreate, sessionSetTitle } from './tauri-api.js';

/** First non-empty line of the user message, trimmed to a sidebar-friendly length. */
function sessionTitleFrom(userMessage: string): string {
  const firstLine =
    userMessage
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? userMessage.trim();
  return firstLine.slice(0, 60);
}

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

function buildSystemPrompt(cwd?: string): string {
  return `You are DeepCode, an AI coding assistant powered by DeepSeek.
Help the user with their codebase using the available tools (Read, Write, Edit, Bash, Grep, Glob).
Be concise and accurate. When you modify files, briefly explain what you changed and why.

${cwd ? `Working directory: ${cwd}\nAll relative paths resolve against this directory.` : 'NO project folder has been picked yet. Tell the user to pick one before asking for file edits.'}

Tool input schemas use snake_case field names (e.g. file_path, old_string).
ALWAYS pass absolute paths or paths relative to the working directory above.`;
}

/** A single in-flight turn. */
interface ActiveTurn {
  turnId: string;
  abortController: AbortController;
}

const turns = new Map<string, ActiveTurn>();
let history: import('@deepcode/core/dist/types.js').StoredMessage[] = [];
let provider: DeepSeekProvider | null = null;
// One active session id per app run — created lazily on first turn.
let currentSessionId: string | null = null;

export function clearSession(): void {
  currentSessionId = null;
  setActiveSessionId(null);
  history = [];
}

/**
 * Resume an existing session: adopt its id + loaded history so the next turn
 * continues that conversation (with full context) and appends to its JSONL
 * rather than starting a new file.
 */
export function resumeSession(
  sessionId: string,
  loadedHistory: import('@deepcode/core/dist/types.js').StoredMessage[],
): void {
  currentSessionId = sessionId;
  setActiveSessionId(sessionId);
  history = loadedHistory;
}

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
  /** Effort tier — controls maxTokens + temperature. Default 'high'. */
  effort?: Effort;
  /** Project folder absolute path. Tools resolve relative paths against this.
   *  When undefined, tools error because the agent can't safely guess. */
  cwd?: string;
  onEvent: (e: AgentEvent) => void;
  onDone: (reason: 'end_turn' | 'max_turns' | 'aborted' | 'error') => void;
  /** Called when the agent needs user approval for a tool call. Resolves to:
   *   'allow'  — permit this one call
   *   'deny'   — reject
   *   'always' — permit + persist a permissions.allow matcher
   */
  onApproval?: (toolName: string, reason: string) => Promise<'allow' | 'deny' | 'always'>;
  /** Called when the agent's AskUserQuestion tool needs an answer. Resolves to
   *  the chosen option label (or free text). */
  onAskUser?: (req: {
    question: string;
    options: Array<{ label: string; description: string }>;
    multiSelect?: boolean;
  }) => Promise<string>;
}

export interface StartTurnResult {
  turnId: string;
}

export async function startAgentTurn(args: StartTurnArgs): Promise<StartTurnResult> {
  const turnId = `mac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const abort = new AbortController();
  turns.set(turnId, { turnId, abortController: abort });

  // Lazily create a session JSONL on first turn, so the sidebar can
  // surface it. Failures here are non-fatal — we just don't persist.
  const isNewSession = !currentSessionId;
  if (!currentSessionId) {
    try {
      currentSessionId = await sessionCreate(args.cwd ?? '/');
      // Publish so the tools snapshot under this id and the file panel can read them.
      setActiveSessionId(currentSessionId);
    } catch (err) {
      console.warn('session_create failed (continuing without persistence):', err);
    }
  }
  // Append the user message right away so the file shows non-zero activity.
  if (currentSessionId) {
    try {
      await sessionAppend(currentSessionId, {
        type: 'message',
        role: 'user',
        content: [{ type: 'text', text: args.userMessage }],
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('session_append (user) failed:', err);
    }
    // Title a brand-new session from its first user message (Claude-Code style),
    // so the sidebar shows a human label immediately rather than the raw id.
    if (isNewSession) {
      try {
        await sessionSetTitle(currentSessionId, sessionTitleFrom(args.userMessage));
      } catch (err) {
        console.warn('session_set_title failed:', err);
      }
    }
  }

  const prov = await ensureProvider();
  // Cast: nominal-typing on the private `tools` field makes TS reject the
  // structural match. Runtime shape is identical.
  const tools = new LocalToolRegistry(MAC_TOOLS) as unknown as Parameters<
    typeof runAgent
  >[0]['tools'];

  // Run the agent loop in the background. Errors are surfaced via onEvent.
  (async () => {
    try {
      // Default to 'high' (6k output budget): the desktop's primary use is
      // writing/editing files, and 'medium' (3k) routinely truncates a single
      // multi-file write mid-tool-call. Users can still dial it down per-turn.
      const effortParams = EFFORT_PARAMS[args.effort ?? 'high'];
      const result = await runAgent({
        provider: prov,
        tools,
        systemPrompt: buildSystemPrompt(args.cwd),
        userMessage: args.userMessage,
        history,
        model: args.model ?? 'deepseek-chat',
        maxTokens: effortParams.maxTokens,
        temperature: effortParams.temperature,
        cwd: args.cwd ?? '/',
        signal: abort.signal,
        mode: args.mode,
        // Disable system reminders in the renderer — they require node:fs
        // (reads todos.json + stats files). The Mac UI surfaces those
        // contextually elsewhere.
        systemReminders: false,
        approval: args.onApproval
          ? async (toolName, _input, verdict) => {
              const reason = verdict.reason ?? `Approve ${toolName}?`;
              const decision = await args.onApproval!(toolName, reason);
              if (decision === 'always') return 'always';
              return decision === 'allow';
            }
          : undefined,
        askUser: args.onAskUser ? async (req) => args.onAskUser!(req) : undefined,
        onEvent: args.onEvent,
        // No hook dispatcher, no sessions persistence, no autoCompact in v1 Mac MVP.
      });
      history = result.history;
      // Append the new assistant message(s) for persistence.
      if (currentSessionId && history.length > 0) {
        const newestAssistant = [...history].reverse().find((m) => m.role === 'assistant');
        if (newestAssistant) {
          try {
            await sessionAppend(currentSessionId, {
              type: 'message',
              ...newestAssistant,
            });
          } catch (err) {
            console.warn('session_append (assistant) failed:', err);
          }
        }
      }
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
  currentSessionId = null;
  setActiveSessionId(null);
}

export function getHistoryLength(): number {
  return history.length;
}
