import { randomBytes } from 'node:crypto';

/** No runtime values or model output are interpolated into executable HTML. */
export function chatHtml(): string {
  const nonce = randomBytes(18).toString('base64');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  * { box-sizing: border-box; }
  body { font: 13px/1.55 var(--vscode-font-family, system-ui, sans-serif); color: var(--vscode-foreground, #dedfe4); background: var(--vscode-sideBar-background, #191b20); margin: 0; height: 100vh; display: flex; flex-direction: column; }
  button, textarea { font: inherit; }
  button { white-space: nowrap; cursor: pointer; border: 1px solid transparent; border-radius: 5px; padding: 5px 12px; color: var(--vscode-button-foreground, white); background: var(--vscode-button-background, #536bd9); }
  button:hover { background: var(--vscode-button-hoverBackground, #667eea); }
  button:disabled { opacity: .5; cursor: default; }
  :focus-visible { outline: 2px solid var(--vscode-focusBorder, #88aaff); outline-offset: 3px; }
  header { padding: 15px 16px 12px; border-bottom: 1px solid var(--vscode-panel-border, #30333b); }
  .brand { font-size: 15px; font-weight: 650; letter-spacing: -.3px; }
  .eyebrow { text-transform: uppercase; letter-spacing: .09em; font-size: 10px; color: var(--vscode-descriptionForeground, #a9aebc); }
  #thread { font-size: 11px; color: var(--vscode-descriptionForeground, #a9aebc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }
  #log { min-height: 0; flex: 1; overflow-y: auto; overflow-x: hidden; padding: 18px 16px; scroll-behavior: auto; }
  #empty { margin: 24px 0; }
  #empty h1 { font-size: 20px; line-height: 1.25; font-weight: 550; letter-spacing: -.5px; margin: 12px 0; }
  #empty p { color: var(--vscode-descriptionForeground, #a9aebc); margin: 0; }
  .msg { margin-bottom: 20px; overflow-wrap: anywhere; }
  .msg .label { margin-bottom: 5px; font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground, #a9aebc); }
  .msg .content { white-space: pre-wrap; }
  .msg.user { padding: 11px 13px; background: var(--vscode-input-background, #252832); border: 1px solid var(--vscode-panel-border, #30333b); border-radius: 9px; }
  .msg.notice { border-left: 2px solid var(--vscode-panel-border, #444957); padding-left: 10px; font-size: 12px; color: var(--vscode-descriptionForeground, #a9aebc); }
  .msg.error { padding: 10px; border: 1px solid var(--vscode-inputValidation-errorBorder, #be6262); border-radius: 6px; }
  .msg.error .label { color: var(--vscode-errorForeground, #f28b82); }
  details.tool { margin: 0 0 12px; border: 1px solid var(--vscode-panel-border, #30333b); border-radius: 7px; background: var(--vscode-editor-background, #202229); overflow: hidden; }
  .tool summary { cursor: pointer; padding: 10px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 4px 10px; }
  .tool-name { font-weight: 600; overflow-wrap: anywhere; }
  .tool-name::before { content: '▸ '; color: var(--vscode-descriptionForeground, #a9aebc); }
  .tool[open] .tool-name::before { content: '▾ '; }
  .tool-summary { grid-column: 1 / -1; font: 11px/1.5 var(--vscode-editor-font-family, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground, #a9aebc); }
  .tool-status { font-size: 10px; color: var(--vscode-descriptionForeground, #a9aebc); }
  .tool[data-status="failed"] .tool-status { color: var(--vscode-errorForeground, #f28b82); }
  .tool-body { border-top: 1px solid var(--vscode-panel-border, #30333b); padding: 10px; }
  .tool-body pre { font: 11px/1.6 var(--vscode-editor-font-family, monospace); white-space: pre-wrap; overflow-wrap: anywhere; margin: 5px 0 12px; max-height: 260px; overflow-y: auto; }
  #jump { align-self: center; margin: -8px 0 8px; font-size: 11px; }
  #composer { flex-shrink: 0; padding: 10px 12px 12px; border-top: 1px solid var(--vscode-panel-border, #30333b); }
  #status-line { display: flex; align-items: center; gap: 7px; margin: 0 2px 8px; font-size: 11px; }
  #status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-descriptionForeground, #a9aebc); }
  body[data-busy="true"] #status-dot { background: var(--vscode-progressBar-background, #718aff); }
  #usage { margin-left: auto; color: var(--vscode-descriptionForeground, #a9aebc); }
  #detail { font-size: 11px; color: var(--vscode-descriptionForeground, #a9aebc); margin: 0 2px 8px; }
  textarea { width: 100%; resize: vertical; min-height: 72px; max-height: 190px; padding: 10px; color: var(--vscode-input-foreground, #e5e7ef); background: var(--vscode-input-background, #252832); border: 1px solid var(--vscode-input-border, #3b404e); border-radius: 7px; }
  .composer-actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; }
  .hint { font-size: 10px; color: var(--vscode-descriptionForeground, #a9aebc); }
  #stop { color: var(--vscode-button-secondaryForeground, white); background: var(--vscode-button-secondaryBackground, #3c414d); }
  [hidden] { display: none !important; }
  @media (max-width: 320px) { .hint { display: none; } #usage { display: none; } header, #log { padding-left: 10px; padding-right: 10px; } }
</style></head><body>
<header><div class="brand">DeepCode</div><div id="thread" title="A conversation in the current workspace">Workspace conversation</div></header>
<main id="log" aria-label="Conversation timeline" tabindex="0">
  <section id="empty"><div class="eyebrow">Your coding workspace</div><h1>What are we working on?</h1><p>Ask a question, investigate a problem, or describe a change. Tool activity and approval requests appear here.</p></section>
</main>
<button id="jump" type="button" hidden>Jump to latest ↓</button>
<form id="composer">
  <div id="status-line"><span id="status-dot" aria-hidden="true"></span><span id="status" role="status" aria-live="polite">Ready</span><span id="usage"></span></div>
  <p id="detail" hidden></p>
  <textarea id="msg" aria-label="Message DeepCode" placeholder="Ask DeepCode…" rows="3"></textarea>
  <div class="composer-actions"><span class="hint">Enter to send · Shift+Enter for a new line</span><button id="send" type="submit" disabled>Send ↑</button><button id="stop" type="button" hidden>Stop ■</button></div>
</form>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const empty = document.getElementById('empty');
  const input = document.getElementById('msg');
  const send = document.getElementById('send');
  const stop = document.getElementById('stop');
  const jump = document.getElementById('jump');
  const messages = new Map();
  const tools = new Map();
  let busy = false;
  let follow = true;
  const labels = { ready: 'Ready', starting: 'Starting', working: 'Working', approval: 'Awaiting approval', input: 'Awaiting input', cancelling: 'Cancelling', completed: 'Completed', interrupted: 'Interrupted', disconnected: 'Disconnected', failed: 'Failed' };
  const draft = vscode.getState();
  if (draft && typeof draft.text === 'string') input.value = draft.text;
  const updateSend = () => { send.disabled = busy || !input.value.trim(); };
  input.addEventListener('input', () => { updateSend(); vscode.setState({ text: input.value }); });
  document.getElementById('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || !input.value.trim()) return;
    const text = input.value;
    input.value = '';
    vscode.setState({ text: '' });
    setStatus('starting');
    follow = true;
    vscode.postMessage({ kind: 'send', text });
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      document.getElementById('composer').requestSubmit();
    }
  });
  stop.addEventListener('click', () => { setStatus('cancelling'); vscode.postMessage({ kind: 'stop' }); });
  log.addEventListener('scroll', () => { follow = log.scrollHeight - log.scrollTop - log.clientHeight < 48; jump.hidden = follow; });
  jump.addEventListener('click', () => { follow = true; log.scrollTop = log.scrollHeight; jump.hidden = true; });
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (!m || typeof m.kind !== 'string') return;
    if (m.kind === 'reset') {
      for (const item of log.querySelectorAll('.msg, .tool')) item.remove();
      messages.clear(); tools.clear(); empty.hidden = false;
    } else if (m.kind === 'status') setStatus(m.status, m.detail);
    else if (m.kind === 'thread') {
      const thread = document.getElementById('thread');
      thread.textContent = 'Conversation · ' + m.id.slice(0, 18);
      thread.title = m.id;
    } else if (m.kind === 'usage') {
      document.getElementById('usage').textContent = m.inputTokens.toLocaleString() + ' in · ' + m.outputTokens.toLocaleString() + ' out';
    } else if (m.kind === 'delta') {
      const content = message(m.id, 'assistant', '');
      content.textContent += m.text;
    } else if (m.kind === 'message') {
      message(m.id, m.role, m.text).textContent = m.text;
    } else if (m.kind === 'tool') renderTool(m);
    if (follow) log.scrollTop = log.scrollHeight;
    else jump.hidden = false;
  });
  function setStatus(status, detail) {
    busy = ['starting', 'working', 'approval', 'input', 'cancelling'].includes(status);
    document.body.dataset.busy = String(busy);
    document.getElementById('status').textContent = labels[status] || status;
    if (status === 'starting') document.getElementById('usage').textContent = '';
    const restoreFocus = document.activeElement === stop;
    const note = document.getElementById('detail');
    note.textContent = detail || '';
    note.hidden = !detail;
    send.hidden = busy; stop.hidden = !busy; stop.disabled = status === 'cancelling';
    stop.textContent = status === 'cancelling' ? 'Cancelling…' : 'Stop ■';
    if (!busy && restoreFocus) input.focus();
    updateSend();
  }
  function message(id, role, text) {
    if (messages.has(id)) return messages.get(id);
    empty.hidden = true;
    const item = document.createElement('article');
    item.className = 'msg ' + role;
    if (role === 'error') item.setAttribute('role', 'alert');
    const label = document.createElement('div');
    label.className = 'label'; label.textContent = { user: 'You', assistant: 'DeepCode', notice: 'Activity', error: 'Error' }[role];
    const content = document.createElement('div'); content.className = 'content'; content.textContent = text;
    item.append(label, content); log.appendChild(item); messages.set(id, content);
    return content;
  }
  function renderTool(m) {
    empty.hidden = true;
    let card = tools.get(m.id);
    if (!card) {
      const item = document.createElement('details'); item.className = 'tool';
      const summary = document.createElement('summary');
      const name = document.createElement('span'); name.className = 'tool-name'; name.textContent = m.name || 'Tool';
      const status = document.createElement('span'); status.className = 'tool-status';
      const brief = document.createElement('span'); brief.className = 'tool-summary'; brief.textContent = m.summary || '';
      summary.append(name, status, brief);
      const body = document.createElement('div'); body.className = 'tool-body';
      const inputLabel = document.createElement('div'); inputLabel.className = 'eyebrow'; inputLabel.textContent = 'Input';
      const input = document.createElement('pre'); input.textContent = m.input || 'Not reported';
      const outputLabel = document.createElement('div'); outputLabel.className = 'eyebrow'; outputLabel.textContent = 'Result';
      const output = document.createElement('pre'); output.textContent = 'Waiting for a result…';
      body.append(inputLabel, input, outputLabel, output); item.append(summary, body); log.appendChild(item);
      card = { item, name, status, brief, input, output }; tools.set(m.id, card);
    }
    card.item.dataset.status = m.status;
    card.status.textContent = { running: 'Running', completed: 'Completed', failed: 'Failed', unsettled: 'Result unknown' }[m.status];
    if (m.name) card.name.textContent = m.name;
    if (m.summary) card.brief.textContent = m.summary;
    if (m.input) card.input.textContent = m.input;
    if (m.output !== undefined) card.output.textContent = m.output;
  }
  updateSend();
  vscode.postMessage({ kind: 'ready' });
</script></body></html>`;
}
