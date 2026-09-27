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

test('equip rows show a stats brief and attack speed; a long press opens the full stats without equipping', async ({
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
  // The numbers that decide a pick (✦ for the effect), then the attack speed this
  // weapon gives and its change from the held one. By hand, not through the engine:
  // AS = SPD − max(0, weight − floor(STR / 5)); a held staff (or nothing) is bare SPD.
  const speed = await page.evaluate(() => {
    const u = window.testUnit;
    const as = (w) =>
      !w || w.type === 'Staff'
        ? u.stats.SPD
        : u.stats.SPD - Math.max(0, (w.weight || 0) - Math.floor(u.stats.STR / 5));
    return { axe: as(u.inventory.find((w) => w.uid === 'brief-axe')), held: as(u.weapon) };
  });
  const minus = (n) => (n < 0 ? `\u2212${-n}` : `${n}`);
  const delta = speed.axe - speed.held;
  const speedText = `Attack speed ${minus(speed.axe)}${
    delta ? ` (${delta > 0 ? `+${delta}` : minus(delta)})` : ''
  }`;
  await expect
    .poll(() => summary.evaluate((n) => n.textContent))
    .toBe(`Mt 5 · Hit 65 · Rng 1-2\u00a0✦\n${speedText}`);
  // Exactly two lines in the phone rail: neither wraps.
  expect(
    await summary.evaluate((n) =>
      Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)),
    ),
  ).toBe(2);
  // The row leads with the weapon's socketed icon, and keeps its height.
  await expect(row.locator('.mb-item-icon')).toHaveAttribute('data-icon-id', 'hand-axe');
  await expect(row.locator('.mb-item-icon')).toHaveAttribute('aria-hidden', 'true');
  await expect(row).toHaveAttribute('aria-description', /Weight 8[\s\S]*Throwable/);
  await expect(hud.locator('.mb-hold-hint')).toHaveText('Hold a row for its full details.');
  // Hold: the row opens in place; the weapon is not equipped.
  const box = await row.boundingBox();
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  const pointer = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, ...at };
  await row.dispatchEvent('pointerdown', pointer);
  // Release once the hold has fired (it marks the hint learned), not after a fixed
  // sleep: under load the hold timer can fire late, and an early release is a tap.
  await page.waitForFunction(() => localStorage.getItem('emblem_rogue_tip_hold_item') === '1');
  await row.dispatchEvent('pointerup', pointer);
  await row.dispatchEvent('click', { detail: 1, ...at });
  const open = hud.getByRole('button', { name: /^Hand Axe/ });
  await expect(open).toHaveClass(/is-expanded/);
  await expect(open.locator('.mb-item-summary')).toContainText('Weight 8');
  await expect(open.locator('.mb-item-summary')).toContainText(
    `Attack speed ${minus(speed.held)} → ${minus(speed.axe)}`,
  );
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

test('heal rows preview HP, Back cancels, and repeated taps spend only one staff use', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const { hud, errors } = await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.get('settings')?.setHints?.(false);
    s.hideActionMenu();
    const healer = window.testUnit;
    const target = s.playerUnits.find((u) => u !== healer);
    healer.stats.MAG = 1;
    target.stats.HP = 20;
    target.currentHP = 12;
    const staff = {
      ...s.gameData.weapons.find((w) => w.name === 'Heal'),
      uses: 4,
      maxUses: 4,
      healBase: 5,
    };
    healer.inventory.push(staff);
    s.startHealTargetSelection(healer, [target], staff);
    window.healCase = { healer, target, staff };
  });
  let row = hud.getByRole('group', { name: 'Heal targets' }).getByRole('button');
  await expect(row).toContainText('HP 12/20 → 18/20 (+6)');
  await expect(hud).not.toContainText('Cancel to go back');
  await hud.getByRole('button', { name: 'Back', exact: true }).click();
  expect(
    await page.evaluate(() => ({
      hp: window.healCase.target.currentHP,
      uses: window.healCase.staff.uses - (window.healCase.staff._usesSpent || 0),
    })),
  ).toEqual({ hp: 12, uses: 4 });
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.hideActionMenu();
    const { healer, target, staff } = window.healCase;
    s.startHealTargetSelection(healer, [target], staff);
  });
  await expect(row).toContainText('HP 12/20 → 18/20 (+6)');
  await row.evaluate((b) => {
    b.click();
    b.click();
  });
  await expect.poll(() => page.evaluate(() => window.healCase.healer.hasActed)).toBe(true);
  expect(
    await page.evaluate(() => ({
      hp: window.healCase.target.currentHP,
      uses: window.healCase.staff.uses - (window.healCase.staff._usesSpent || 0),
    })),
  ).toEqual({ hp: 18, uses: 3 });
  expect(errors).toEqual([]);
});

test('Cure rows name the removed conditions without promising HP', async ({ page }) => {
  const { hud, errors } = await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.get('settings')?.setHints?.(false);
    s.hideActionMenu();
    const healer = window.testUnit;
    const target = s.playerUnits.find((u) => u !== healer);
    target.currentHP = target.stats.HP;
    target._conditions = [{ id: 'sleep', turnsLeft: 2 }];
    const staff = { ...s.gameData.weapons.find((w) => w.name === 'Heal'), cureConditions: true };
    healer.inventory.push(staff);
    s.startHealTargetSelection(healer, [target], staff);
    window.cureCase = { healer, target, staff, hp: target.currentHP };
  });
  const row = hud.getByRole('group', { name: 'Heal targets' }).getByRole('button');
  await expect(row).toContainText(/Cure: removes Sleep/i);
  await expect(row).not.toContainText('HP');
  await row.tap();
  await expect.poll(() => page.evaluate(() => window.cureCase.healer.hasActed)).toBe(true);
  expect(
    await page.evaluate(() => {
      const { target, staff, hp } = window.cureCase;
      return {
        conditions: target._conditions,
        unchangedHp: target.currentHP === hp,
        spent: staff._usesSpent,
      };
    }),
  ).toEqual({ conditions: [], unchangedHp: true, spent: 1 });
  expect(errors).toEqual([]);
});
