import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
async function boot(page, scene = 'battle') {
  await page.goto(`/?devScene=${scene}&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1`);
  await waitForScene(page, scene === 'battle' ? 'Battle' : 'Title');
  if (scene === 'battle')
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
  await page.evaluate(() => {
    const input = window.__emblemRogueGame.input;
    window.auditDowns = 0;
    for (const method of ['onMouseDown', 'onTouchStart']) {
      const original = input[method];
      input[method] = function (...args) {
        window.auditDowns++;
        return original.apply(this, args);
      };
    }
  });
}
for (const mode of ['touch', 'mouse']) {
  test(`battle sidebar contains ${mode} presses including non-button areas`, async ({ page }) => {
    await boot(page);
    const heading = page.locator('.mb-phase');
    if (mode === 'touch') await heading.tap();
    else await heading.click();
    expect(await page.evaluate(() => window.auditDowns)).toBe(0);
    const more = page.locator('.mb-body summary');
    if (mode === 'touch') await more.tap();
    else await more.click();
    expect(await page.evaluate(() => window.auditDowns)).toBe(0);
  });
}
test('recovery modal owns touch, keyboard and controller input', async ({ page }) => {
  await boot(page, 'title');
  await page.evaluate(async () => {
    const { createRuntimeFatalRecovery } = await import('/src/utils/SceneGuard.js');
    const env = new EventTarget();
    window.auditRecovery = createRuntimeFatalRecovery({
      env,
      documentRef: document,
      overlayId: 'audit-recovery',
      onReload: () => window.auditReloads++,
      onSafeReload: () => {},
    });
    window.auditReloads = 0;
    window.auditRecovery.arm();
    env.dispatchEvent(new ErrorEvent('error', { message: 'Input audit fixture' }));
  });
  await page.evaluate(() => {
    window.auditKeys = 0;
    window.__emblemRogueGame.scene
      .getScene('Title')
      .input.keyboard.on('keydown', () => window.auditKeys++);
  });
  await page.locator('#audit-recovery').getByText('Input audit fixture').tap();
  expect(await page.evaluate(() => window.auditDowns)).toBe(0);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.evaluate(async () => {
    const { dispatchInputAction } = await import('/src/utils/inputFocus.js');
    dispatchInputAction('input:cancel');
  });
  expect(await page.evaluate(() => window.__sceneState.activeScene)).toBe('Title');
  expect(await page.evaluate(() => window.auditKeys)).toBe(0);
  await page.evaluate(() => {
    document.activeElement.blur();
  });
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.auditKeys)).toBe(0);
  await page.evaluate(() => window.auditRecovery.destroy());
  await expect(page.locator('#audit-recovery')).toHaveCount(0);
  expect(await page.locator('#game-wrapper').evaluate((el) => el.inert)).toBe(false);
});
test('map-origin mouse release over a menu cannot leave a held pointer', async ({ page }) => {
  await boot(page);
  const c = await page.locator('#game-container canvas').boundingBox();
  await page.mouse.move(c.x + 30, c.y + 30);
  await page.mouse.down();
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { SettingsMenu } = await import('/src/ui/SettingsMenu.js');
    window.auditSettings = new SettingsMenu(s, () => window.auditSettings.destroy());
  });
  const p = await page.getByRole('dialog', { name: 'Settings', exact: true }).boundingBox();
  await page.mouse.move(p.x + 15, p.y + 15);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__emblemRogueGame.input.mousePointer.isDown)).toBe(false);
  await page.keyboard.press('Escape');
});
test('nested menus retain keyboard ownership and close only the top layer', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    expect(await settings.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.auditDowns)).toBe(0);
});

test('holding Escape closes one nested menu, not every layer', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  await page.keyboard.down('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeFocused();
  await page.keyboard.down('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toBeVisible();
  await page.keyboard.up('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toHaveCount(0);
});

test('a choice that becomes unavailable keeps focus and remains dismissible', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const { ChoicePicker } = await import('/src/ui/ChoicePicker.js');
    window.auditChoiceBlocked = false;
    window.auditApplied = 0;
    window.auditChoice = new ChoicePicker({
      scene: window.__emblemRogueGame.scene.getScene('Battle'),
      title: 'Stale choice audit',
      choices: ['Master Seal'],
      label: (v) => v,
      blocked: () => (window.auditChoiceBlocked ? 'Seal is no longer available.' : ''),
      apply: () => {
        window.auditApplied++;
        return { ok: true };
      },
    });
  });
  const picker = page.getByRole('dialog', { name: 'Stale choice audit', exact: true });
  await page.evaluate(() => (window.auditChoiceBlocked = true));
  await picker.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await expect(picker.getByRole('status')).toHaveText('Seal is no longer available.');
  expect(await picker.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  expect(await page.evaluate(() => window.auditApplied)).toBe(0);
});

for (const mode of ['touch', 'mouse']) {
  test(`legacy side rails isolate ${mode} and dispatch once`, async ({ page }) => {
    await boot(page);
    // Compatibility rails are covered by the new battle layout. Expose the real
    // controls to exercise their fallback wiring without altering production CSS.
    await page.evaluate(() => {
      const root = document.getElementById('mobile-left-panel');
      root.style.setProperty('display', 'flex', 'important');
      root.style.setProperty('position', 'fixed', 'important');
      root.style.setProperty('left', '10px', 'important');
      root.style.setProperty('top', '10px', 'important');
      root.style.setProperty('z-index', '5000', 'important');
      window.auditRailCalls = 0;
      window.__emblemRogueGame.events.on('mobile:menu', () => window.auditRailCalls++);
    });
    const menu = page.locator('#mobile-left-panel [data-action="menu"]');
    if (mode === 'touch') await menu.tap();
    else await menu.click();
    await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.auditRailCalls)).toBe(1);
    expect(await page.evaluate(() => window.auditDowns)).toBe(0);
  });
}
