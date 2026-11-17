// VS Code extension entry — thin UI over the shared app-server protocol.

import type * as vscode from 'vscode';
import {
  isReviewFindingPayload,
  type ProtocolEvent,
  type ReviewActionPayload,
  type ReviewFindingPayload,
} from '@deepcode/protocol';
import { SpawnedAppServerConnection } from '@deepcode/app-server/client';

import { EditorProtocolRuntime } from './protocol-runtime.js';
import { EditorAppServerClient } from './editor-client.js';
import { ChatPanelController } from './chat-panel.js';
import { chatHtml } from './chat-html.js';
import { formatConfigDiagnostics } from './diagnostics.js';
import { explicitConfigValue } from './settings.js';
import { formatWorkspaceDiffForReview } from './workspace-diff.js';

type V = typeof import('vscode');

let activeRuntime: EditorProtocolRuntime | undefined;
const latestReviewFindings = new Map<string, ReviewFindingPayload>();
let latestAppliedActionId: string | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const vscodeMod = await loadVscode();
  const { commands, window, workspace } = vscodeMod;
  const appServer = context.asAbsolutePath('dist/app-server.cjs');
  const runtime = new EditorProtocolRuntime(
    new EditorAppServerClient(
      new SpawnedAppServerConnection({ command: process.execPath, args: [appServer] }),
    ),
    () => workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
  );
  activeRuntime = runtime;
  const chatView = new ChatViewProvider(vscodeMod, runtime);

  context.subscriptions.push(
    chatView,
    commands.registerCommand('deepcode.openPanel', () => {
      void commands.executeCommand('workbench.view.extension.deepcode');
    }),
    commands.registerCommand('deepcode.run', async () => {
      const editor = window.activeTextEditor;
      if (!editor) {
        void window.showInformationMessage('DeepCode: no active editor.');
        return;
      }
      const selection = editor.document.getText(editor.selection);
      if (!selection.trim()) {
        void window.showInformationMessage('DeepCode: select some text first.');
        return;
      }
      const prompt = await window.showInputBox({
        prompt: 'Ask DeepCode about the selection',
        value: 'Explain this code.',
      });
      if (!prompt) return;
      await runInOutput(`${prompt}\n\n----- Selected code -----\n${selection}`, vscodeMod, runtime);
    }),
    commands.registerCommand('deepcode.review', async () => {
      if (!workspace.workspaceFolders?.[0]) {
        void window.showInformationMessage('DeepCode: open a folder first.');
        return;
      }
      try {
        latestReviewFindings.clear();
        const diff = await runtime.diff();
        if (!diff.repository || diff.files.length === 0) {
          void window.showInformationMessage('DeepCode: no uncommitted changes to review.');
          return;
        }
        await runInOutput(
          'Review the canonical workspace diff below. Cite file:line for each finding. ' +
            'Categorize as BUG / LATENT / SUGGESTION.\n\n' +
            formatWorkspaceDiffForReview(diff),
          vscodeMod,
          runtime,
        );
      } catch (error) {
        void window.showErrorMessage(
          `DeepCode review failed: ${(error as Error).message ?? String(error)}`,
        );
      }
    }),
    commands.registerCommand(
      'deepcode.applyReviewFinding',
      async (finding: ReviewFindingPayload | undefined) => {
        if (!finding?.findingId) {
          void window.showErrorMessage('DeepCode: a review finding is required.');
          return;
        }
        await runFindingsInOutput([finding], vscodeMod, runtime);
      },
    ),
    commands.registerCommand('deepcode.applyAllReviewFindings', async () => {
      const findings = [...latestReviewFindings.values()];
      if (findings.length === 0) {
        void window.showInformationMessage('DeepCode: no review findings to apply.');
        return;
      }
      await runFindingsInOutput(findings, vscodeMod, runtime);
    }),
    commands.registerCommand(
      'deepcode.revertReviewAction',
      async (action: Pick<ReviewActionPayload, 'actionId'> | undefined) => {
        const actionId = action?.actionId ?? latestAppliedActionId;
        if (!actionId) {
          void window.showInformationMessage('DeepCode: no applied review action to revert.');
          return;
        }
        await runRevertInOutput(actionId, vscodeMod, runtime);
      },
    ),
    commands.registerCommand('deepcode.showDiagnostics', async () => {
      const out = window.createOutputChannel('DeepCode Diagnostics');
      out.show(true);
      try {
        const report = await runtime.diagnostics();
        for (const line of formatConfigDiagnostics(report)) out.appendLine(line);
      } catch (error) {
        out.appendLine(`✕ ${(error as Error).message ?? String(error)}`);
      }
    }),
    window.registerWebviewViewProvider('deepcode.chat', chatView),
  );
}

async function runFindingsInOutput(
  findings: ReviewFindingPayload[],
  vscodeMod: V,
  runtime: EditorProtocolRuntime,
): Promise<void> {
  const out = vscodeMod.window.createOutputChannel('DeepCode');
  out.show(true);
  out.appendLine(
    findings.length === 1
      ? `Applying review finding: ${findings[0]!.title}`
      : `Applying ${findings.length} review findings`,
  );
  try {
    await runtime.applyFindings(findings, (event) => {
      projectOutputEvent(event, out);
      void respondToInteraction(event, vscodeMod, runtime);
    });
  } catch (error) {
    out.appendLine(`\n✕ ${(error as Error).message ?? String(error)}`);
  }
}

async function runRevertInOutput(
  actionId: string,
  vscodeMod: V,
  runtime: EditorProtocolRuntime,
): Promise<void> {
  const out = vscodeMod.window.createOutputChannel('DeepCode');
  out.show(true);
  out.appendLine(`Reverting review action: ${actionId}`);
  try {
    await runtime.revertAction(actionId, (event) => {
      projectOutputEvent(event, out);
      void respondToInteraction(event, vscodeMod, runtime);
    });
  } catch (error) {
    out.appendLine(`\n✕ ${(error as Error).message ?? String(error)}`);
  }
}

export async function deactivate(): Promise<void> {
  const runtime = activeRuntime;
  activeRuntime = undefined;
  await runtime?.close();
}

async function runInOutput(
  userMessage: string,
  vscodeMod: V,
  runtime: EditorProtocolRuntime,
): Promise<void> {
  const out = vscodeMod.window.createOutputChannel('DeepCode');
  out.show(true);
  out.appendLine(`▎ DeepCode · ${new Date().toLocaleTimeString()}`);
  out.appendLine(`  ${truncate(userMessage, 200)}`);
  out.appendLine('');
  try {
    await runtime.start(modelInput(userMessage, vscodeMod), (event) => {
      projectOutputEvent(event, out);
      void respondToInteraction(event, vscodeMod, runtime);
    });
  } catch (error) {
    out.appendLine(`\n✕ ${(error as Error).message ?? String(error)}`);
  }
}

function modelInput(text: string, vscodeMod: V) {
  const config = vscodeMod.workspace.getConfiguration('deepcode');
  const model = explicitConfigValue(config.inspect<string>('model'));
  const effort = explicitConfigValue(config.inspect<string>('effort'));
  return {
    text,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  };
}

function projectOutputEvent(event: ProtocolEvent, out: vscode.OutputChannel): void {
  switch (event.type) {
    case 'item.delta':
      out.append(event.delta);
      break;
    case 'tool.started':
      out.appendLine(`\n[${event.name}] ${formatInput(event.input)}`);
      break;
    case 'tool.completed':
      out.appendLine(
        `  ${event.result.isError ? '✕' : '✓'} ${truncate(event.result.content, 200)}`,
      );
      break;
    case 'approval.requested':
      out.appendLine(`\n[approval] ${event.toolName}: ${event.reason}`);
      break;
    case 'user-input.requested':
      out.appendLine(`\n[input] ${event.question}`);
      break;
    case 'turn.completed':
      out.appendLine('\n');
      break;
    case 'turn.interrupted':
      out.appendLine('\n⏹ interrupted\n');
      break;
    case 'turn.failed':
      out.appendLine(`\n✕ ${turnError(event.turn) ?? 'turn failed'}\n`);
      break;
    case 'item.completed':
      if (event.item.type === 'review_finding') {
        const finding = event.item.payload;
        if (isReviewFindingPayload(finding)) {
          latestReviewFindings.set(finding.findingId, finding);
        }
        out.appendLine(
          `\n[P${String(finding.priority)}] ${String(finding.title)} — ${String(finding.path)}:${String(finding.startLine)}`,
        );
        out.appendLine(`  ${String(finding.body)}`);
      } else if (event.item.type === 'review_action') {
        if (
          event.item.payload.kind === 'apply' &&
          typeof event.item.payload.actionId === 'string'
        ) {
          latestAppliedActionId = event.item.payload.actionId;
        }
        out.appendLine(
          `\n[review action] ${String(event.item.payload.kind)} ${String(
            (event.item.payload.findingIds as unknown[] | undefined)?.length ?? 0,
          )} finding(s)`,
        );
      }
      break;
  }
}

async function respondToInteraction(
  event: ProtocolEvent,
  vscodeMod: V,
  runtime: EditorProtocolRuntime,
): Promise<void> {
  if (event.type === 'approval.requested') {
    const choice = await vscodeMod.window.showWarningMessage(
      `${event.toolName}: ${event.reason}`,
      'Allow once',
      'Deny',
      'Always allow',
    );
    const decision =
      choice === 'Always allow' ? 'always' : choice === 'Allow once' ? 'allow' : 'deny';
    await runtime.approve(event.turnId, event.requestId, decision);
  } else if (event.type === 'user-input.requested') {
    const answer = event.options.length
      ? await vscodeMod.window.showQuickPick(
          event.options.map((option) => ({ label: option.label, description: option.description })),
          { placeHolder: event.question },
        )
      : await vscodeMod.window.showInputBox({ prompt: event.question });
    await runtime.answer(
      event.turnId,
      event.requestId,
      typeof answer === 'string' ? answer : (answer?.label ?? ''),
    );
  }
}

function formatInput(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'command', 'pattern', 'path', 'url', 'query']) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return JSON.stringify(input).slice(0, 80);
}

function turnError(turn: Extract<ProtocolEvent, { type: 'turn.failed' }>['turn']) {
  return [...turn.items].reverse().find((item) => item.type === 'error')?.payload.message as
    string | undefined;
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly panel: ChatPanelController;

  constructor(vscodeMod: V, runtime: EditorProtocolRuntime) {
    this.panel = new ChatPanelController(
      runtime,
      (message) => {
        void this.view?.webview.postMessage(message);
      },
      (text) => modelInput(text, vscodeMod),
      (event) => respondToInteraction(event, vscodeMod, runtime),
    );
  }

  dispose(): void {
    this.panel.dispose();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const receiver = view.webview.onDidReceiveMessage((message: unknown) => {
      void this.panel.receive(message);
    });
    view.onDidDispose(() => {
      receiver.dispose();
      if (this.view === view) this.view = undefined;
    });
    view.webview.html = chatHtml();
  }
}

async function loadVscode(): Promise<V> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('vscode') as V;
}
