// VS Code extension entry — DeepCode "Chat" view + 3 commands.
// Spec: docs/DEVELOPMENT_PLAN.md §v1.1 (VS Code extension)
//
// Build with: pnpm --filter @deepcode/vscode package (after vsce installed)
// The extension talks to @deepcode/core directly — no IPC, because the
// extension host is a Node process. For long-running agent loops we
// dispatch to a separate child process; this skeleton uses in-process.

import type * as vscode from 'vscode';

// We import lazily so the file type-checks without @types/vscode installed.
type V = typeof import('vscode');

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const vscodeMod = await loadVscode();
  const { commands, window, workspace } = vscodeMod;

  // ── Commands ────────────────────────────────────────────────────────
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
      await runHeadless(prompt, selection, vscodeMod);
    }),
    commands.registerCommand('deepcode.review', async () => {
      // Pipe current diff through code-review skill via headless mode.
      // Skeleton: just open a doc with the placeholder.
      const doc = await workspace.openTextDocument({
        content: '# DeepCode review\n\n(Real wiring lands in v1.1-rest — runs `deepcode -p "review this diff"` on git diff.)',
        language: 'markdown',
      });
      await window.showTextDocument(doc);
    }),
  );

  // ── Chat view provider ──────────────────────────────────────────────
  context.subscriptions.push(
    window.registerWebviewViewProvider('deepcode.chat', new ChatViewProvider(context)),
  );
}

export function deactivate(): void {
  /* no-op */
}

// ──────────────────────────────────────────────────────────────────────────
// Headless run via @deepcode/core — same agent loop the CLI uses
// ──────────────────────────────────────────────────────────────────────────

async function runHeadless(prompt: string, selection: string, vscodeMod: V): Promise<void> {
  // Lazy import to avoid bundling @deepcode/core into the extension's
  // activation path until we know the user actually triggered DeepCode.
  // (Real implementation lands in v1.1-rest; this is the wire shape.)
  const composed = `${prompt}\n\n----- Selected code -----\n${selection}`;
  vscodeMod.window.showInformationMessage(
    `DeepCode would now run a turn with: "${composed.slice(0, 80)}…"`,
  );
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = chatHtml();
    view.webview.onDidReceiveMessage((msg: unknown) => {
      void this.handleMessage(view, msg as { kind: string; text?: string });
    });
  }

  private async handleMessage(
    view: vscode.WebviewView,
    msg: { kind: string; text?: string },
  ): Promise<void> {
    if (msg.kind === 'send' && msg.text) {
      // Wire to runAgent in v1.1-rest.
      view.webview.postMessage({
        kind: 'assistant',
        text: '(skeleton — chat IPC lands with the @deepcode/core in-extension-host wiring.)',
      });
    }
  }
}

function chatHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 8px; margin: 0; }
  #log { height: calc(100vh - 80px); overflow-y: auto; padding: 4px; }
  #log .msg { margin: 4px 0; padding: 4px; border-radius: 3px; }
  #log .user { background: var(--vscode-input-background); }
  #log .assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
  #composer { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px; background: var(--vscode-sideBar-background); border-top: 1px solid var(--vscode-panel-border); }
  #composer input { width: 100%; box-sizing: border-box; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
</style></head><body>
<div id="log"></div>
<div id="composer"><input id="msg" placeholder="Ask DeepCode…" autofocus></div>
<script>
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('msg');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      const text = input.value;
      input.value = '';
      log.innerHTML += '<div class="msg user">' + escapeHtml(text) + '</div>';
      vscode.postMessage({ kind: 'send', text });
      log.scrollTop = log.scrollHeight;
    }
  });
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.kind === 'assistant') {
      log.innerHTML += '<div class="msg assistant">' + escapeHtml(m.text) + '</div>';
      log.scrollTop = log.scrollHeight;
    }
  });
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
</script>
</body></html>`;
}

async function loadVscode(): Promise<V> {
  // VS Code injects this at extension activation time. Type-only import so
  // the package builds without `@types/vscode` installed during M0 phase.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('vscode') as V;
}
