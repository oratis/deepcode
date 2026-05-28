// Mac-flavored ToolHandler implementations.
//
// @deepcode/core's BUILTIN_TOOLS use node:fs / node:child_process which
// don't work in a Tauri webview. These wrappers expose the same
// ToolHandler interface but route through Tauri commands that execute
// fs / bash in the Rust main process.
//
// The agent loop (also from @deepcode/core) is provider-agnostic AND
// IO-agnostic — it just calls `tool.execute(input, ctx)` and the tool
// handles the rest. So substituting these tools is enough.

import { invoke } from '@tauri-apps/api/core';
import type { ToolHandler, ToolResult } from '@deepcode/core/dist/types.js';

// ──────────────────────────────────────────────────────────────────────────
// Read
// ──────────────────────────────────────────────────────────────────────────

export const MacReadTool: ToolHandler = {
  name: 'Read',
  definition: {
    name: 'Read',
    description:
      'Read a file from the filesystem. Returns line-numbered content. Use offset/limit for large files.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path or path relative to cwd.' },
        offset: { type: 'number', description: '1-indexed line to start at.' },
        limit: { type: 'number', description: 'Max lines to return (default 2000).' },
      },
      required: ['file_path'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const r = (await invoke('tool_read', {
        filePath: input['file_path'] as string,
        offset: input['offset'] as number | undefined,
        limit: input['limit'] as number | undefined,
      })) as { content: string; linesTotal: number; linesShown: number; offset: number };
      return {
        content: r.content,
        data: {
          file: input['file_path'],
          lines_total: r.linesTotal,
          lines_shown: r.linesShown,
          offset: r.offset,
        },
      };
    } catch (err) {
      return { content: `Error: ${(err as Error).message ?? String(err)}`, isError: true };
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Write
// ──────────────────────────────────────────────────────────────────────────

export const MacWriteTool: ToolHandler = {
  name: 'Write',
  definition: {
    name: 'Write',
    description:
      'Write content to a file. Creates parent directories if needed. Overwrites if file exists.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path.' },
        content: { type: 'string', description: 'Full file contents to write.' },
      },
      required: ['file_path', 'content'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      await invoke('tool_write', {
        filePath: input['file_path'] as string,
        content: input['content'] as string,
      });
      const lines = String(input['content'] ?? '').split('\n').length;
      return {
        content: `Wrote ${input['file_path']} (${lines} lines).`,
        data: { file: input['file_path'], lines },
      };
    } catch (err) {
      return { content: `Error: ${(err as Error).message ?? String(err)}`, isError: true };
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Edit
// ──────────────────────────────────────────────────────────────────────────

export const MacEditTool: ToolHandler = {
  name: 'Edit',
  definition: {
    name: 'Edit',
    description:
      'Replace exact `old_string` with `new_string` in a file. By default, old_string must be unique in the file (use replace_all=true to replace every occurrence).',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean', description: 'Default false.' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const r = (await invoke('tool_edit', {
        input: {
          file_path: input['file_path'] as string,
          old_string: input['old_string'] as string,
          new_string: input['new_string'] as string,
          replace_all: (input['replace_all'] as boolean | undefined) ?? false,
        },
      })) as { replaced: number; diffPreview: string };
      return {
        content: `Replaced ${r.replaced} occurrence(s) in ${input['file_path']}.\n${r.diffPreview}`,
        data: { file: input['file_path'], replaced: r.replaced },
      };
    } catch (err) {
      return { content: `Error: ${(err as Error).message ?? String(err)}`, isError: true };
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Bash
// ──────────────────────────────────────────────────────────────────────────

export const MacBashTool: ToolHandler = {
  name: 'Bash',
  definition: {
    name: 'Bash',
    description:
      'Execute a shell command. Returns stdout + stderr + exit code. Default timeout 120s.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'Optional working directory.' },
        timeout_ms: { type: 'number', description: 'Optional timeout in milliseconds.' },
      },
      required: ['command'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const r = (await invoke('tool_bash', {
        input: {
          command: input['command'] as string,
          cwd: input['cwd'] as string | undefined,
          timeout_ms: input['timeout_ms'] as number | undefined,
        },
      })) as { stdout: string; stderr: string; exitCode: number; timedOut: boolean };
      const combined =
        (r.stdout || '') + (r.stderr ? `\n[stderr]\n${r.stderr}` : '');
      return {
        content: combined || `(no output, exit ${r.exitCode})`,
        data: { exitCode: r.exitCode, timedOut: r.timedOut },
        isError: r.exitCode !== 0,
      };
    } catch (err) {
      return { content: `Error: ${(err as Error).message ?? String(err)}`, isError: true };
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Glob
// ──────────────────────────────────────────────────────────────────────────

export const MacGlobTool: ToolHandler = {
  name: 'Glob',
  definition: {
    name: 'Glob',
    description: 'Find files matching a glob pattern (e.g. `**/*.ts`).',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        cwd: { type: 'string', description: 'Optional working directory; defaults to current.' },
      },
      required: ['pattern'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const r = (await invoke('tool_glob', {
        pattern: input['pattern'] as string,
        cwd: input['cwd'] as string | undefined,
      })) as { files: string[]; truncated: boolean };
      const body =
        r.files.length === 0
          ? '(no matches)'
          : r.files.join('\n') + (r.truncated ? `\n[...truncated at 1000]` : '');
      return { content: body, data: { count: r.files.length, truncated: r.truncated } };
    } catch (err) {
      return { content: `Error: ${(err as Error).message ?? String(err)}`, isError: true };
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Grep
// ──────────────────────────────────────────────────────────────────────────

export const MacGrepTool: ToolHandler = {
  name: 'Grep',
  definition: {
    name: 'Grep',
    description: 'Search for a regex/string pattern recursively. Returns file:line:text.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: 'Optional dir to search; defaults to cwd.' },
        include: {
          type: 'string',
          description: 'Optional file pattern (e.g. `*.ts`) to restrict matches.',
        },
        case_insensitive: { type: 'boolean' },
      },
      required: ['pattern'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const r = (await invoke('tool_grep', {
        input: {
          pattern: input['pattern'] as string,
          path: input['path'] as string | undefined,
          include: input['include'] as string | undefined,
          case_insensitive: (input['case_insensitive'] as boolean | undefined) ?? false,
        },
      })) as {
        matches: Array<{ file: string; line: number; text: string }>;
        truncated: boolean;
      };
      if (r.matches.length === 0) return { content: '(no matches)' };
      const lines = r.matches.map((m) => `${m.file}:${m.line}: ${m.text}`);
      if (r.truncated) lines.push('[...truncated at 500 matches]');
      return { content: lines.join('\n'), data: { count: r.matches.length } };
    } catch (err) {
      return { content: `Error: ${(err as Error).message ?? String(err)}`, isError: true };
    }
  },
};

/** All 6 Mac-flavored tools — pass as `tools` to `new ToolRegistry(MAC_TOOLS)`. */
export const MAC_TOOLS: ToolHandler[] = [
  MacReadTool,
  MacWriteTool,
  MacEditTool,
  MacBashTool,
  MacGlobTool,
  MacGrepTool,
];
