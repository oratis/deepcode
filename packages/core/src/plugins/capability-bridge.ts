import { randomUUID } from 'node:crypto';
import { bashProcessOutput } from '../tools/bash.js';
import type { ToolExecutionBinding } from '../runtime/tool-execution.js';
import type { PluginCapabilityBridge } from './wireup.js';

/** A transport adapter only: policy and effects belong to the active executor. */
export function createPluginCapabilityBridge(
  binding: Pick<ToolExecutionBinding, 'run'>,
): PluginCapabilityBridge {
  const execute = async (name: string, input: Record<string, unknown>, signal?: AbortSignal) => {
    const result = await binding.run(name, input, `plugin-${randomUUID()}`, signal);
    if (result.isError) throw new Error(result.content);
    return result;
  };
  return {
    fs_read: async (path, signal) => (await execute('Read', { file_path: path }, signal)).content,
    fs_write: async (path, content, signal) => {
      await execute('Write', { file_path: path, content }, signal);
    },
    bash: async (command, signal) => {
      const result = await execute('Bash', { command }, signal);
      const data = result.data as
        { stderr?: string; exitCode?: number; spill?: unknown } | undefined;
      const output = bashProcessOutput(result);
      // A broker must not expose raw output beyond the execution service's spill ceiling.
      const truncated = !!data?.spill || !!output?.truncated;
      return {
        stdout: truncated ? result.content : (output?.stdout ?? result.content),
        stderr: truncated ? '' : (output?.stderr ?? data?.stderr ?? ''),
        exitCode: data?.exitCode ?? 0,
        truncated,
      };
    },
    fetch: async (url, options, signal) => {
      if ((options?.method && options.method !== 'GET') || options?.body !== undefined)
        throw new Error('Plugin fetch supports GET without a body only');
      return (await execute('WebFetch', { url }, signal)).content;
    },
  };
}
