import { MODEL_CATALOG, modelParameters } from '@deepcode/core/dist/providers/catalog.js';
// Chat presentation over the existing desktop protocol adapter.
// The timeline stays mounted across settings navigation. Tool details are
// disclosed on demand; pending interactions stay above the composer so they
// remain reachable even when the user is reading older messages. A stop request
// only enters Cancelling; the host's terminal event unlocks the conversation.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import {
  DEFAULT_KEYBINDINGS,
  VimState,
  type KeyBinding,
  type VimMode,
} from '@deepcode/core/dist/keybindings/vim.js';
import { contextWindowFor } from '@deepcode/core/dist/providers/model-metadata.js';
import { clearProtocolThread, getWorkspaceDiff } from '../lib/protocol-agent.js';
import { estimateCost } from '@deepcode/core/dist/providers/pricing.js';
import { Dropdown, type DropdownOption } from '../components/Dropdown.js';
import { Pill } from '../components/Pill.js';
import { PlusMenu } from '../components/PlusMenu.js';
import { SlashPalette } from '../components/SlashPalette.js';
import {
  EFFORTS,
  filterCommands,
  formatWorkspaceDiff,
  helpText as slashHelpText,
  parseSlash,
  type AgentMode,
  type Effort,
  type SlashCommand,
} from '../lib/slash-commands.js';
import { MessageContent } from '../components/MessageContent.js';
import { ToolCard } from '../components/ToolCard.js';
import { ToolBody } from '../components/ToolBody.js';
import { presentToolCall, readToolLocations } from '@deepcode/core/dist/tools/presentation.js';
import { projectName } from '../lib/project.js';
import { registerShortcut } from '../lib/keyboard.js';
import { useVoice } from '../lib/use-voice.js';
import { insertTranscript } from '../lib/voice.js';
import {
  appendReasoningDelta,
  appendTextDelta,
  appendToolUse,
  attachToolResult,
  finalizeStreaming,
  lastAssistantIndex,
  pickTarget,
  type Msg,
} from '../lib/repl-stream.js';
import { loadKeybindings, loadSettingsFile, pickFile, saveSettingsFile } from '../lib/tauri-api.js';
import type { InspectorData, TodoItem } from '../types/inspector.js';
import type { ScreenName } from '../types/screens.js';

interface ReplScreenProps {
  projectPath: string;
  /** Route to a settings-family screen — `/settings`, `/mcp`, `/about`, … */
  onNavigate?: (screen: ScreenName) => void;
  /** Called after each turn ends so the parent can refresh the sidebar. */
  onTurnComplete?: () => void;
  /** Called once the backend creates/adopts the canonical thread id. */
  onSessionStarted?: (sessionId: string) => void;
  /** Reset the host selection and all sibling projections together. */
  onNewSession?: () => void;
  /**
   * Pre-seed the chat with a resumed session's reconstructed messages. The
   * parent remounts ReplScreen (via key) when this changes, so it's only read
   * on mount.
   */
  initialMessages?: Msg[];
  /**
   * Lift inspector-relevant state to the parent (App), which owns the
   * right-hand inspector panel. Called with a full snapshot whenever usage,
   * model, mode, recent files, or the todo list change.
   */
  onInspector?: (patch: Partial<InspectorData>) => void;
  /** Open a file (from a tool card's "preview" affordance) in the file panel. */
  onOpenFile?: (path: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

/** Tools whose file_path we surface in the inspector's Recent files section. */
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const MAX_RECENT_FILES = 8;

// ─── Types ────────────────────────────────────────────────────────────

// Effort / AgentMode and their value lists live with the slash commands that
// validate them, so the palette and the dropdowns can't drift apart.

function effortOptions(model: string): DropdownOption<Effort>[] {
  return (['low', 'medium', 'high', 'xhigh', 'max'] as Effort[]).map((value) => {
    const { maxTokens } = modelParameters(model, value);
    return {
      value,
      label: value === 'xhigh' ? 'Extra High' : value[0]!.toUpperCase() + value.slice(1),
      meta: `${(maxTokens / 1000).toFixed(1)}k`,
      description: `Preset output budget: ${maxTokens} tokens. Custom profiles may override it.`,
    };
  });
}

const MODEL_OPTIONS: DropdownOption<string>[] = MODEL_CATALOG.map((model) => ({
  value: model.id,
  label: model.id,
  meta: `${Math.round(model.contextWindow / 1000)}k`,
  description: `${model.provider} · ${model.reasoning ? 'Reasoning' : 'General'}`,
}));

const MODE_OPTIONS: DropdownOption<AgentMode>[] = [
  {
    value: 'default',
    label: 'Default',
    meta: '●',
    description: 'Ask before every tool call that needs approval.',
  },
  {
    value: 'acceptEdits',
    label: 'Accept edits',
    meta: '✎',
    description: 'Auto-approve Edit/Write; still ask for Bash and dangerous tools.',
  },
  {
    value: 'plan',
    label: 'Plan mode',
    meta: '◐',
    description: 'Read-only — write tools blocked. Use for exploring.',
  },
  {
    value: 'auto',
    label: 'Auto',
    meta: '◈',
    description: 'Classify each tool call and apply the configured automatic policy.',
  },
  {
    value: 'dontAsk',
    label: "Don't ask",
    meta: '↯',
    description: 'Deny calls that require approval. Existing allow rules still apply.',
  },
  {
    value: 'bypassPermissions',
    label: 'Bypass',
    meta: '⚡',
    description: 'Skip approval prompts. Sandbox, file contract and hook restrictions still apply.',
  },
];

interface AgentEvt {
  kind: 'event' | 'turn_done';
  turnId: string;
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  result?: { content: string; isError?: boolean; data?: Record<string, unknown> };
  error?: string;
  stopReason?: string;
  // usage event — emitted per provider round-trip with that turn's token counts
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  // permission_request fields
  requestId?: string;
  toolName?: string;
  reason?: string;
  // ask_user fields (AskUserQuestion tool)
  question?: string;
  options?: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
  // tool_use carries id; we use it on tool_result to attach output to the right card
  id?: string;
}

interface PendingApproval {
  requestId: string;
  toolName: string;
  reason: string;
}

interface PendingQuestion {
  requestId: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────

export function ReplScreen({
  projectPath,
  onNavigate,
  onTurnComplete,
  onSessionStarted,
  onNewSession,
  initialMessages,
  onInspector,
  onOpenFile,
  onBusyChange,
}: ReplScreenProps): JSX.Element {
  const [messages, setMessages] = useState<Msg[]>(() =>
    initialMessages && initialMessages.length > 0
      ? [
          {
            role: 'system',
            text: 'Resumed session — earlier conversation loaded below.',
          },
          ...initialMessages,
        ]
      : [],
  );
  const [input, setInput] = useState('');
  // Slash palette: derived list + which row the arrow keys are on.
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [outcome, setOutcome] = useState('Ready');
  const [interactionBusy, setInteractionBusy] = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const [questionChoices, setQuestionChoices] = useState<string[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  // 'high' (6k output) by default — 'medium' (3k) truncates multi-file writes.
  // Overridden by a persisted effortLevel in settings on mount.
  const [effort, setEffort] = useState<Effort>('high');
  const [model, setModel] = useState<string>('deepseek-chat');
  // The agent.onEvent subscription below is created once on mount, so it would
  // close over a stale `model`. A ref keeps the per-turn cost calc on the
  // current model (deepseek-reasoner output is ¥16/M vs chat's ¥2/M).
  const modelRef = useRef(model);
  modelRef.current = model;
  const [mode, setMode] = useState<AgentMode>('default');
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number }>({
    inputTokens: 0,
    outputTokens: 0,
  });
  // Cumulative spend across all turns this conversation (¥). Tracked separately
  // from `usage` because the context bar wants the latest snapshot while cost
  // must sum every billed turn.
  const [costYuan, setCostYuan] = useState<number | null>(0);
  // Inspector-only state — files touched (Write/Edit) + the agent's todo list.
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [vimEnabled, setVimEnabled] = useState(false);
  const [vimMode, setVimMode] = useState<VimMode>('INSERT');
  const vimStateRef = useRef<VimState | null>(null);
  const bindingsRef = useRef<KeyBinding[]>(DEFAULT_KEYBINDINGS);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followOutput = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const activeTurnRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const cancellingRef = useRef(false);
  const interactionRef = useRef<string | null>(null);
  const respondingToRef = useRef<string | null>(null);

  // The host must lock navigation before the next render or an awaited RPC.
  const changeBusy = useCallback(
    (value: boolean) => {
      busyRef.current = value;
      setBusy(value);
      onBusyChange?.(value);
    },
    [onBusyChange],
  );

  // ── Voice input (🎙) — record + transcribe locally, splice into the composer ──
  const handleTranscript = useCallback((text: string) => {
    const ta = composerRef.current;
    if (!ta) {
      setInput((v) => insertTranscript(v, v.length, text).value);
      return;
    }
    const { value, caret } = insertTranscript(ta.value, ta.selectionStart, text);
    setInput(value);
    ta.focus();
    requestAnimationFrame(() => {
      try {
        ta.setSelectionRange(caret, caret);
      } catch {
        /* element gone */
      }
    });
  }, []);
  const voice = useVoice(handleTranscript);

  // ── Load settings + keybindings on mount ──
  useEffect(() => {
    void (async () => {
      try {
        const s = (await loadSettingsFile()) as {
          effortLevel?: string;
          model?: string;
          permissions?: { defaultMode?: string };
        };
        if (s.effortLevel && (EFFORTS as string[]).includes(s.effortLevel)) {
          setEffort(s.effortLevel as Effort);
        }
        if (s.model) setModel(s.model);
        if (
          s.permissions?.defaultMode &&
          ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'].includes(
            s.permissions.defaultMode,
          )
        ) {
          setMode(s.permissions.defaultMode as AgentMode);
        }
      } catch {
        /* defaults */
      }
      try {
        const kb = await loadKeybindings();
        bindingsRef.current = [...DEFAULT_KEYBINDINGS, ...(kb.bindings ?? [])];
        if (kb.vim) {
          setVimEnabled(true);
          vimStateRef.current = new VimState();
          setVimMode(vimStateRef.current.mode);
        }
      } catch {
        /* defaults */
      }
    })();
  }, []);

  // ── Subscribe to agent events ──
  useEffect(() => {
    if (!window.deepcode?.agent) return;
    const off = window.deepcode.agent.onEvent((raw: unknown) => {
      const e = raw as AgentEvt;
      if (e.kind === 'turn_done') {
        changeBusy(false);
        activeTurnRef.current = null;
        cancellingRef.current = false;
        interactionRef.current = null;
        respondingToRef.current = null;
        setCancelling(false);
        setOutcome(
          e.stopReason === 'aborted'
            ? 'Interrupted'
            : e.stopReason === 'error'
              ? 'Failed'
              : 'Completed',
        );
        setInteractionError(null);
        setInteractionBusy(false);
        setActiveTurnId(null);
        setPendingApproval(null);
        setPendingQuestion(null);
        setMessages((m) => finalizeStreaming(m, e.stopReason === 'aborted'));
        onTurnComplete?.();
        return;
      }
      switch (e.type) {
        case 'turn_started':
          changeBusy(true);
          activeTurnRef.current = e.turnId;
          setActiveTurnId(e.turnId);
          break;
        case 'text_delta':
          setMessages((m) => appendTextDelta(m, e.text ?? ''));
          break;
        case 'thinking_delta':
          setMessages((m) => appendReasoningDelta(m, e.text ?? ''));
          break;
        case 'tool_use': {
          const name = e.name ?? '?';
          const input = e.input ?? {};
          setMessages((m) =>
            appendToolUse(m, {
              toolId: e.id ?? `tu-${Date.now()}`,
              name,
              input,
              target: pickTarget(input),
              status: 'running',
            }),
          );
          // Inspector: Recent files — dedupe, most-recent-first, capped.
          if (FILE_WRITE_TOOLS.has(name) && typeof input.file_path === 'string') {
            const fp = input.file_path;
            setRecentFiles((prev) =>
              [fp, ...prev.filter((f) => f !== fp)].slice(0, MAX_RECENT_FILES),
            );
          }
          // Inspector: Plan — TodoWrite carries the full list in its input.
          if (name === 'TodoWrite' && Array.isArray((input as { todos?: unknown }).todos)) {
            setTodos((input as { todos: TodoItem[] }).todos);
          }
          break;
        }
        case 'tool_result':
          setMessages((m) =>
            attachToolResult(
              m,
              e.id ?? '',
              e.result?.content ?? '',
              e.result?.isError ? 'err' : 'ok',
              readToolLocations(e.result?.data),
            ),
          );
          break;
        case 'usage': {
          // Emitted once per provider round-trip. The token counts arrive as
          // top-level fields (inputTokens/outputTokens), NOT under `input` —
          // reading the wrong field is why the ctx bar + cost were stuck at 0.
          const inTok = e.inputTokens ?? 0;
          const outTok = e.outputTokens ?? 0;
          // The latest turn's input ≈ the current context footprint, so it
          // drives the context bar (overwrite, not accumulate).
          setUsage({ inputTokens: inTok, outputTokens: outTok });
          // Cost bills every turn, so it accrues across the whole conversation.
          // estimateCost credits cheaper cache-hit input tokens (¥0.1/M vs ¥1/M)
          // and applies the right per-model output + reasoning rates.
          const turnCost = estimateCost(
            {
              inputTokens: inTok,
              outputTokens: outTok,
              reasoningTokens: e.reasoningTokens ?? 0,
              cacheReadTokens: e.cacheReadTokens ?? 0,
            },
            modelRef.current,
          );
          setCostYuan((c) => (c === null || !turnCost.available ? null : c + turnCost.totalYuan));
          break;
        }
        case 'error':
          setMessages((m) => [
            ...m,
            { role: 'system', text: `✕ ${e.error ?? 'unknown error'}`, level: 'error' },
          ]);
          break;
        case 'permission_request':
          if (e.requestId && e.toolName) {
            interactionRef.current = e.requestId;
            respondingToRef.current = null;
            setInteractionBusy(false);
            setPendingQuestion(null);
            setInteractionError(null);
            setPendingApproval({
              requestId: e.requestId,
              toolName: e.toolName,
              reason: e.reason ?? `Approve ${e.toolName}?`,
            });
          }
          break;
        case 'ask_user':
          if (e.requestId && e.question) {
            interactionRef.current = e.requestId;
            respondingToRef.current = null;
            setInteractionBusy(false);
            setPendingApproval(null);
            setInteractionError(null);
            setQuestionAnswer('');
            setQuestionChoices([]);
            setPendingQuestion({
              requestId: e.requestId,
              question: e.question,
              options: e.options ?? [],
              multiSelect: e.multiSelect,
            });
          }
          break;
      }
    });
    return () => off();
  }, []);

  useEffect(() => {
    if (followOutput.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(
    () =>
      registerShortcut('meta+.', () => {
        void handleAbort();
      }),
    [],
  );

  // ── Lift inspector state to App ──
  // Push a full snapshot whenever any inspector-relevant slice changes so the
  // right-hand panel + rail badges stay in sync. onInspector is memoized by the
  // parent, so this only fires on real state changes (not every render).
  useEffect(() => {
    onInspector?.({ usage, costYuan, model, mode, recentFiles, todos });
  }, [onInspector, usage, costYuan, model, mode, recentFiles, todos]);

  // ── Effort persist ──
  async function handleEffortChange(next: Effort): Promise<void> {
    setEffort(next);
    try {
      const cur = (await loadSettingsFile()) as Record<string, unknown>;
      await saveSettingsFile({ ...cur, effortLevel: next });
    } catch (err) {
      console.warn('persist effort:', err);
    }
  }

  // ── Vim ──
  function chordFromEvent(e: React.KeyboardEvent<HTMLTextAreaElement>): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    if (e.metaKey) parts.push('meta');
    let key = e.key;
    if (key === 'Escape') key = 'esc';
    else if (key.length === 1) key = key.toLowerCase();
    parts.push(key);
    return parts.join('+');
  }
  function applyAction(action: string): void {
    const ta = composerRef.current;
    if (!ta) return;
    switch (action) {
      case 'cursor-line-start':
      case 'cursor-buffer-start':
        ta.setSelectionRange(0, 0);
        break;
      case 'cursor-line-end':
      case 'cursor-buffer-end':
        ta.setSelectionRange(ta.value.length, ta.value.length);
        break;
      case 'kill-line':
      case 'kill-to-end': {
        const cur = ta.selectionStart;
        if (vimStateRef.current) vimStateRef.current.yanked = ta.value.slice(cur);
        setInput(ta.value.slice(0, cur));
        break;
      }
      case 'kill-to-start': {
        const cur = ta.selectionStart;
        if (vimStateRef.current) vimStateRef.current.yanked = ta.value.slice(0, cur);
        setInput(ta.value.slice(cur));
        break;
      }
      case 'yank-line':
        if (vimStateRef.current) vimStateRef.current.yanked = ta.value;
        break;
      case 'paste-after': {
        const cur = ta.selectionStart;
        const y = vimStateRef.current?.yanked ?? '';
        setInput(ta.value.slice(0, cur) + y + ta.value.slice(cur));
        break;
      }
    }
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // The palette owns the arrow keys, Tab and Escape while it is open —
    // before vim bindings, which would otherwise swallow them.
    if (slashMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (
        e.key === 'Tab' ||
        (e.key === 'Enter' && !e.shiftKey && input.trim() !== slashMatches[slashActive]?.name)
      ) {
        e.preventDefault();
        completeSlash(slashMatches[slashActive]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    // Enter submits when vim is off; in vim INSERT mode also submits.
    if (e.key === 'Enter' && !e.shiftKey) {
      if (!vimEnabled || vimStateRef.current?.mode === 'INSERT') {
        e.preventDefault();
        void handleSubmit(e as unknown as React.FormEvent);
        return;
      }
    }
    if (!vimEnabled || !vimStateRef.current) return;
    const chord = chordFromEvent(e);
    const before = vimStateRef.current.mode;
    const action = vimStateRef.current.feed(chord, bindingsRef.current);
    const after = vimStateRef.current.mode;
    if (action) {
      e.preventDefault();
      applyAction(action);
    } else if (before === 'NORMAL') {
      if (
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown' &&
        e.key !== 'Backspace'
      ) {
        e.preventDefault();
      }
    }
    if (after !== before) setVimMode(after);
  }

  // Approval decisions are one-shot. Persistent rules belong in Permissions.
  async function handleApproval(decision: 'allow' | 'deny'): Promise<void> {
    if (!pendingApproval || respondingToRef.current || cancellingRef.current) return;
    const req = pendingApproval;
    respondingToRef.current = req.requestId;
    setInteractionBusy(true);
    setInteractionError(null);
    try {
      await window.deepcode.agent.approve({ requestId: req.requestId, decision });
      if (interactionRef.current !== req.requestId) return;
      interactionRef.current = null;
      setPendingApproval(null);
      say(`${req.toolName} · ${decision === 'allow' ? 'Allowed once' : 'Rejected'}`);
    } catch (err) {
      if (interactionRef.current === req.requestId)
        setInteractionError(`Could not send decision: ${String(err)}`);
    } finally {
      if (respondingToRef.current === req.requestId) {
        respondingToRef.current = null;
        setInteractionBusy(false);
      }
    }
  }

  async function handleAnswer(answer: string): Promise<void> {
    if (!pendingQuestion || respondingToRef.current || cancellingRef.current || !answer.trim())
      return;
    const req = pendingQuestion;
    respondingToRef.current = req.requestId;
    setInteractionBusy(true);
    setInteractionError(null);
    try {
      await window.deepcode.agent.answer({ requestId: req.requestId, answer });
      if (interactionRef.current !== req.requestId) return;
      interactionRef.current = null;
      setPendingQuestion(null);
      say(`❯ ${req.question} → ${answer}`);
    } catch (err) {
      if (interactionRef.current === req.requestId)
        setInteractionError(`Could not send answer: ${String(err)}`);
    } finally {
      if (respondingToRef.current === req.requestId) {
        respondingToRef.current = null;
        setInteractionBusy(false);
      }
    }
  }

  // ── Slash commands ──

  function say(text: string, level?: 'error'): void {
    setMessages((m) => [...m, { role: 'system', text, ...(level ? { level } : {}) }]);
  }

  /** Runs a slash command locally. Returns false if the input wasn't one. */
  async function runSlash(raw: string): Promise<boolean> {
    const action = parseSlash(raw);
    if (!action) return false;

    switch (action.kind) {
      case 'help':
        say(slashHelpText());
        return true;
      case 'clear':
        if (onNewSession) {
          onNewSession();
          return true;
        }
        clearProtocolThread();
        setMessages([{ role: 'system', text: 'New conversation.' }]);
        setUsage({ inputTokens: 0, outputTokens: 0 });
        setCostYuan(0);
        setRecentFiles([]);
        setTodos([]);
        return true;
      case 'set-model':
        setModel(action.value);
        say(`Model → ${action.value}`);
        return true;
      case 'set-mode':
        setMode(action.value);
        say(`Mode → ${action.value}`);
        return true;
      case 'set-effort':
        await handleEffortChange(action.value);
        say(`Effort → ${action.value}`);
        return true;
      case 'cost': {
        const total = usage.inputTokens + usage.outputTokens;
        say(
          `Spend this conversation: ${costYuan === null ? 'unavailable' : `¥${costYuan.toFixed(4)}`}\n` +
            `Tokens: ${usage.inputTokens.toLocaleString()} in · ` +
            `${usage.outputTokens.toLocaleString()} out · ${total.toLocaleString()} total`,
        );
        return true;
      }
      case 'context': {
        const window = contextWindowFor(model);
        const used = usage.inputTokens + usage.outputTokens;
        const pct = window > 0 ? Math.round((used / window) * 100) : 0;
        say(
          `Context: ${used.toLocaleString()} / ${window.toLocaleString()} tokens (${pct}%)\n` +
            `Model: ${model}`,
        );
        return true;
      }
      case 'diff':
        try {
          const result = await getWorkspaceDiff();
          say(formatWorkspaceDiff(result));
        } catch (err) {
          say(`Could not read the working tree: ${(err as Error).message ?? err}`, 'error');
        }
        return true;
      case 'navigate':
        if (onNavigate) onNavigate(action.screen);
        else say('This build cannot navigate from the composer.', 'error');
        return true;
      case 'error':
        say(action.message, 'error');
        return true;
    }
  }

  function completeSlash(command: SlashCommand): void {
    setInput(command.args ? `${command.name} ` : command.name);
    setSlashIndex(0);
    // A command taking arguments stays open for typing; one that doesn't is
    // ready to send, so get the palette out of the way.
    if (!command.args) setSlashDismissed(true);
    composerRef.current?.focus();
  }

  // ── Send ──
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (!text || busyRef.current || pendingApproval || pendingQuestion) return;
    setInput('');
    setSlashDismissed(false);
    setSlashIndex(0);

    // Slash commands run here, not in the model. Echo the command so the
    // transcript shows what was asked for.
    if (text.startsWith('/')) {
      setMessages((m) => [...m, { role: 'user', text }]);
      if (await runSlash(text)) return;
    } else {
      setMessages((m) => [...m, { role: 'user', text }]);
    }
    changeBusy(true);
    setOutcome('Starting');
    followOutput.current = true;
    setAwayFromBottom(false);
    try {
      const r = await window.deepcode.agent.start({
        sessionId: 'default',
        userMessage: text,
        effort,
        model,
        mode,
        cwd: projectPath,
      });
      setActiveTurnId(r.turnId);
      activeTurnRef.current = r.turnId;
      if (r.sessionId) onSessionStarted?.(r.sessionId);
    } catch (err) {
      changeBusy(false);
      setOutcome('Failed');
      setInput(text);
      setMessages((m) => [
        ...m,
        {
          role: 'system',
          text: `✕ Failed to start: ${(err as Error).message ?? err}`,
          level: 'error',
        },
      ]);
    }
  }

  async function handleAbort(): Promise<void> {
    const id = activeTurnRef.current;
    if (!id || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    try {
      const accepted = await window.deepcode.agent.abort({ turnId: id });
      if (!accepted && activeTurnRef.current === id)
        throw new Error('The runtime did not accept the stop request.');
    } catch (err) {
      if (activeTurnRef.current !== id) return;
      cancellingRef.current = false;
      setCancelling(false);
      say(`Could not stop: ${String(err)}. Try Stop again.`, 'error');
    }
  }

  // Lock all the toolbar controls (mode / model / effort) once a turn
  // is in flight or pending approval — changing them mid-turn would
  // contradict the system prompt already sent.
  const controlsLocked = busy || pendingApproval !== null || pendingQuestion !== null;

  // Palette rows for what's typed. Declared after controlsLocked because it
  // reads it — render order is source order inside a component body.
  const slashMatches = slashDismissed || controlsLocked ? [] : filterCommands(input);
  const slashActive = Math.min(slashIndex, Math.max(0, slashMatches.length - 1));

  // Only the last assistant turn is "active" — its cursor blinks while the rest
  // stay static. Guards against a second cursor if a turn was left streaming.
  const activeAssistantIdx = lastAssistantIndex(messages);

  // ── Context bar fill ──
  const contextWindow = contextWindowFor(model);
  const usedTokens = usage.inputTokens + usage.outputTokens;
  const fillPct = Math.min(100, (usedTokens / contextWindow) * 100);

  const activity = cancelling
    ? 'Cancelling'
    : pendingApproval
      ? 'Awaiting approval'
      : pendingQuestion
        ? 'Awaiting input'
        : busy
          ? activeTurnId
            ? 'Working'
            : 'Starting'
          : outcome;
  const modeLabel = MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;

  return (
    <>
      <div className="chat-header">
        <span className="crumb">
          <b>{projectName(projectPath)}</b>
          {' · '}
          <span title={projectPath} className="muted">
            {abbreviatePath(projectPath)}
          </span>
        </span>
        <div className="right">
          <Pill>{modeLabel}</Pill>
          <span className={`activity-status ${busy ? 'active' : ''}`} role="status">
            {activity}
          </span>
        </div>
      </div>

      <div
        className="chat-stream"
        ref={listRef}
        role="region"
        aria-label="Conversation"
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAwayFromBottom(!followOutput.current);
        }}
      >
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="welcome-eyebrow">DEEPCODE · {projectName(projectPath)}</div>
            <h1>What are we building?</h1>
            <p>
              Explore your project, make a change, or trace a problem.
              <br />
              Review tool requests as the work progresses.
            </p>
            <div className="welcome-actions">
              {['Explain this codebase', 'Find and fix a bug', 'Review my changes'].map(
                (prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    onClick={() => {
                      setInput(prompt);
                      composerRef.current?.focus();
                    }}
                  >
                    {prompt}
                    <span aria-hidden="true">↗</span>
                  </button>
                ),
              )}
            </div>
          </div>
        )}
        {messages.map((m, i) => renderMessage(m, i, i === activeAssistantIdx, onOpenFile))}

        {busy && !pendingApproval && !pendingQuestion && (
          <div className="turn-progress">
            <span className="spinner" />
            {cancelling ? 'Stopping the current turn…' : 'Working on your request…'}
          </div>
        )}
      </div>

      <div className="composer">
        {awayFromBottom && (
          <button
            type="button"
            className="jump-latest"
            onClick={() => {
              followOutput.current = true;
              setAwayFromBottom(false);
              listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
            }}
          >
            ↓ Latest activity
          </button>
        )}
        {pendingApproval && (
          <section className="interaction-panel" aria-label="Tool approval">
            <div className="interaction-heading">
              Permission needed · {pendingApproval.toolName}
            </div>
            <p>{pendingApproval.reason}</p>
            <p className="interaction-scope">
              Allow this request once. Manage persistent rules in Settings → Permissions.
            </p>
            {interactionError && <p role="alert">{interactionError}</p>}
            <div className="approval-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={interactionBusy || cancelling}
                onClick={() => void handleApproval('allow')}
              >
                Allow once
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={interactionBusy || cancelling}
                onClick={() => void handleApproval('deny')}
              >
                Reject
              </button>
              <span className="muted">
                {cancelling
                  ? 'Cancelling…'
                  : interactionBusy
                    ? 'Sending decision…'
                    : 'Waiting for your decision'}
              </span>
            </div>
          </section>
        )}
        {pendingQuestion && (
          <form
            className="interaction-panel"
            aria-label="Agent question"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAnswer(
                [...questionChoices, questionAnswer.trim()].filter(Boolean).join(', '),
              );
            }}
          >
            <div className="interaction-heading">Your input is needed</div>
            <p>{pendingQuestion.question}</p>
            <div className="question-options">
              {pendingQuestion.options.map((option) => (
                <label key={option.label}>
                  <input
                    type={pendingQuestion.multiSelect ? 'checkbox' : 'radio'}
                    name="agent-answer"
                    checked={questionChoices.includes(option.label)}
                    disabled={interactionBusy || cancelling}
                    onChange={() =>
                      setQuestionChoices((choices) =>
                        pendingQuestion.multiSelect
                          ? choices.includes(option.label)
                            ? choices.filter((choice) => choice !== option.label)
                            : [...choices, option.label]
                          : [option.label],
                      )
                    }
                  />
                  <span>
                    {option.label}
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
            <input
              className="input"
              aria-label="Your answer"
              placeholder="Or write your own answer…"
              value={questionAnswer}
              disabled={interactionBusy || cancelling}
              onChange={(event) => setQuestionAnswer(event.target.value)}
            />
            {interactionError && <p role="alert">{interactionError}</p>}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                interactionBusy ||
                cancelling ||
                (!questionAnswer.trim() && questionChoices.length === 0)
              }
            >
              Send answer
            </button>
          </form>
        )}
        <form onSubmit={handleSubmit}>
          <div className="box">
            <SlashPalette
              commands={slashMatches}
              activeIndex={slashActive}
              onPick={completeSlash}
              onHover={setSlashIndex}
            />
            <textarea
              ref={composerRef}
              aria-label="Message DeepCode"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Re-open the palette when the user edits back into a command.
                setSlashDismissed(false);
                setSlashIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                pendingQuestion
                  ? 'Pick an option above to continue…'
                  : pendingApproval
                    ? 'Approve or reject the tool call above to continue…'
                    : busy
                      ? 'Agent is responding…'
                      : 'Ask about your code, or / for commands…'
              }
              disabled={busy || pendingApproval !== null || pendingQuestion !== null}
              rows={Math.min(6, Math.max(1, input.split('\n').length))}
            />
            <div className="toolbar">
              <PlusMenu
                disabled={controlsLocked}
                items={[
                  {
                    icon: '📎',
                    label: 'Attach file',
                    description: 'Insert @<path> for the agent to read',
                    onClick: async () => {
                      const filePath = await pickFile({ defaultPath: projectPath });
                      if (!filePath) return;
                      const ta = composerRef.current;
                      if (!ta) return;
                      const ref = `@${filePath}`;
                      const cursor = ta.selectionStart;
                      const before = ta.value.slice(0, cursor);
                      const after = ta.value.slice(cursor);
                      const prefix = before.length === 0 || before.endsWith(' ') ? '' : ' ';
                      const suffix = after.startsWith(' ') || after.length === 0 ? ' ' : ' ';
                      setInput(before + prefix + ref + suffix + after);
                      ta.focus();
                    },
                  },
                  {
                    icon: '/',
                    label: 'Slash command',
                    description: 'Browse available commands',
                    onClick: () => {
                      const ta = composerRef.current;
                      if (!ta) return;
                      if (!input.startsWith('/')) setInput('/' + input);
                      ta.focus();
                    },
                  },
                ]}
              />

              <button
                type="button"
                className={
                  'mic-btn' +
                  (voice.state === 'recording'
                    ? ' recording'
                    : voice.state === 'transcribing'
                      ? ' transcribing'
                      : '')
                }
                disabled={
                  controlsLocked || voice.available === false || voice.state === 'transcribing'
                }
                title={
                  voice.available === false
                    ? 'Voice not set up — ' + (voice.problems[0] ?? 'see docs/VOICE_INPUT.md')
                    : voice.state === 'recording'
                      ? 'Stop & transcribe'
                      : voice.state === 'transcribing'
                        ? 'Transcribing…'
                        : 'Dictate with local whisper.cpp'
                }
                onClick={() => voice.toggle()}
              >
                {voice.state === 'recording' ? '⏹' : voice.state === 'transcribing' ? '…' : '🎙'}
              </button>
              {voice.error && (
                <span className="voice-error" title={voice.error}>
                  ⚠ voice
                </span>
              )}

              <Dropdown<typeof mode>
                value={mode}
                onChange={setMode}
                disabled={controlsLocked}
                triggerClass={
                  'mode-badge ' +
                  (mode === 'bypassPermissions' ? 'bypass' : mode === 'plan' ? 'plan' : 'default')
                }
                renderTrigger={(opt) => (
                  <span>
                    {opt.meta} {opt.label}
                  </span>
                )}
                title="Mode controls how tool calls are approved"
                panelWidth={300}
                options={MODE_OPTIONS}
              />

              {vimEnabled && (
                <span
                  className={
                    'vim-chip ' +
                    (vimMode === 'NORMAL' ? 'normal' : vimMode === 'VISUAL' ? 'visual' : '')
                  }
                  title="Vim mode is on"
                >
                  -- {vimMode} --
                </span>
              )}
              <span className="spacer" />

              <Dropdown<typeof model>
                value={model}
                onChange={setModel}
                disabled={controlsLocked}
                dot
                title="Model"
                panelWidth={280}
                options={MODEL_OPTIONS}
                renderTrigger={(opt) => (
                  <>
                    <span>{opt.label}</span>
                    <span className="meta">{opt.meta}</span>
                  </>
                )}
              />

              <Dropdown<Effort>
                value={effort}
                onChange={(v) => void handleEffortChange(v)}
                disabled={controlsLocked}
                title="Effort — maxTokens + temperature"
                panelWidth={280}
                options={effortOptions(model)}
                renderTrigger={(opt) => (
                  <>
                    <span>{opt.label}</span>
                    <span className="meta">{opt.meta}</span>
                  </>
                )}
              />

              {busy ? (
                <button
                  type="button"
                  onClick={handleAbort}
                  className="send-btn stop"
                  title="Stop (⌘.)"
                  aria-label={cancelling ? 'Cancelling' : 'Stop'}
                  disabled={cancelling || !activeTurnId}
                >
                  ■
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-btn"
                  disabled={!input.trim() || pendingApproval !== null}
                  title="Send (Enter)"
                  aria-label="Send message"
                >
                  ↵
                </button>
              )}
            </div>
          </div>
        </form>
        <div className="ctx-bar">
          <span title="Latest reported input and output tokens; an estimate of context usage">
            Context ≈ {usedTokens.toLocaleString()} / {contextWindow.toLocaleString()}
          </span>
          <div className="progress">
            <div className="fill" style={{ width: `${fillPct}%` }} />
          </div>
          <span>{fillPct.toFixed(1)}%</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>
            {costYuan === null ? 'Cost unavailable' : `¥ ${costYuan.toFixed(4)}`}
          </span>
        </div>
      </div>
    </>
  );
}

// ─── Message renderer ─────────────────────────────────────────────────

function renderMessage(
  m: Msg,
  i: number,
  isActive: boolean,
  onOpenFile?: (path: string) => void,
): JSX.Element | null {
  if (m.role === 'user') {
    return (
      <div className="msg user" key={i}>
        <div className="avatar">YO</div>
        <div className="body">
          <div className="author">You</div>
          <div className="content">{m.text}</div>
        </div>
      </div>
    );
  }
  if (m.role === 'system') {
    // One-liners are a thin centred hint. Command output (/help, /diff, /cost)
    // is multi-line and column-aligned, so it gets a left-aligned monospace
    // block instead — centring it and collapsing the newlines turned the help
    // table into a paragraph.
    const block = m.text.includes('\n');
    return (
      <div
        key={i}
        role={m.level === 'error' ? 'alert' : undefined}
        style={{
          fontSize: block ? 12 : 11.5,
          color: m.level === 'error' ? 'var(--error)' : 'var(--text-3)',
          textAlign: block ? 'left' : 'center',
          whiteSpace: block ? 'pre-wrap' : undefined,
          maxWidth: block ? 760 : undefined,
          marginInline: block ? 'auto' : undefined,
          padding: '6px 12px',
          fontFamily: block || m.level === 'error' ? 'JetBrains Mono, monospace' : 'inherit',
          background: m.level === 'error' ? 'rgba(255, 84, 112, 0.06)' : 'transparent',
          borderRadius: 'var(--radius-sm)',
          lineHeight: 1.5,
        }}
      >
        {m.text}
      </div>
    );
  }
  // assistant
  return (
    <div className="msg assistant" key={i}>
      <div className="avatar">DC</div>
      <div className="body">
        <div className="author">DeepCode</div>
        <div className="content">
          {m.turn.reasoning ? <ReasoningBlock text={m.turn.reasoning} /> : null}
          <MessageContent text={m.turn.text} />
          {m.turn.streaming && isActive && <span className="streaming-cursor" />}
          {m.turn.tools.map((t) => {
            const presentation = presentToolCall(t.name, t.input ?? {});
            return (
              <div key={t.toolId}>
                <ToolCard
                  name={t.name}
                  // A terminal body opens with the command as its prompt line,
                  // in full, so repeating it in the header is noise.
                  target={t.target}
                  status={{
                    kind: t.status === 'ok' ? 'ok' : t.status === 'err' ? 'err' : 'info',
                    label:
                      t.status === 'running'
                        ? '… running'
                        : t.status === 'ok'
                          ? '✓ done'
                          : t.status === 'err'
                            ? '✕ error'
                            : t.status === 'interrupted'
                              ? 'interrupted · result unknown'
                              : 'result unavailable',
                  }}
                  layout={presentation.kind}
                  body={
                    <ToolBody
                      presentation={presentation}
                      resultText={t.resultText}
                      locations={t.locations}
                      onOpenFile={onOpenFile}
                    />
                  }
                  onOpen={
                    onOpenFile && typeof t.input?.file_path === 'string'
                      ? () => onOpenFile(String(t.input.file_path))
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── UI helpers ───────────────────────────────────────────────────────
// (Stream mutators live in ../lib/repl-stream.ts so they can be unit-tested.)

/** Abbreviate a long path by replacing $HOME prefix with "~". */
function abbreviatePath(p: string): string {
  // Best-effort home detection — works for /Users/<n>/... on macOS
  const m = p.match(/^\/Users\/[^/]+/);
  if (m) return '~' + p.slice(m[0].length);
  return p;
}

/**
 * The model's reasoning, as a collapsed side channel.
 *
 * Collapsed by default: reasoner output is long and is not the answer. Open on
 * click, and while a turn is still streaming it is often the only thing to look
 * at, so the summary line reports its length rather than staying silent.
 */
function ReasoningBlock({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n').length;
  return (
    <details className="reasoning" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        thinking
        <span className="reasoning-meta">
          {' · '}
          {lines} line{lines === 1 ? '' : 's'}
        </span>
      </summary>
      <div className="reasoning-body">{text}</div>
    </details>
  );
}
