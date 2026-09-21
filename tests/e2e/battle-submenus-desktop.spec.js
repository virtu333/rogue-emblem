import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ viewport: { width: 1280, height: 800 } });
test('canvas item submenu supports keyboard selection and consumes one charge', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits[0];
    u.currentHP = 1;
    u.consumables = [{ name: 'Vulnerary', effect: 'heal', value: 10, uses: 3 }];
    s.selectUnit(u);
    s.showActionMenu(u);
    s.showItemMenu(u);
    window.testUnit = u;
  });
  expect(
    await page.evaluate(() =>
      Boolean(window.__emblemRogueGame.scene.getScene('Battle')._mobileBattleHud),
    ),
  ).toBe(false);
  await page.keyboard.press('ArrowDown');
  expect(
    await page.evaluate(
      () =>
        window.__emblemRogueGame.scene.getScene('Battle')._menuFocus.items[1].button.style.color,
    ),
  ).toBe('#ffdd44');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.testUnit.hasActed)).toBe(true);
  expect(
    await page.evaluate(() => ({
      hp: window.testUnit.currentHP,
      uses: window.testUnit.consumables[0].uses,
    })),
  ).toEqual({ hp: 11, uses: 2 });
  expect(errors).toEqual([]);
});
