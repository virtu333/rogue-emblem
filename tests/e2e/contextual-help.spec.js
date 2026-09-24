import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 375 } });

test('mastery help preserves roster focus, scroll and data through keyboard/controller close', async ({
  page,
}) => {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForScene(page, 'NodeMap');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay?.visible,
  );
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const u = s.runManager.roster[0];
    u.inventory[0].weaponArtIds = ['sword_wrath_strike'];
    u.accessory = { name: 'Blood Gem', combatEffects: { bloodGem: true } };
    s._openRoster();
  });
  const roster = page.locator('.mr-sheet');
  await expect(roster).toContainText('0 / 8 battles');
  await expect(roster).toContainText('Unlock:');
  await expect(roster).toContainText('Sword: Proficient');
  const before = await page.evaluate(() =>
    JSON.stringify(window.__emblemRogueGame.scene.getScene('NodeMap').runManager.roster),
  );
  const trigger = roster.getByRole('button', { name: 'About class mastery', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  const scroll = await roster.locator('.mr-content').evaluate((e) => e.scrollTop);
  await trigger.click();
  const help = page.getByRole('dialog', { name: 'Class mastery', exact: true });
  await expect(help).toContainText('benched and fallen units do not');
  expect(await roster.evaluate((e) => e.inert)).toBe(true);
  expect(await help.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 568, height: 320 });
  await help.getByRole('button', { name: 'Read below' }).click();
  expect(await help.locator('.re-menu-body').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await roster.locator('.mr-content').evaluate((e) => e.scrollTop)).toBe(scroll);
  await trigger.click();
  await page.evaluate(async () => {
    const { dispatchInputAction } = await import('/src/utils/inputFocus.js');
    dispatchInputAction('input:cancel');
  });
  await expect(help).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await roster.getByRole('button', { name: 'Skills', exact: true }).click();
  await expect(roster).toContainText('+5 Attack · +10 Hit');
  await expect(roster).toContainText('HP cost 1 (base 3)');
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.__emblemRogueGame.scene.getScene('NodeMap').runManager.roster),
    ),
  ).toBe(before);
  await page.screenshot({ path: '/tmp/contextual-help-skills.png' });
  await roster.getByRole('button', { name: 'About weapon arts' }).click();
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('NodeMap').rosterOverlay.hide(),
  );
  await expect(page.getByRole('dialog', { name: 'Weapon arts', exact: true })).toHaveCount(0);
});

test('earned mastery remains visible above rewards after selection changes', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.playerUnits[0].classBattles = { [s.playerUnits[0].className]: 7 };
    s.onVictory();
  });
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible();
  await expect(rewards.getByRole('status')).toContainText('Edric mastered Lord!');
  await expect(rewards.getByRole('status')).toContainText('Resolve');
  await rewards.locator('.reward-card').nth(1).click();
  await expect(rewards.getByRole('status')).toContainText('Edric mastered Lord!');
  await rewards.getByRole('button', { name: 'About class mastery', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Class mastery', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    rewards.getByRole('button', { name: 'About class mastery', exact: true }),
  ).toBeFocused();
});
