// EnterWorktree / ExitWorktree tools — run the agent in an isolated git worktree.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.5 / §0.1 (parity tools)
//
// EnterWorktree creates a git worktree off the current repo and switches the
// agent's cwd into it, so subsequent file/Bash tools operate in isolation.
// ExitWorktree removes it and restores the original cwd. The active worktree is
// tracked on ctx.worktree (mutated in place). CLI-only — the renderer uses its
// own MAC_TOOLS set.

import { createWorktree, removeWorktree } from '../worktree/index.js';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface EnterInput {
  branch?: string;
}

export const EnterWorktreeTool: ToolHandler = {
  name: 'EnterWorktree',
  definition: {
    name: 'EnterWorktree',
    description:
      'Create an isolated git worktree off the current repo and switch into it, so subsequent Read/Write/Edit/Bash operate there (not on the main checkout). Use for risky/experimental changes you want isolated on a branch. Call ExitWorktree when done. Optionally name the `branch` (defaults to dc/<random>).',
    inputSchema: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Branch name for the worktree (optional).' },
      },
      required: [],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as EnterInput;
    if (ctx.worktree) {
      return {
        content: `Already in a worktree (${ctx.worktree.path}). Call ExitWorktree before entering another.`,
        isError: true,
      };
    }
    // Always branch off the original repo, never a nested worktree.
    const source = ctx.cwd;
    try {
      const handle = await createWorktree({ source, branch: input.branch });
      ctx.worktree = { ...handle, originalCwd: ctx.cwd };
      ctx.cwd = handle.path;
      return {
        content: `Entered worktree on branch "${handle.branch}" at:\n${handle.path}\nSubsequent file/Bash tools now operate here. Call ExitWorktree when done.`,
        data: { path: handle.path, branch: handle.branch },
      };
    } catch (err) {
      return { content: `Error creating worktree: ${(err as Error).message}`, isError: true };
    }
  },
};

export const ExitWorktreeTool: ToolHandler = {
  name: 'ExitWorktree',
  definition: {
    name: 'ExitWorktree',
    description:
      'Leave the current git worktree (entered via EnterWorktree): remove the worktree dir and restore the original working directory. The branch is left intact for you to merge/inspect.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  async execute(_rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.worktree) {
      return { content: 'Not currently in a worktree.', isError: true };
    }
    const { path, branch, source, originalCwd } = ctx.worktree;
    try {
      await removeWorktree({ path, branch, source });
    } catch (err) {
      return { content: `Error removing worktree: ${(err as Error).message}`, isError: true };
    }
    ctx.cwd = originalCwd;
    ctx.worktree = undefined;
    return {
      content: `Exited worktree; restored cwd to ${originalCwd}. Branch "${branch}" was kept.`,
      data: { branch, restoredCwd: originalCwd },
    };
  },
};
