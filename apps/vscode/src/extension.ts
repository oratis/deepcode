// VS Code extension entry — DeepCode "Chat" view + 3 commands.
// Spec: docs/DEVELOPMENT_PLAN.md §v1.1 (VS Code extension)

import type * as vscode from 'vscode';

// Type-only import to keep the build clean without @types/vscode installed
// during the M0 phase. Real `vscode` is injected by the host at activation.
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
      const composed = `${prompt}\n\n----- Selected code -----\n${selection}`;
      await runAgent(composed, vscodeMod);
    }),
    commands.registerCommand('deepcode.review', async () => {
      // Pipe current diff through code-review skill via runAgent.
      // Uses `git diff` from the workspace root.
      const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        void window.showInformationMessage('DeepCode: open a folder first.');
        return;
      }
      const prompt =
        'Review the current uncommitted diff. Cite file:line for each finding. ' +
        'Categorize as BUG / LATENT / SUGGESTION.';
      await runAgent(prompt, vscodeMod, root);
    }),
  );

  // ── Chat view provider ──────────────────────────────────────────────
  context.subscriptions.push(
    window.registerWebviewViewProvider('deepcode.chat', new ChatViewProvider(vscodeMod)),
  );
}

export function deactivate(): void {
  /* no-op */
}

// ──────────────────────────────────────────────────────────────────────────
// Real runAgent invocation — same @deepcode/core code drives CLI / Mac / LSP
// ──────────────────────────────────────────────────────────────────────────

async function runAgent(
  userMessage: string,
  vscodeMod: V,
  cwd: string = process.cwd(),
): Promise<void> {
  const out = vscodeMod.window.createOutputChannel('DeepCode');
  out.show(true);
  out.appendLine(`▎ DeepCode · ${new Date().toLocaleTimeString()}`);
  out.appendLine(`  ${userMessage.slice(0, 200)}${userMessage.length > 200 ? '…' : ''}`);
  out.appendLine('');
  try {
    const core = await import('@deepcode/core');
    const credsStore = new core.CredentialsStore();
    const creds = await core.resolveCredentials({ store: credsStore });
    if (!creds.apiKey && !creds.authToken) {
      out.appendLine(
        '✕ No DeepSeek credentials. Run `deepcode` once in a terminal to onboard, or set DEEPSEEK_API_KEY.',
      );
      return;
    }
    const provider = new core.DeepSeekProvider({
      apiKey: creds.apiKey ?? '',
      authToken: creds.authToken,
      baseURL: creds.baseURL,
    });
    await core.runAgent({
      provider,
      tools: new core.ToolRegistry(core.BUILTIN_TOOLS),
      systemPrompt: 'You are DeepCode, an AI coding assistant powered by DeepSeek. Be concise.',
      userMessage,
      model: 'deepseek-chat',
      cwd,
      onEvent: (e) => {
        if (e.type === 'text_delta') out.append(e.text);
        else if (e.type === 'tool_use') out.appendLine(`\n[${e.name}] ${formatInput(e.input)}`);
        else if (e.type === 'tool_result')
          out.appendLine(`  ${e.result.isError ? '✕' : '✓'} ${truncate(e.result.content, 200)}`);
        else if (e.type === 'error') out.appendLine(`\n✕ ${e.error}`);
      },
    });
    out.appendLine('\n');
  } catch (err) {
    out.appendLine(`\n✕ ${(err as Error).message ?? String(err)}`);
  }
}

function formatInput(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'command', 'pattern', 'path', 'url', 'query']) {
    const v = input[key];
    if (typeof v === 'string') return v;
  }
  return JSON.stringify(input).slice(0, 80);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly vscodeMod: V) {}

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
    if (msg.kind !== 'send' || !msg.text) return;
    try {
      const core = await import('@deepcode/core');
      const credsStore = new core.CredentialsStore();
      const creds = await core.resolveCredentials({ store: credsStore });
      if (!creds.apiKey && !creds.authToken) {
        view.webview.postMessage({
          kind: 'assistant',
          text: '(No DeepSeek credentials. Run `deepcode` in a terminal to onboard.)',
        });
        return;
      }
      const provider = new core.DeepSeekProvider({
        apiKey: creds.apiKey ?? '',
        authToken: creds.authToken,
        baseURL: creds.baseURL,
      });
      let buffer = '';
      await core.runAgent({
        provider,
        tools: new core.ToolRegistry(core.BUILTIN_TOOLS),
        systemPrompt: 'You are DeepCode, an AI coding assistant powered by DeepSeek. Be concise.',
        userMessage: msg.text,
        model: 'deepseek-chat',
        cwd: this.vscodeMod.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        onEvent: (e) => {
          if (e.type === 'text_delta') {
            buffer += e.text;
            view.webview.postMessage({ kind: 'assistant_stream', text: e.text });
          } else if (e.type === 'tool_use') {
            view.webview.postMessage({
              kind: 'tool',
              text: `[${e.name}] ${formatInput(e.input)}`,
            });
          } else if (e.type === 'tool_result') {
            view.webview.postMessage({
              kind: 'tool',
              text: (e.result.isError ? '✕ ' : '✓ ') + truncate(e.result.content, 200),
            });
          } else if (e.type === 'error') {
            view.webview.postMessage({ kind: 'assistant', text: `✕ ${e.error}` });
          }
        },
      });
      if (buffer) view.webview.postMessage({ kind: 'assistant_end' });
    } catch (err) {
      view.webview.postMessage({
        kind: 'assistant',
        text: `✕ ${(err as Error).message ?? String(err)}`,
      });
    }
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
