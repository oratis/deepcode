import { captureJournalWriterScope } from '../sessions/journal.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunAgentOptions } from '../agent.js';
import { dispatchToolCall, type DispatchVerdict } from '../harness/tool-dispatcher.js';
import { resolveRuntimePolicy } from './policy.js';
import { fileWriteDenial } from '../sandbox/file-policy.js';
import { applySpillPolicy } from '../spill/index.js';
import { createLocalSpillStore } from '../spill/local.js';
import { buildToolCallRecord, ledgerKindForTool, readPathFor } from '../ledger/record-tool-call.js';
import { deadlineMessage, resolveToolDeadlineMs } from '../guard/tool-deadline.js';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

export type ToolExecutionOptions = Pick<
  RunAgentOptions,
  | 'tools'
  | 'cwd'
  | 'mode'
  | 'permissions'
  | 'contract'
  | 'ledger'
  | 'hooks'
  | 'approval'
  | 'unattended'
  | 'onApprovalRequired'
  | 'autoMode'
  | 'sandboxConfig'
  | 'sandboxDefaultMode'
  | 'signal'
  | 'session'
  | 'enableSnapshots'
  | 'spillStore'
  | 'spillThresholdChars'
  | 'toolDeadlines'
  | 'onEvent'
  | 'userMessage'
  | 'askUser'
  | 'sessionSearchScope'
  | 'allowedTools'
> &
  Partial<Pick<RunAgentOptions, 'provider' | 'model'>> & {
    /** An additional host restriction; it can deny, never grant permission. */
    restrict?: (name: string, input: Record<string, unknown>) => Promise<string | undefined>;
  };

export interface PreparedToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly result?: ToolResult;
}
const PARALLEL_READS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const stack = new AsyncLocalStorage<ReadonlySet<string>>();
const activeService = new AsyncLocalStorage<{
  service: ToolExecutionService;
  signal: AbortSignal;
}>();
const CLEANUP_MS = 2_000;
let hookSequence = 0;

function freezeInput(input: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(input);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  };
  freeze(copy);
  return copy;
}

/** One policy, execution and settlement path for every host and engine. */
export class ToolExecutionService {
  readonly signal: AbortSignal;
  private readonly writerScope = captureJournalWriterScope();
  private readonly controller = new AbortController();
  private readonly policy;
  private readonly admitted = new WeakMap<
    PreparedToolCall,
    { handler: ToolHandler; signal: AbortSignal; onEvent: ToolExecutionOptions['onEvent'] }
  >();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly reads = new Set<string>();
  private readonly concurrentReads = new Set<Promise<unknown>>();
  private gateQueue: Promise<unknown> = Promise.resolve();
  private writeQueue: Promise<unknown> = Promise.resolve();
  private context: ToolContext;
  private closed = false;
  private failure: Error | undefined;
  private approvalBlocked = false;

  constructor(private readonly options: ToolExecutionOptions) {
    this.policy = resolveRuntimePolicy(options);
    this.signal = options.signal
      ? AbortSignal.any([options.signal, this.controller.signal])
      : this.controller.signal;
    this.context = {
      cwd: options.cwd,
      signal: this.signal,
      sandboxConfig: options.sandboxConfig,
      sandboxDefaultMode: options.sandboxDefaultMode ?? 'workspace-write',
      contract: options.contract,
      askUser: options.askUser,
      sessionId: options.session?.id,
      sessionDir: options.session
        ? `${options.session.manager.resourceRoot}/${options.session.id}`
        : undefined,
      sessionsRoot: options.session?.manager.resourceRoot,
      sessionSearchScope: options.sessionSearchScope,
      turnId: options.session?.turnId,
    };
    // Late-bound to the active service, not a previous turn's context/policy.
    options.hooks?.setMcpToolDispatcher(async (handler) => {
      const current = activeService.getStore();
      if (!current) return { stdout: '', stderr: 'No active tool execution scope', exitCode: 1 };
      const result = await current.service.run(
        `mcp__${handler.server}__${handler.tool}`,
        handler.arguments ?? {},
        `hook-mcp-${++hookSequence}`,
        current.signal,
      );
      if (result.data?.spill)
        return {
          stdout: '',
          stderr: 'MCP hook output was truncated; refusing an incomplete decision',
          exitCode: 1,
        };
      return {
        stdout: result.content,
        stderr: result.isError ? result.content : '',
        exitCode: result.isError ? 1 : 0,
      };
    }, true);
    options.hooks?.setAgentDispatcher(async (handler, payload) => {
      const current = activeService.getStore();
      const ancestors = stack.getStore();
      if (!current?.service.context.runSubAgent || ancestors?.has('hook:agent'))
        return { stdout: '', stderr: 'Agent hook unavailable or recursive', exitCode: 1 };
      return stack.run(new Set([...(ancestors ?? []), 'hook:agent']), async () => {
        const result = await current.service.context.runSubAgent!({
          prompt: `${handler.prompt ?? ''}\n\nHook event payload:\n${JSON.stringify(payload)}`,
          agentType: handler.agent,
          signal: current.signal,
        });
        return { stdout: result.text, stderr: '', exitCode: 0 };
      });
    }, true);
  }

  get blocked(): boolean {
    return this.approvalBlocked;
  }

  withScope<T>(work: () => T): T {
    return this.withInvocation(this.signal, work);
  }

  private withInvocation<T>(signal: AbortSignal, work: () => T): T {
    return this.writerScope(() => activeService.run({ service: this, signal }, work));
  }

  /** Loop-owned features only: this cannot override policy, cwd or signal. */
  setRuntimeContext(
    context: Pick<ToolContext, 'runSubAgent' | 'tasks' | 'shells' | 'modeSignal'>,
  ): void {
    const { runSubAgent, tasks, shells, modeSignal } = context;
    this.context = { ...this.context, runSubAgent, tasks, shells, modeSignal };
  }
  private check(signal = this.signal): void {
    if (this.failure) throw this.failure;
    signal.throwIfAborted();
    if (this.closed) throw new Error('Tool execution scope is closed');
  }
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    void work.then(
      () => this.pending.delete(work),
      () => this.pending.delete(work),
    );
    return work;
  }

  /** Approvals remain sequential even when admitted read-only calls overlap. */
  prepare(
    name: string,
    input: Record<string, unknown>,
    id: string,
    emitUse = true,
    callerSignal?: AbortSignal,
    onEvent = this.options.onEvent,
  ): Promise<PreparedToolCall> {
    const signal = callerSignal ? AbortSignal.any([this.signal, callerSignal]) : this.signal;
    const ancestors = stack.getStore();
    const work = () =>
      this.withInvocation(signal, () =>
        stack.run(new Set([...(ancestors ?? []), name]), async () => {
          this.check(signal);
          const call = { id, name, input: freezeInput(input) };
          if (emitUse) onEvent?.({ type: 'tool_use', ...call });
          const refused = async (
            reason: string,
            verdict?: DispatchVerdict,
          ): Promise<PreparedToolCall> => {
            const result: ToolResult = {
              content: `Tool call blocked: ${reason}`,
              isError: true,
              ...(verdict
                ? { data: { dispatchSource: verdict.source, decision: verdict.decision } }
                : {}),
            };
            await this.journal('tool.result', id, { name, result, blocked: true });
            onEvent?.({ type: 'tool_result', id, result });
            return Object.freeze({ ...call, result });
          };
          if (ancestors?.has(name) || (ancestors?.size ?? 0) >= 16)
            return refused(`recursive tool/hook invocation: ${name}`);
          const handler = this.options.tools.get(name);
          if (!handler) return refused(`tool not found: ${name}`);
          if (this.options.allowedTools && !this.options.allowedTools.includes(name))
            return refused(`tool not allowed in this turn: ${name}`);
          const restriction = await this.options.restrict?.(name, call.input);
          this.check(signal);
          if (restriction) return refused(restriction);
          const verdict = await dispatchToolCall({
            tool: name,
            input: call.input,
            cwd: this.options.cwd,
            mode: this.policy.mode,
            rules: this.policy.permissions,
            contract: this.options.contract,
            hooks: this.options.hooks,
            autoMode: this.options.autoMode,
            autoModeProvider: this.options.provider,
            autoModeModel: this.options.model,
            sandboxConfig: this.options.sandboxConfig,
            sandboxDefaultMode: this.options.sandboxDefaultMode ?? 'workspace-write',
            signal,
          });
          this.check(signal);
          let allowed = verdict.decision === 'allow';
          let reason = verdict.reason;
          if (verdict.decision === 'ask' && this.options.unattended) {
            reason = `approval required for ${name}, but this run is unattended (no approver attached)`;
            this.approvalBlocked ||= this.options.onApprovalRequired === 'abort';
          } else if (verdict.decision === 'ask' && this.options.approval) {
            await this.journal('approval.requested', id, { name, input: call.input });
            const decision = await this.waitApproval(name, call.input, verdict, signal);
            await this.journal('approval.decided', id, { name, decision });
            allowed = decision === true || decision === 'always';
          }
          this.check(signal);
          if (!allowed) return refused(reason, verdict);
          const prepared = Object.freeze(call);
          this.admitted.set(prepared, { handler, signal, onEvent });
          return prepared;
        }),
      );
    // Nested hook calls must not wait on their own parent's gate queue.
    const next = ancestors?.size ? work() : this.gateQueue.then(work);
    if (!ancestors?.size) this.gateQueue = next.catch(() => undefined);
    return this.track(next);
  }

  private waitApproval(
    name: string,
    input: Record<string, unknown>,
    verdict: DispatchVerdict,
    signal: AbortSignal,
  ) {
    return new Promise<boolean | 'always'>((resolve, reject) => {
      const abort = () => finish(false);
      const finish = (value: boolean | 'always') => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return finish(false);
      Promise.resolve()
        .then(() => {
          this.check(signal);
          return this.options.approval!(name, input, verdict);
        })
        .then(finish, (error: unknown) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        });
    });
  }

  execute(call: PreparedToolCall): Promise<ToolResult> {
    if (call.result) return Promise.resolve(call.result);
    const admission = this.admitted.get(call);
    if (!admission) return Promise.reject(new Error('Invalid or already consumed tool admission'));
    this.admitted.delete(call);
    const ancestors = stack.getStore();
    const work = () =>
      this.withInvocation(admission.signal, () =>
        stack.run(new Set([...(ancestors ?? []), call.name]), () =>
          this.options.session
            ? this.options.session.manager.withWriter(this.options.session.id, () =>
                this.executeAdmitted(call, admission.handler, admission.signal, admission.onEvent),
              )
            : this.executeAdmitted(call, admission.handler, admission.signal, admission.onEvent),
        ),
      );
    let next: Promise<ToolResult>;
    if (ancestors?.size) next = work();
    else if (PARALLEL_READS.has(call.name)) {
      next = this.writeQueue.then(work);
      this.concurrentReads.add(next);
      void next.then(
        () => this.concurrentReads.delete(next),
        () => this.concurrentReads.delete(next),
      );
    } else {
      next = Promise.all([this.writeQueue, ...this.concurrentReads]).then(work);
      this.writeQueue = next.catch(() => undefined);
    }
    return this.track(next);
  }
  async run(
    name: string,
    input: Record<string, unknown>,
    id: string,
    signal?: AbortSignal,
    onEvent = this.options.onEvent,
  ): Promise<ToolResult> {
    return this.withScope(async () => {
      const run = async () =>
        this.execute(await this.prepare(name, input, id, true, signal, onEvent));
      return this.options.session
        ? this.options.session.manager.withWriter(this.options.session.id, run)
        : run();
    });
  }

  private async executeAdmitted(
    call: PreparedToolCall,
    handler: ToolHandler,
    signal: AbortSignal,
    onEvent: ToolExecutionOptions['onEvent'],
  ): Promise<ToolResult> {
    this.check(signal);
    const { name, input, id } = call;
    const options = this.options;
    const checkPath = async () => {
      const denial = await fileWriteDenial(
        name,
        input,
        options.cwd,
        options.sandboxConfig,
        options.sandboxDefaultMode ?? 'workspace-write',
      );
      this.check(signal);
      if (denial) throw new Error(denial);
    };
    let result: ToolResult;
    let preSeq: number | undefined;
    const session = options.session;
    const targetPath = name === 'NotebookEdit' ? input.notebook_path : input.file_path;
    const filePath = typeof targetPath === 'string' ? targetPath : undefined;
    const mutation = ['Write', 'Edit', 'NotebookEdit'].includes(name);
    const snapshot = async (reason: string) => {
      if (!session || options.enableSnapshots === false) return undefined;
      if (!(mutation && filePath) && !(name === 'Bash' && reason === 'pre-Bash')) return undefined;
      const snapshots = await session.manager.snapshots(session.id);
      this.check(signal);
      const seq = snapshots.reduce((max, s) => Math.max(max, s.seq), 0) + 1;
      const args = { sessionId: session.id, cwd: options.cwd, reason, seq, turnId: session.turnId };
      const saved =
        mutation && filePath
          ? await session.manager.snapshot({ ...args, filePath })
          : await session.manager.gitCheckpoint(args);
      return saved ? seq : undefined;
    };
    await this.journal('tool.intent', id, { name, input });
    try {
      await checkPath();
      preSeq = await snapshot(`pre-${name}`);
      await checkPath();
      result = await this.withDeadline(call, handler, signal);
    } catch (error) {
      this.check(signal);
      result = { content: `Error: ${(error as Error).message}`, isError: true };
    }
    this.check(signal);
    result = await applySpillPolicy(result, {
      source: { toolName: name, callId: id, label: 'result' },
      store:
        options.spillStore ??
        (this.context.sessionDir ? createLocalSpillStore(this.context.sessionDir) : undefined),
      thresholdChars: options.spillThresholdChars,
    });
    this.check(signal);
    await options.hooks?.dispatch({
      event: 'PostToolUse',
      cwd: options.cwd,
      signal,
      triggeredAt: new Date().toISOString(),
      payload: {
        tool: name,
        input,
        result_content: result.content.slice(0, 1000),
        is_error: result.isError ?? false,
      },
    });
    this.check(signal);
    if (!result.isError) {
      await snapshot(`post-${name}`);
      this.check(signal);
      const path = readPathFor(name, input);
      if (path) this.reads.add(path);
      const kind = ledgerKindForTool(name);
      const record =
        kind &&
        buildToolCallRecord({
          tool: name,
          input,
          cwd: options.cwd,
          intent: options.userMessage,
          threadId: session?.id,
          turnId: session?.turnId,
          snapshotSeq: preSeq,
          readPaths: [...this.reads],
        });
      if (kind && record && options.ledger)
        await options.ledger.append(kind, record).catch(() => undefined);
    }
    this.check(signal);
    await this.journal('tool.result', id, { name, result });
    this.check(signal);
    onEvent?.({ type: 'tool_result', id, result });
    return result;
  }

  private async journal(
    type: string,
    callId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const session = this.options.session;
    if (session)
      await session.manager.record(session.id, [{ type, callId, turnId: session.turnId, payload }]);
  }

  private async withDeadline(
    call: PreparedToolCall,
    handler: ToolHandler,
    callerSignal: AbortSignal,
  ): Promise<ToolResult> {
    const ms = resolveToolDeadlineMs(call.name, call.input, this.options.toolDeadlines);
    const controller = new AbortController();
    const signal = AbortSignal.any([callerSignal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    const interrupted = new Promise<'deadline' | 'aborted'>((resolve) => {
      abort = () => resolve('aborted');
      callerSignal.addEventListener('abort', abort, { once: true });
      if (ms !== undefined)
        timer = setTimeout(() => {
          resolve('deadline');
          controller.abort();
        }, ms);
    });
    const execution = Promise.resolve().then(() => {
      this.check(signal);
      return this.withInvocation(signal, () =>
        handler.execute(call.input, { ...this.context, signal }),
      );
    });
    try {
      const result = await Promise.race([execution, interrupted]);
      if (result === 'deadline' || result === 'aborted') {
        controller.abort();
        // Process supervisors escalate on abort concurrently with this bounded drain.
        await this.boundedDrain([execution]);
        if (result === 'aborted') this.check(callerSignal);
        return { content: deadlineMessage(call.name, ms!), isError: true };
      }
      return result;
    } finally {
      clearTimeout(timer);
      callerSignal.removeEventListener('abort', abort);
    }
  }
  private async boundedDrain(work: Promise<unknown>[]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(work),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.failure = new Error(
              'cleanup_incomplete: tool did not stop; execution scope revoked',
            );
            this.controller.abort();
            reject(this.failure);
          }, CLEANUP_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async drain(): Promise<void> {
    await this.boundedDrain([...this.pending]);
    if (this.failure) throw this.failure;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.controller.abort();
    await this.drain();
  }
}

/** No ambient plugin filesystem authority during startup or between turns. */
export class ToolExecutionBinding {
  private readonly scopes = new Set<ToolExecutionService>();
  bind(service: ToolExecutionService): () => void {
    this.scopes.add(service);
    return () => {
      this.scopes.delete(service);
    };
  }
  async run(
    name: string,
    input: Record<string, unknown>,
    id: string,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    signal?.throwIfAborted();
    if (this.scopes.size > 1)
      throw new Error('Plugin capability unavailable: ambiguous concurrent turns');
    const current = this.scopes.values().next().value;
    if (!current) throw new Error('Plugin capability unavailable outside an active turn');
    return current.run(name, input, id, signal);
  }
}
