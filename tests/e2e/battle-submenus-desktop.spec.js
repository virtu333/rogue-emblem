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

test('desktop: a staff heals the caravan Merchant by hover and click', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(async () => {
    const { createCaravanUnit } = await import('/src/engine/CaravanSystem.js');
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.get('settings')?.setHints?.(false);
    const healer = s.playerUnits.find((u) => u.name === 'Sera') || s.playerUnits[0];
    for (const u of s.playerUnits) u.currentHP = u.stats.HP; // only the Merchant is hurt
    healer.stats.MAG = 1;
    const staff = { ...s.gameData.weapons.find((w) => w.name === 'Heal') };
    healer.inventory = healer.inventory.filter((w) => w.type !== 'Staff');
    healer.inventory.push(staff);
    const tile = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dc, dr]) => ({ col: healer.col + dc, row: healer.row + dr }))
      .find(
        ({ col, row }) =>
          col >= 0 &&
          row >= 0 &&
          col < s.grid.cols &&
          row < s.grid.rows &&
          !s.getUnitAt(col, row) &&
          s.grid.getMoveCost(col, row, 'Infantry') !== Infinity,
      );
    const caravan = createCaravanUnit('act2', tile); // 18 + 4 × 2 = 26 HP
    caravan.currentHP = 12;
    s.npcUnits.push(caravan);
    s.addUnitGraphic(caravan);
    s.selectUnit(healer);
    s.showActionMenu(healer);
    window.caravanCase = { healer, staff, caravan };
  });
  // Choose Heal from the canvas action menu with the keyboard.
  const steps = await page.evaluate(() =>
    window.__emblemRogueGame.scene
      .getScene('Battle')
      ._menuFocus.items.findIndex((item) => /^Heal \(/.test(item.button?.text || '')),
  );
  expect(steps).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return {
          state: s.battleState,
          targets: (s.healTargets || []).map((u) => u.name),
        };
      }),
    )
    .toEqual({ state: 'SELECTING_HEAL_TARGET', targets: ['Merchant'] });
  const point = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { caravan } = window.caravanCase;
    const w = s.grid.gridToPixel(caravan.col, caravan.row),
      p = s._worldToScreen(w.x, w.y),
      r = s.game.canvas.getBoundingClientRect();
    return {
      x: r.x + (p.x * r.width) / s.scale.width,
      y: r.y + (p.y * r.height) / s.scale.height,
    };
  });
  // Hovering the Merchant previews the heal (Heal: MAG 1 + 5 = 6).
  await page.mouse.move(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').infoText.text),
    )
    .toContain('Heal +6 → 18/26 HP');
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => window.caravanCase.healer.hasActed)).toBe(true);
  expect(
    await page.evaluate(() => {
      const { caravan, staff } = window.caravanCase;
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        hp: caravan.currentHP,
        spent: staff._usesSpent,
        npc: s.npcUnits.includes(caravan) && caravan.faction === 'npc',
      };
    }),
  ).toEqual({ hp: 18, spent: 1, npc: true });
  expect(errors).toEqual([]);
});
