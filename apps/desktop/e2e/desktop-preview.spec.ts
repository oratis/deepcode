import { expect, test } from '@playwright/test';

const composerPlaceholder = '问点什么…   @ 引用文件   ·   / 命令   ·   # 写入 DEEPCODE.md';

test.beforeEach(async ({ page }) => {
  await page.goto('/preview-app.html');
  await expect(page.locator('.app-shell')).toBeVisible();
});

test('keeps the Codex-style three-column shell inside the viewport', async ({ page }, testInfo) => {
  const sidebar = await page.locator('.sidebar').boundingBox();
  const main = await page.locator('.chat-main').boundingBox();
  const rail = await page.locator('.inspector-rail').boundingBox();

  expect(sidebar).not.toBeNull();
  expect(main).not.toBeNull();
  expect(rail).not.toBeNull();
  expect(Math.round(sidebar!.width)).toBe(240);
  expect(Math.round(rail!.width)).toBe(64);
  expect(Math.round(main!.x)).toBe(Math.round(sidebar!.x + sidebar!.width));
  expect(Math.round(rail!.x + rail!.width)).toBe(1280);

  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
    vertical: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(overflow.horizontal).toBeLessThanOrEqual(0);
  expect(overflow.vertical).toBeLessThanOrEqual(0);

  await testInfo.attach('desktop-shell.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('resumes a thread and completes an approval-gated protocol turn', async ({ page }) => {
  await page.locator('[title*="2026-06-02-aaa111"]').click();
  const main = page.getByRole('main');
  await expect(
    main.getByText('Resumed session — earlier conversation loaded below.'),
  ).toBeVisible();
  await expect(main.getByText('制作一个打飞机的小游戏', { exact: true })).toBeVisible();

  const composer = page.getByPlaceholder(composerPlaceholder, { exact: true });
  await composer.fill('Add a boss phase');
  await composer.press('Enter');

  const approve = page.getByRole('button', { name: /^Approve \(↵\)$/ });
  await expect(approve).toBeVisible();
  await expect(main.getByText(/I’ll update the game safely\./)).toBeVisible();
  await expect(main.locator('.tool-card').filter({ hasText: 'Edit' }).last()).toBeVisible();

  await approve.click();

  await expect(main.getByText(/The boss encounter is ready\./)).toBeVisible();
  await expect(main.getByText('Updated the boss encounter.', { exact: true }).last()).toBeVisible();
  await expect(main.getByText('2,304 / 128,000', { exact: true })).toBeVisible();
  await expect(approve).toBeHidden();
  await expect(composer).toBeEnabled();
  await expect(main.getByText('Add a boss phase', { exact: true })).toBeVisible();
  const toolCards = main.locator('.tool-card');
  await expect(toolCards).toHaveCount(2);
  await expect(toolCards.first()).toContainText('running');
  await expect(toolCards.last()).toContainText('done');
});

test('opens source, diff, and history from the file activity rail', async ({ page }) => {
  await page.locator('[title*="2026-06-02-aaa111"]').click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();

  const panel = page.getByTestId('file-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('打飞机.html', { exact: true })).toBeVisible();
  await expect(panel.getByText('<!doctype html>', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(panel.locator('.fp-diff')).toBeVisible();

  await panel.getByRole('button', { name: 'History', exact: true }).click();
  await expect(panel.locator('.fp-hist-row')).toHaveCount(3);
});

test('shows the shared trust-aware configuration diagnostics in About', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'ⓘ About', exact: true }).click();

  const main = page.getByRole('main');
  await expect(main.getByText('Diagnostics', { exact: true })).toBeVisible();
  await expect(main.getByText('untrusted', { exact: true })).toBeVisible();
  await expect(main.getByText('permissions', { exact: true })).toBeVisible();
  await expect(main.getByText('1', { exact: true })).toBeVisible();
});
