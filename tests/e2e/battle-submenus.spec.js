import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });

async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((u) => u.name === 'Sera') || s.playerUnits[0];
    u.currentHP = 1;
    u.consumables = [{ name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3 }];
    s.selectUnit(u);
    s.showActionMenu(u);
    window.testUnit = u;
  });
  return { hud: page.getByRole('complementary', { name: 'Battle commands' }), errors };
}

test('Vulnerary heals once; resolution rejects repeat activation and cancel', async ({ page }) => {
  const { hud, errors } = await boot(page);
  await hud.getByRole('button', { name: 'Item', exact: true }).tap();
  const use = hud.getByRole('button', { name: /^Vulnerary \(3\).*Restore 10 HP/ });
  await expect(use).toBeFocused();
  await page.screenshot({ path: 'test-results/battle-items-se.png' });
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    window.savedMenuAction = s._menuFocus.items[0].onActivate;
    s.showBriefBanner = () =>
      new Promise((resolve) => {
        window.completeItem = resolve;
      });
  });
  await use.tap();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.savedMenuAction());
  expect(
    await page.evaluate(() => ({
      hp: window.testUnit.currentHP,
      state: window.__emblemRogueGame.scene.getScene('Battle').battleState,
    })),
  ).toEqual({ hp: 11, state: 'HEAL_RESOLVING' });
  await page.evaluate(() => window.completeItem());
  await expect.poll(() => page.evaluate(() => window.testUnit.hasActed)).toBe(true);
  expect(
    await page.evaluate(() => ({
      hp: window.testUnit.currentHP,
      uses: window.testUnit.consumables[0].uses,
    })),
  ).toEqual({ hp: 11, uses: 2 });
  expect(errors).toEqual([]);
});

test('unavailable consumables explain why; keyboard Back and gamepad focus are visible', async ({
  page,
}) => {
  const { hud, errors } = await boot(page);
  await page.evaluate(() => {
    const u = window.testUnit;
    u.currentHP = u.stats.HP;
  });
  await hud.getByRole('button', { name: 'Item', exact: true }).tap();
  await expect(hud.getByRole('button', { name: /Vulnerary.*HP already full/ })).toBeDisabled();
  await page.screenshot({ path: 'test-results/battle-items-disabled-se.png' });
  await expect(
    hud.locator('.mb-actions').getByRole('button', { name: 'Back', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(hud.getByRole('button', { name: 'Item', exact: true })).toBeVisible();
  await hud.getByRole('button', { name: 'Equip', exact: true }).tap();
  // Exercise the same scene router used by the action bus, without a hardware pad.
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle')._onInputAction('input:navigate', { dy: 1 }),
  );
  expect(await hud.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expect(hud.locator('.mb-menu-focused')).toBeFocused();
  expect(
    await hud.locator('.mb-menu-focused').evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe('solid');
  await page.keyboard.press('Escape');
  await expect(hud.getByRole('button', { name: 'Item', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('equip rows show a one-line brief; a long press opens the full stats without equipping', async ({
  page,
}) => {
  const { hud, errors } = await boot(page);
  await page.evaluate(() => {
    localStorage.removeItem('emblem_rogue_tip_hold_item');
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = window.testUnit;
    const axe = s.gameData.weapons.find((w) => w.name === 'Hand Axe');
    u.proficiencies = [...(u.proficiencies || []), { type: 'Axe', rank: 'Prof' }];
    u.inventory.push({ ...axe, uid: 'brief-axe' });
    window.before = u.weapon?.name;
    s.showEquipMenu(u);
  });
  const row = hud.getByRole('button', { name: /^Hand Axe/ });
  await expect(row).toBeVisible();
  const summary = row.locator('.mb-item-summary');
  // One short line: the numbers that decide a pick, ✦ for the effect.
  await expect(summary).toHaveText('Mt 5 · Hit 65 · Rng 1-2 ✦');
  expect(await summary.evaluate((n) => n.getClientRects().length)).toBe(1);
  await expect(row).toHaveAttribute('aria-description', /Weight 8[\s\S]*Throwable/);
  await expect(hud.locator('.mb-hold-hint')).toHaveText('Hold a row for its full details.');
  // Hold: the row opens in place; the weapon is not equipped.
  const box = await row.boundingBox();
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  const pointer = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, ...at };
  await row.dispatchEvent('pointerdown', pointer);
  await page.waitForTimeout(700);
  await row.dispatchEvent('pointerup', pointer);
  await row.dispatchEvent('click', { detail: 1, ...at });
  const open = hud.getByRole('button', { name: /^Hand Axe/ });
  await expect(open).toHaveClass(/is-expanded/);
  await expect(open.locator('.mb-item-summary')).toContainText('Weight 8');
  await expect(open.locator('.mb-item-summary')).toContainText('Throwable, lower stats');
  expect(await page.evaluate(() => window.testUnit.weapon?.name)).toBe(
    await page.evaluate(() => window.before),
  );
  await page.screenshot({ path: 'test-results/battle-equip-brief-se.png' });
  // The hold was learned: the hint does not come back.
  await expect(hud.locator('.mb-hold-hint')).toHaveCount(0);
  // A plain tap still equips.
  await open.tap();
  await expect.poll(() => page.evaluate(() => window.testUnit.weapon?.name)).toBe('Hand Axe');
  expect(errors).toEqual([]);
});

// Attack no longer opens a weapon submenu (target first; weapons switch in the
// forecast), so the Equip submenu stands in for the weapon list.
for (const kind of ['equip', 'staff', 'art', 'ability', 'reclass']) {
  test(`${kind} submenu registers visible focus and cancels without mutation`, async ({ page }) => {
    const { hud, errors } = await boot(page);
    await page.evaluate((kind) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = window.testUnit;
      if (kind === 'equip') {
        u.inventory.push({ ...u.weapon, uid: 'submenu-spare', name: 'Spare blade' });
        s.showEquipMenu(u);
      }
      if (kind === 'staff')
        s.showStaffPicker(
          u,
          u.inventory.filter((w) => w.type === 'Staff'),
        );
      if (kind === 'art') {
        const edric = s.playerUnits.find((unit) => unit.name === 'Edric');
        edric.currentHP = edric.stats.HP;
        edric.weapon.weaponArtIds = ['sword_wrath_strike'];
        s.selectUnit(edric);
        window.testUnit = edric;
        s.showWeaponArtPicker(edric);
      }
      if (kind === 'ability') {
        u.skills.push('healing_circle');
        s.showAbilityPicker(u);
      }
      if (kind === 'reclass') {
        u.level = 10;
        u.isLord = false;
        u.className = 'Mage';
        u.tier = 'base';
        const seal = { name: 'Second Seal', effect: 'reclass', subEffect: 'infantry', uses: 1 };
        u.consumables.push(seal);
        s.showReclassClassPicker(u, seal);
      }
    }, kind);
    if (kind === 'reclass')
      await expect(hud.getByRole('button', { name: 'Myrmidon', exact: true })).toBeVisible();
    if (kind === 'art')
      await expect(hud.getByRole('button', { name: /Wrath Strike/ })).toBeVisible();
    await expect(hud.locator('.mb-actions button:enabled').first()).toBeFocused();
    expect(
      await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle')._menuFocus.items.length,
      ),
    ).toBeGreaterThan(0);
    // Submenu rows (an item and its stat summary) span the rail, one per row:
    // halved into two columns they broke "Rng 3-7" and "Weight 8 · Range 1-2".
    const rows = await hud
      .locator('.mb-actions.mb-submenu')
      .evaluate((list) =>
        [...list.children].map((row) => row.getBoundingClientRect().width / list.clientWidth),
      );
    expect(rows.length).toBeGreaterThan(0);
    for (const share of rows) expect(share).toBeGreaterThan(0.97);
    await page.keyboard.press('Escape');
    await expect(hud.getByRole('button', { name: 'Item', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.testUnit.hasActed)).toBeFalsy();
    expect(errors).toEqual([]);
  });
}

test('AOE confirm clears preview on Back and healing circle can complete', async ({ page }) => {
  const { hud, errors } = await boot(page);
  await page.evaluate(() => {
    window.testUnit.skills.push('healing_circle');
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.showAbilityPicker(window.testUnit);
  });
  await hud.getByRole('button', { name: /^Healing Circle/ }).tap();
  await expect(hud.getByRole('button', { name: /^Use Healing Circle/ })).toBeFocused();
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle')._actionMenuCleanup),
  ).toBeNull();
  await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
  await hud.getByRole('button', { name: /^Healing Circle/ }).tap();
  await hud.getByRole('button', { name: /^Use Healing Circle/ }).tap();
  await expect.poll(() => page.evaluate(() => window.testUnit.hasActed)).toBe(true);
  expect(await page.evaluate(() => window.testUnit.currentHP)).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
