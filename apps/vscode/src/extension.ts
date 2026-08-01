// VS Code extension entry — thin UI over the shared app-server protocol.

import type * as vscode from 'vscode';
import { ProtocolClient, type ProtocolEvent } from '@deepcode/protocol';
import { SpawnedAppServerConnection } from '@deepcode/app-server/client';

import { EditorProtocolRuntime } from './protocol-runtime.js';
import { formatConfigDiagnostics } from './diagnostics.js';
import { explicitConfigValue } from './settings.js';
import { formatWorkspaceDiffForReview } from './workspace-diff.js';

type V = typeof import('vscode');

let activeRuntime: EditorProtocolRuntime | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const vscodeMod = await loadVscode();
  const { commands, window, workspace } = vscodeMod;
  const appServer = context.asAbsolutePath('dist/app-server.cjs');
  const runtime = new EditorProtocolRuntime(
    new ProtocolClient(
      new SpawnedAppServerConnection({ command: process.execPath, args: [appServer] }),
    ),
    () => workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
  );
  activeRuntime = runtime;

  context.subscriptions.push(
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
    window.registerWebviewViewProvider('deepcode.chat', new ChatViewProvider(vscodeMod, runtime)),
  );
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
    | string
    | undefined;
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly vscodeMod: V,
    private readonly runtime: EditorProtocolRuntime,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = chatHtml();
    view.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(view, message as { kind: string; text?: string });
    });
  }

  private async handleMessage(
    view: vscode.WebviewView,
    message: { kind: string; text?: string },
  ): Promise<void> {
    if (message.kind !== 'send' || !message.text) return;
    try {
      await this.runtime.start(modelInput(message.text, this.vscodeMod), (event) => {
        projectWebviewEvent(event, view);
        void respondToInteraction(event, this.vscodeMod, this.runtime);
      });
    } catch (error) {
      void view.webview.postMessage({
        kind: 'assistant',
        text: `✕ ${(error as Error).message ?? String(error)}`,
      });
    }
  }
}

function projectWebviewEvent(event: ProtocolEvent, view: vscode.WebviewView): void {
  switch (event.type) {
    case 'item.delta':
      void view.webview.postMessage({ kind: 'assistant_stream', text: event.delta });
      break;
    case 'tool.started':
      void view.webview.postMessage({
        kind: 'tool',
        text: `[${event.name}] ${formatInput(event.input)}`,
      });
      break;
    case 'tool.completed':
      void view.webview.postMessage({
        kind: 'tool',
        text: `${event.result.isError ? '✕' : '✓'} ${truncate(event.result.content, 200)}`,
      });
      break;
    case 'approval.requested':
      void view.webview.postMessage({
        kind: 'tool',
        text: `[approval] ${event.toolName}: ${event.reason}`,
      });
      break;
    case 'user-input.requested':
      void view.webview.postMessage({ kind: 'tool', text: `[input] ${event.question}` });
      break;
    case 'turn.completed':
    case 'turn.interrupted':
      void view.webview.postMessage({ kind: 'assistant_end' });
      break;
    case 'turn.failed':
      void view.webview.postMessage({
        kind: 'assistant',
        text: `✕ ${turnError(event.turn) ?? 'turn failed'}`,
      });
      break;
  }
}

function chatHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 8px; margin: 0; }
  #log { height: calc(100vh - 80px); overflow-y: auto; padding: 4px; }
  #log .msg { margin: 4px 0; padding: 6px 8px; border-radius: 3px; white-space: pre-wrap; }
  #log .user { background: var(--vscode-input-background); }
  #log .assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
  #log .tool { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  #composer { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px; background: var(--vscode-sideBar-background); border-top: 1px solid var(--vscode-panel-border); }
  #composer input { width: 100%; box-sizing: border-box; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
</style></head><body>
<div id="log"></div>
<div id="composer"><input id="msg" placeholder="Ask DeepCode…" autofocus></div>
<script>
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('msg');
  let streaming = null;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      const text = input.value;
      input.value = '';
      append('user', text);
      vscode.postMessage({ kind: 'send', text });
    }
  });
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.kind === 'assistant_stream') {
      if (!streaming) streaming = append('assistant', '');
      streaming.textContent += m.text;
      log.scrollTop = log.scrollHeight;
    } else if (m.kind === 'assistant_end') {
      streaming = null;
    } else if (m.kind === 'tool') {
      append('tool', m.text);
    } else if (m.kind === 'assistant') {
      append('assistant', m.text);
      streaming = null;
    }
  });
  function append(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
</script>
</body></html>`;
}

async function loadVscode(): Promise<V> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('vscode') as V;
}
