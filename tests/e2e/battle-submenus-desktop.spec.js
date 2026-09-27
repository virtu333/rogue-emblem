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
    u.consumables = [{ name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3 }];
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
  const labels = await page.evaluate(() =>
    window.__emblemRogueGame.scene
      .getScene('Battle')
      .actionMenu.map((o) => o.text || '')
      .join(' '),
  );
  expect(labels).toContain('Restore 10 HP');
  expect(labels).toContain('ends this unit’s action');
  expect(labels).toContain('uses do not refill');
  await page.keyboard.press('ArrowDown');
  // Focus paints the palette's accent text (Ink & Ember, #67), the same colour as
  // pointer hover; the item that lost focus returns to its own colour.
  const focus = await page.evaluate(async () => {
    const { UI_PALETTE } = await import('/src/utils/uiStyles.js');
    const { items } = window.__emblemRogueGame.scene.getScene('Battle')._menuFocus;
    return {
      accent: UI_PALETTE.accentText,
      focused: items[1].button.style.color,
      blurred: items[0].button.style.color,
    };
  });
  expect(focus.focused).toBe(focus.accent);
  expect(focus.blurred).not.toBe(focus.accent);
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

test('stationary tile information follows HP and unit movement', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  const result = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = s.playerUnits[0];
    s._inputController.refreshTileInfo(unit.col, unit.row);
    unit.currentHP -= 3;
    s.updateHPBar(unit);
    const hp = s.infoText.text;
    const expected = `HP ${unit.currentHP}/${unit.stats.HP}`;
    unit.col += 1;
    s.updateUnitPosition(unit);
    const moved = s.infoText.text;
    s._inputController.clearHoverInfo();
    unit.currentHP -= 1;
    s.updateHPBar(unit);
    return { hp, expected, moved, name: unit.name, cleared: s.infoText.text };
  });
  expect(result.hp).toContain(result.expected);
  expect(result.moved).not.toContain(result.name);
  expect(result.cleared).toBe('');
});
