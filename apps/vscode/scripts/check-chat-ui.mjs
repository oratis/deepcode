// Actual webview HTML, exercised with a mocked VS Code bridge in Chromium.
// Requires Node 22, --experimental-strip-types, and the desktop workspace's
// existing @playwright/test dependency. Install its Chromium browser or use
// PLAYWRIGHT_CHANNEL=chrome for a locally installed Chrome. No provider is called.
// UI_EVIDENCE_DIR overrides the default /tmp/deepcode-ui-evidence output directory.
import { chromium } from '../../desktop/node_modules/@playwright/test/index.mjs';
import { chatHtml } from '../src/chat-html.ts';
import { mkdir } from 'node:fs/promises';
/* global window, document, MessageEvent, innerWidth */
import assert from 'node:assert/strict';
import process from 'node:process';
import { resolve, join } from 'node:path';
const evidenceDir = resolve(process.env.UI_EVIDENCE_DIR || '/tmp/deepcode-ui-evidence');
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 420, height: 860 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.sent = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => window.sent.push(m),
      getState: () => ({}),
      setState: () => {},
    });
  });
  await page.goto('about:blank');
  await page.setContent(chatHtml());
  await page
    .getByRole('textbox', { name: 'Message DeepCode' })
    .fill('Inspect the navigation and test the changes.');
  await page.getByRole('textbox').press('Shift+Enter');
  assert.equal(
    await page.locator('textarea').inputValue(),
    'Inspect the navigation and test the changes.\n',
  );
  await page.getByRole('textbox').press('Enter');
  assert.equal((await page.evaluate(() => window.sent)).at(-1).kind, 'send');
  await page.evaluate(() => {
    const emit = (m) => window.dispatchEvent(new MessageEvent('message', { data: m }));
    emit({
      kind: 'message',
      id: 'u1',
      role: 'user',
      text: 'Inspect the navigation and test the changes.',
    });
    emit({ kind: 'thread', id: 'thread-20261117-workspace' });
    emit({ kind: 'status', status: 'working' });
    emit({
      kind: 'delta',
      id: 'a1',
      text: 'I’ll inspect the navigation components and their tests, then update the states that need attention.',
    });
    emit({
      kind: 'tool',
      id: 'call1',
      name: 'Read',
      summary: 'src/components/Sidebar.tsx',
      input: '{ "file_path": "src/components/Sidebar.tsx" }',
      status: 'running',
    });
    emit({
      kind: 'tool',
      id: 'call1',
      status: 'completed',
      output: 'Sidebar renders the project list and the current conversation.',
    });
    emit({
      kind: 'tool',
      id: 'call2',
      name: 'Bash',
      summary: 'pnpm test -- navigation',
      input: '{ "command": "pnpm test -- navigation" }',
      status: 'running',
    });
    emit({ kind: 'usage', inputTokens: 1842, outputTokens: 325 });
  });
  await page.locator('details.tool').first().locator('summary').click();
  assert.equal(await page.locator('details.tool[open]').count(), 1);
  await page.screenshot({ path: join(evidenceDir, 'vscode-working.png') });
  await page.getByRole('button', { name: 'Stop ■', exact: true }).click();
  await page.getByText('Cancelling', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cancelling…' }).isDisabled(), true);
  assert.equal((await page.evaluate(() => window.sent)).at(-1).kind, 'stop');
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', { data: { kind: 'status', status: 'interrupted' } }),
    ),
  );
  await page.getByText('Interrupted', { exact: true }).waitFor();
  await page.evaluate(() => {
    const emit = (m) => window.dispatchEvent(new MessageEvent('message', { data: m }));
    emit({
      kind: 'message',
      id: 'evil',
      role: 'assistant',
      text: '<img src=x onerror="window.compromised=true">',
    });
    emit({
      kind: 'tool',
      id: 'call2',
      status: 'unsettled',
      output:
        'No tool result was reported before the turn ended. Check the workspace before retrying.',
    });
    emit({
      kind: 'message',
      id: 'approval',
      role: 'notice',
      text: 'Approval needed · Write\nUpdate Sidebar.tsx?\nRespond in the VS Code notification.',
    });
    emit({ kind: 'status', status: 'approval' });
  });
  assert.equal(await page.locator('img').count(), 0);
  assert.equal(await page.evaluate(() => window.compromised), undefined);
  await page
    .getByText('<img src=x onerror="window.compromised=true">', { exact: true })
    .evaluate((el) => el.closest('article').remove());
  await page.setViewportSize({ width: 280, height: 700 });
  await page.locator('#log').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForFunction(() => {
    const log = document.getElementById('log');
    return log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  });
  if (await page.getByRole('button', { name: 'Jump to latest ↓' }).isVisible())
    await page.getByRole('button', { name: 'Jump to latest ↓' }).click();
  await page.screenshot({ path: join(evidenceDir, 'vscode-narrow-approval.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(() => {
    const emit = (data) => window.dispatchEvent(new MessageEvent('message', { data }));
    emit({
      kind: 'tool',
      id: JSON.stringify(['turn-1', 'reused-call']),
      name: 'First reused call',
      status: 'running',
    });
    emit({
      kind: 'tool',
      id: JSON.stringify(['turn-1', 'reused-call']),
      status: 'completed',
      output: 'Earlier result stays here',
    });
    emit({
      kind: 'tool',
      id: JSON.stringify(['turn-2', 'reused-call']),
      name: 'Second reused call',
      status: 'running',
    });
    emit({
      kind: 'status',
      status: 'disconnected',
      detail: 'The turn outcome is unknown. Send a new message to reconnect.',
    });
  });
  const firstReused = page.locator('details.tool').filter({ hasText: 'First reused call' });
  const secondReused = page.locator('details.tool').filter({ hasText: 'Second reused call' });
  assert.equal(await firstReused.locator('.tool-status').textContent(), 'Completed');
  assert.equal(
    await firstReused.locator('.tool-body pre').last().textContent(),
    'Earlier result stays here',
  );
  assert.equal(await secondReused.locator('.tool-status').textContent(), 'Running');
  assert.equal(
    await secondReused.locator('.tool-body pre').last().textContent(),
    'Waiting for a result…',
  );
  await page.getByText('Disconnected', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Message DeepCode' }).fill('Inspect before continuing');
  assert.equal(await page.getByRole('button', { name: 'Send ↑', exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Stop ■', exact: true }).isVisible(), false);
  assert.deepEqual(errors, []);
  process.stdout.write(
    'Chromium verified: Enter/Shift+Enter, Send, Stop/Cancelling/Interrupted/Disconnected, tool disclosure and per-turn IDs, text-only hostile output, 280px layout.\n',
  );
  process.stdout.write('Screenshots: ' + evidenceDir + '\n');
} finally {
  await browser.close();
}
