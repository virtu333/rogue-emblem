import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
async function boot(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
}
test('deployment locks commander, preserves selections through roster and confirms once', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.showDeployScreen(s.runManager.roster, { min: 2, max: 2 }, (units) => {
      window.deployedNames = units.map((u) => u.name);
    });
  });
  const dialog = page.getByRole('dialog', { name: 'Deploy units', exact: true });
  await expect(dialog.getByRole('button', { name: 'Deploy', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: /Edric/ }).tap({ force: true });
  await expect(dialog).toContainText('1 / 2 selected');
  await dialog.getByRole('button', { name: /Sera/ }).tap();
  await dialog.getByRole('button', { name: 'Roster', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Manage roster', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(dialog).toContainText('2 / 2 selected');
  await page.screenshot({ path: 'test-results/deployment-se.png' });
  await dialog.getByRole('button', { name: 'Deploy', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.deployedNames)).toEqual(['Edric', 'Sera']);
});
for (const type of ['boss', 'lord'])
  test(`${type} recruitment shows portraits and resolves once`, async ({ page }) => {
    await boot(page);
    await page.evaluate(async (type) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const module = await import(
        type === 'boss' ? '/src/ui/BossRecruitOverlay.js' : '/src/ui/LordArrivalOverlay.js'
      );
      const Class = type === 'boss' ? module.BossRecruitOverlay : module.LordArrivalOverlay;
      window.arrivalCount = 0;
      new Class(s, s.runManager, s.gameData).show((unit) => {
        window.arrivalCount++;
        window.arrivalName = unit?.name;
      });
    }, type);
    const dialog = page.getByRole('dialog', {
      name: type === 'boss' ? 'Boss recruit' : 'Lord arrival',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img').first()).toBeVisible();
    if (type === 'lord') {
      await page.keyboard.press('Escape');
      await expect(dialog).toContainText('Choose a lord');
    }
    await page.screenshot({ path: `test-results/${type}-arrival-se.png` });
    await dialog
      .getByRole('button', { name: type === 'boss' ? 'Recruit' : 'Welcome', exact: true })
      .tap();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => window.arrivalCount)).toBe(1);
    expect(await page.evaluate(() => window.arrivalName)).toBeTruthy();
  });

test('lord reroll is consumed once and shutdown removes the menu', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.runManager.metaEffects.thirdLordMode = 'pick3_reroll';
    const { LordArrivalOverlay } = await import('/src/ui/LordArrivalOverlay.js');
    new LordArrivalOverlay(s, s.runManager, s.gameData).show(() => {});
  });
  const dialog = page.getByRole('dialog', { name: 'Lord arrival', exact: true });
  await dialog.getByRole('button', { name: 'Reroll', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: 'Reroll', exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').runManager.thirdLordRerolled,
    ),
  ).toBe(true);
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle').events.emit('shutdown'),
  );
  await expect(dialog).toHaveCount(0);
});

test('arrival details reuse roster and cancel skips only optional recruits', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { BossRecruitOverlay } = await import('/src/ui/BossRecruitOverlay.js');
    window.skipped = false;
    new BossRecruitOverlay(s, s.runManager, s.gameData).show((unit) => {
      window.skipped = unit === null;
    });
  });
  const dialog = page.getByRole('dialog', { name: 'Boss recruit', exact: true });
  await dialog.getByRole('button', { name: 'Full unit details', exact: true }).tap();
  const inspect = page.getByRole('dialog', { name: 'Inspect roster', exact: true });
  await expect(inspect).toContainText('Combat');
  await inspect.getByRole('button', { name: 'Close', exact: true }).tap();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.skipped)).toBe(true);
});

test('deployment survives rotation without hiding its confirm control', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.showDeployScreen(s.runManager.roster, { min: 1, max: 2 }, () => {});
  });
  const dialog = page.getByRole('dialog', { name: 'Deploy units', exact: true });
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(dialog.getByRole('button', { name: 'Deploy', exact: true })).toBeInViewport();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
});
