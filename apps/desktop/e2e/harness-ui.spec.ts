import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, action: string, argument?: unknown) {
  await page.evaluate(
    ({ action, argument }) => {
      const fixture = (
        window as unknown as { __DEEPCODE_FIXTURE__: Record<string, (arg?: unknown) => unknown> }
      ).__DEEPCODE_FIXTURE__;
      return fixture[action]!(argument);
    },
    { action, argument },
  );
}

async function holdReply(page: Page, method: 'approve' | 'answer' | 'abort') {
  await page.evaluate((method) => {
    const host = window as unknown as {
      deepcode: { agent: Record<string, () => Promise<unknown>> };
      heldReplies?: Record<string, (failed?: boolean) => void>;
    };
    host.heldReplies ??= {};
    host.deepcode.agent[method] = () =>
      new Promise((resolve, reject) => {
        host.heldReplies![method] = (failed) =>
          failed ? reject(new Error('Delayed request failed')) : resolve(true);
      });
  }, method);
}

async function releaseReply(page: Page, method: string, failed = false) {
  await page.evaluate(
    ({ method, failed }) => {
      (window as unknown as { heldReplies: Record<string, (failed: boolean) => void> }).heldReplies[
        method
      ]!(failed);
    },
    { method, failed },
  );
}

const nextQuestion = {
  type: 'user-input.requested',
  requestId: 'next-question',
  question: 'Next question?',
  options: [],
};
const nextApproval = {
  type: 'approval.requested',
  requestId: 'next-approval',
  toolName: 'Bash',
  reason: 'Next approval?',
};

async function send(page: Page, text = 'Add a boss phase') {
  await page.getByRole('textbox', { name: 'Message DeepCode' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/preview-app.html');
  await expect(page.locator('.app-shell')).toBeVisible();
});

test('keeps the current conversation and draft while visiting settings', async ({ page }) => {
  await page.locator('[title*="2026-06-02-aaa111"]').click();
  const composer = page.getByRole('textbox', { name: 'Message DeepCode' });
  await composer.fill('A draft to keep');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to conversation', exact: false }).click();
  await expect(composer).toHaveValue('A draft to keep');
  await expect(
    page.getByRole('main').getByText('制作一个打飞机的小游戏', { exact: true }),
  ).toBeVisible();
});

test('clears the selected session and can resume it again through the sidebar', async ({
  page,
}) => {
  const session = page.locator('[title*="2026-06-02-aaa111"]');
  await session.click();
  await send(page, '/clear');
  await expect(page.getByRole('heading', { name: 'What are we building?' })).toBeVisible();
  await expect(page.locator('.sidebar [aria-current="page"]')).toHaveCount(0);
  await session.click();
  await expect(
    page.getByRole('main').getByText('制作一个打飞机的小游戏', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Resumed session — earlier conversation loaded below.', { exact: true }),
  ).toBeVisible();
});

test('retains the old conversation if resume fails and opens sessions through the browser', async ({
  page,
}) => {
  await page.locator('[title*="2026-06-02-aaa111"]').click();
  await fixture(page, 'failNextRequest', 'thread/resume');
  await page.locator('[title*="2026-06-02-bbb222"]').click();
  await expect(page.getByRole('alert')).toContainText('Could not open session');
  await expect(
    page.getByRole('main').getByText('制作一个打飞机的小游戏', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All sessions', exact: false }).click();
  await page.getByRole('searchbox', { name: 'Find a session' }).fill('超级马里奥');
  await page
    .getByRole('main')
    .getByRole('button', { name: /写一个超级马里奥/ })
    .click();
  await expect(page.getByText('Harden the loader', { exact: true })).toBeVisible();
});

test('locks Changes actions while resuming and navigation while starting a review turn', async ({
  page,
}) => {
  await page.locator('[title*="2026-06-02-bbb222"]').click();
  await page.getByRole('button', { name: /^Changes/ }).click();
  const apply = page.getByRole('button', { name: 'Apply', exact: true });
  await expect(apply).toBeEnabled();
  await fixture(page, 'deferNextRequest', 'thread/resume');
  await page.locator('[title*="2026-06-02-aaa111"]').click();
  await expect(apply).toBeDisabled();
  await fixture(page, 'releaseRequest', 'thread/resume');
  await expect(page.getByText('制作一个打飞机的小游戏', { exact: true }).last()).toBeVisible();
  await page.locator('[title*="2026-06-02-bbb222"]').click();
  await expect(apply).toBeEnabled();
  await fixture(page, 'failNextRequest', 'review/apply');
  await apply.click();
  await expect(page.locator('.ch-error')).toContainText('Fixture request failed');
  await expect(apply).toBeEnabled();
  await fixture(page, 'deferNextRequest', 'review/apply');
  await apply.click();
  await expect(page.getByRole('button', { name: /New session/ })).toBeDisabled();
  await expect(page.locator('[title*="2026-06-02-aaa111"]')).toBeDisabled();
  await expect(page.locator('.conversation-view')).toHaveAttribute('inert', '');
  await fixture(page, 'deferNextRequest', 'workspace/diff');
  await fixture(page, 'releaseRequest', 'review/apply');
  await expect(page.getByRole('button', { name: 'Revert', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: /New session/ })).toBeEnabled();
  await expect(page.locator('.conversation-view')).not.toHaveAttribute('inert', '');
  await fixture(page, 'releaseRequest', 'workspace/diff');
});

for (const first of ['approval', 'question'] as const) {
  test(`replaces ${first} with the next interaction before its response settles`, async ({
    page,
  }) => {
    await send(page, first === 'question' ? 'fixture:question' : 'Add a boss phase');
    const firstMethod = first === 'approval' ? 'approve' : 'answer';
    const secondMethod = first === 'approval' ? 'answer' : 'approve';
    await holdReply(page, firstMethod);
    if (first === 'approval') {
      await page.getByRole('button', { name: 'Allow once' }).click();
    } else {
      await page.getByRole('textbox', { name: 'Your answer' }).fill('First answer');
      await page.getByRole('button', { name: 'Send answer' }).click();
    }
    await fixture(page, 'event', first === 'approval' ? nextQuestion : nextApproval);
    const firstPanel =
      first === 'approval'
        ? page.getByRole('region', { name: 'Tool approval' })
        : page.getByRole('form', { name: 'Agent question' });
    await expect(firstPanel).toBeHidden();
    await holdReply(page, secondMethod);
    if (first === 'approval')
      await page.getByRole('textbox', { name: 'Your answer' }).fill('Next answer');
    const respond = page.getByRole('button', {
      name: first === 'approval' ? 'Send answer' : 'Allow once',
    });
    await expect(respond).toBeEnabled();
    await respond.click();
    await releaseReply(page, firstMethod);
    await expect(respond).toBeDisabled();
    await releaseReply(page, secondMethod);
    await expect(respond).toBeHidden();
  });

  test(`retains an in-flight ${first} when Stop fails`, async ({ page }) => {
    await send(page);
    await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible();
    await holdReply(page, 'abort');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await fixture(page, 'event', first === 'approval' ? nextApproval : nextQuestion);
    if (first === 'question')
      await expect(page.getByRole('form', { name: 'Agent question' })).toBeVisible();
    const respond = page.getByRole('button', {
      name: first === 'approval' ? 'Allow once' : 'Send answer',
    });
    await expect(respond).toBeDisabled();
    await releaseReply(page, 'abort', true);
    if (first === 'question')
      await page.getByRole('textbox', { name: 'Your answer' }).fill('Continue');
    await expect(respond).toBeEnabled();
    await expect(page.locator('.chat-header')).toContainText(
      first === 'approval' ? 'Awaiting approval' : 'Awaiting input',
    );
  });
}

test('keeps approval visible on error and waits for terminal interruption before unlocking', async ({
  page,
}) => {
  await send(page);
  const approval = page.getByRole('region', { name: 'Tool approval' });
  await expect(approval).toContainText('The fixture verifies an approval-gated write.');
  await fixture(page, 'failNextRequest', 'approval/respond');
  await page.getByRole('button', { name: 'Allow once' }).click();
  await expect(approval.getByRole('alert')).toContainText('Could not send decision');
  await expect(page.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  await fixture(page, 'deferInterrupt', true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.chat-header')).toContainText('Cancelling');
  await expect(page.getByRole('button', { name: 'Allow once' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /New session/ })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Message DeepCode' })).toBeDisabled();
  await fixture(page, 'finishInterrupt');
  await expect(page.locator('.chat-header')).toContainText('Interrupted');
  await expect(approval).toBeHidden();
  await expect(page.locator('.tool-card')).toContainText('interrupted · result unknown');
  await expect(page.getByRole('textbox', { name: 'Message DeepCode' })).toBeEnabled();
});

test('keeps sends on the original thread when legacy history cannot be read', async ({ page }) => {
  await page.locator('[title*="2026-06-02-aaa111"]').click();
  await fixture(page, 'failNextCommand', 'session_read');
  await page.locator('[title*="2026-06-01-ccc333"]').click();
  await expect(page.getByRole('alert')).toContainText('Could not open session');
  await send(page, 'Continue on the original thread');
  await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible();
  const threadId = await page.evaluate(
    () =>
      (
        window as unknown as {
          __DEEPCODE_FIXTURE__: {
            protocolRequests: Array<{ method: string; params: { threadId?: string } }>;
          };
        }
      ).__DEEPCODE_FIXTURE__.protocolRequests
        .filter((request) => request.method === 'turn/start')
        .at(-1)?.params.threadId,
  );
  expect(threadId).toBe('2026-06-02-aaa111');
});

test('preserves the request after start failure and retries a rejected stop request', async ({
  page,
}) => {
  await fixture(page, 'failNextRequest', 'turn/start');
  await send(page, 'Preserve my prompt');
  await expect(page.getByRole('alert')).toContainText('Failed to start');
  await expect(page.getByRole('textbox', { name: 'Message DeepCode' })).toHaveValue(
    'Preserve my prompt',
  );
  await send(page);
  await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible();
  await fixture(page, 'failNextRequest', 'turn/interrupt');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('alert').last()).toContainText('Could not stop');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.chat-header')).toContainText('Interrupted');
});

test('supports multi-select and free text answers without losing a failed reply', async ({
  page,
}) => {
  await send(page, 'fixture:question');
  const question = page.getByRole('form', { name: 'Agent question' });
  await question.getByRole('checkbox', { name: /Unit tests/ }).check();
  await question.getByRole('checkbox', { name: /Browser tests/ }).check();
  await question.getByRole('textbox', { name: 'Your answer' }).fill('Also lint');
  await fixture(page, 'failNextRequest', 'user-input/respond');
  await question.getByRole('button', { name: 'Send answer' }).click();
  await expect(question.getByRole('alert')).toContainText('Could not send answer');
  await question.getByRole('button', { name: 'Send answer' }).click();
  await expect(question).toBeHidden();
  const answer = await page.evaluate(
    () =>
      (
        window as unknown as {
          __DEEPCODE_FIXTURE__: {
            protocolRequests: Array<{ method: string; params: { answer?: string } }>;
          };
        }
      ).__DEEPCODE_FIXTURE__.protocolRequests
        .filter((request) => request.method === 'user-input/respond')
        .at(-1)?.params.answer,
  );
  expect(answer).toBe('Unit tests, Browser tests, Also lint');
});

test('shows failure tails, full tool output, and safe formatted assistant text', async ({
  page,
}) => {
  await send(page, 'fixture:long-output');
  await expect(page.getByRole('heading', { name: 'Check result' })).toBeVisible();
  await expect(page.locator('.tc-output')).toContainText('FAIL: fixture tail diagnostic');
  await expect(page.locator('.tc-output')).toContainText('characters omitted');
  await page.getByRole('button', { name: /Show full output/ }).click();
  await expect(page.locator('.tc-output')).not.toContainText('characters omitted');
  await page.getByRole('button', { name: 'Hide Bash details' }).click();
  await expect(page.locator('.tc-body')).toBeHidden();
  await expect(page.locator('.message-content pre')).toContainText('const phase = 1;');
});

test('lets settings recover from load errors and rejects non-object JSON', async ({ page }) => {
  await fixture(page, 'failNextCommand', 'load_settings_file');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load settings');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const json = page.getByRole('textbox', { name: 'Settings JSON' });
  await json.fill('[]');
  await expect(json).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: /Save/ })).toBeDisabled();
  await json.fill('{}');
  await expect(page.getByRole('button', { name: /Save/ })).toBeEnabled();
  await page.getByRole('button', { name: /Plugins/, exact: false }).click();
  await expect(page.getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);
  await expect(page.getByText('deepcode plugins install <spec>', { exact: true })).toBeVisible();
});

test('keeps the composer and inspector usable at 800px and records visible states', async ({
  page,
}) => {
  await page.screenshot({ path: '/tmp/deepcode-ui-evidence/desktop-welcome.png' });
  await send(page);
  await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible();
  await page.screenshot({ path: '/tmp/deepcode-ui-evidence/desktop-approval.png' });
  await page.getByRole('button', { name: 'Allow once' }).click();
  await expect(page.locator('.chat-header')).toContainText('Completed');
  await page.setViewportSize({ width: 800, height: 700 });
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(page.locator('.inspector')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/deepcode-ui-evidence/desktop-narrow-inspector.png' });
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message DeepCode' })).toBeVisible();
});
