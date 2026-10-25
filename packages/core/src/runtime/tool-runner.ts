import type { RunAgentOptions } from '../agent.js';
import { dispatchToolCall } from '../harness/tool-dispatcher.js';
import { resolveRuntimePolicy } from './policy.js';
import { applySpillPolicy } from '../spill/index.js';
import { createLocalSpillStore } from '../spill/local.js';
import { buildToolCallRecord, ledgerKindForTool, readPathFor } from '../ledger/record-tool-call.js';
import { fileWriteDenial } from '../sandbox/file-policy.js';
import type { ToolResult } from '../types.js';

/** The SDK bridge owns no permissions: every call is evaluated by the native policy. */
export function createEngineToolRunner(options: RunAgentOptions & { onBlocked?: () => void }) {
  const policy = resolveRuntimePolicy(options);
  const reads = new Set<string>();
  let blocked = false;
  let queue: Promise<unknown> = Promise.resolve();
  const spill =
    options.spillStore ??
    (options.session
      ? createLocalSpillStore(`${options.session.manager.root}/${options.session.id}`)
      : undefined);
  const nextSequence = async () => {
    const snapshots = options.session
      ? await options.session.manager.snapshots(options.session.id)
      : [];
    return snapshots.reduce((max, snapshot) => Math.max(max, snapshot.seq), 0) + 1;
  };
  const execute = async (
    name: string,
    input: Record<string, unknown>,
    id: string,
  ): Promise<ToolResult> => {
    options.signal?.throwIfAborted();
    const handler = options.tools.get(name);
    if (!handler || (options.allowedTools && !options.allowedTools.includes(name)))
      return { content: 'Tool unavailable', isError: true };
    options.onEvent?.({ type: 'tool_use', id, name, input });
    const verdict = await dispatchToolCall({
      sandboxConfig: options.sandboxConfig,
      sandboxDefaultMode: options.sandboxDefaultMode,
      tool: name,
      input,
      cwd: options.cwd,
      mode: policy.mode,
      rules: policy.permissions,
      contract: options.contract,
      hooks: options.hooks,
      autoMode: options.autoMode,
      autoModeProvider: options.provider,
      autoModeModel: options.model,
      signal: options.signal,
    });
    options.signal?.throwIfAborted();
    if (
      verdict.decision === 'ask' &&
      options.unattended &&
      options.onApprovalRequired === 'abort'
    ) {
      blocked = true;
      const result = {
        content: `Approval required for ${name}, but this run is unattended`,
        isError: true,
      };
      options.onEvent?.({ type: 'tool_result', id, result });
      options.onBlocked?.();
      return result;
    }
    let approved = verdict.decision === 'allow';
    if (verdict.decision === 'ask' && options.approval && !options.unattended) {
      const response = await new Promise<boolean | 'always'>((resolve, reject) => {
        const done = (value: boolean | 'always') => {
          options.signal?.removeEventListener('abort', abort);
          resolve(value);
        };
        const abort = () => done(false);
        options.signal?.addEventListener('abort', abort, { once: true });
        Promise.resolve()
          .then(() => options.approval!(name, input, verdict))
          .then(done, (error: unknown) => {
            options.signal?.removeEventListener('abort', abort);
            reject(error);
          });
      });
      approved = response === true || response === 'always';
    }
    options.signal?.throwIfAborted();
    if (approved) {
      const denial = await fileWriteDenial(
        name,
        input,
        options.cwd,
        options.sandboxConfig,
        options.sandboxDefaultMode,
      );
      options.signal?.throwIfAborted();
      if (denial) {
        const result = { content: `Tool call blocked: ${denial}`, isError: true };
        options.onEvent?.({ type: 'tool_result', id, result });
        return result;
      }
    }
    let result: ToolResult;
    if (!approved) result = { content: `Tool call blocked: ${verdict.reason}`, isError: true };
    else {
      const filePath = typeof input.file_path === 'string' ? input.file_path : undefined;
      const mutation = ['Write', 'Edit', 'NotebookEdit'].includes(name);
      const session = options.session;
      const snapshot = async (reason: string) => {
        if (!session || options.enableSnapshots === false || !filePath || !mutation) return;
        return session.manager.snapshot({
          sessionId: session.id,
          cwd: options.cwd,
          filePath,
          reason,
          seq: await nextSequence(),
          turnId: session.turnId,
        });
      };
      let preSnapshot = await snapshot(`pre-${name}`);
      if (session && name === 'Bash' && options.enableSnapshots !== false)
        preSnapshot = await session.manager.gitCheckpoint({
          sessionId: session.id,
          cwd: options.cwd,
          reason: 'pre-Bash',
          seq: await nextSequence(),
          turnId: session.turnId,
        });
      options.signal?.throwIfAborted();
      try {
        const denial = await fileWriteDenial(
          name,
          input,
          options.cwd,
          options.sandboxConfig,
          options.sandboxDefaultMode,
        );
        if (denial) throw new Error(denial);
        options.signal?.throwIfAborted();
        result = await handler.execute(input, {
          cwd: options.cwd,
          signal: options.signal,
          sandboxConfig: options.sandboxConfig,
          sandboxDefaultMode: options.sandboxDefaultMode ?? 'workspace-write',
          contract: options.contract,
          askUser: options.askUser,
          sessionId: session?.id,
          sessionDir: session ? `${session.manager.root}/${session.id}` : undefined,
          turnId: session?.turnId,
        });
      } catch (error) {
        result = { content: `Tool failed: ${(error as Error).message}`, isError: true };
      }
      options.signal?.throwIfAborted();
      if (!result.isError) await snapshot(`post-${name}`);
      const readPath = readPathFor(name, input);
      if (!result.isError && readPath) reads.add(readPath);
      await options.hooks?.dispatch({
        event: 'PostToolUse',
        cwd: options.cwd,
        signal: options.signal,
        triggeredAt: new Date().toISOString(),
        payload: {
          tool: name,
          input,
          result_content: result.content.slice(0, 1000),
          is_error: result.isError ?? false,
        },
      });
      const kind = ledgerKindForTool(name);
      options.signal?.throwIfAborted();
      if (kind && !result.isError && options.ledger) {
        const record = buildToolCallRecord({
          tool: name,
          input,
          cwd: options.cwd,
          intent: options.userMessage,
          threadId: session?.id,
          turnId: session?.turnId,
          snapshotSeq: preSnapshot?.seq,
          readPaths: [...reads],
        });
        if (record) await options.ledger.append(kind, record).catch(() => undefined);
      }
    }
    options.signal?.throwIfAborted();
    result = await applySpillPolicy(result, {
      source: { toolName: name, callId: id, label: 'result' },
      store: spill,
      thresholdChars: options.spillThresholdChars,
    });
    options.onEvent?.({ type: 'tool_result', id, result });
    return result;
  };
  return {
    get blocked() {
      return blocked;
    },
    run(name: string, input: Record<string, unknown>, id: string) {
      const next = queue.then(() => execute(name, input, id));
      queue = next.catch(() => undefined);
      return next;
    },
    async drain() {
      await queue;
    },
  };
}
