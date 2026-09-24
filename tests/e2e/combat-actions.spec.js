import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
const url = '/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1';
async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  return { hud: page.getByRole('complementary', { name: 'Battle commands' }), errors };
}
async function tapTile(page, col, row) {
  const p = await page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(col, row),
        p = s._worldToScreen(w.x, w.y),
        r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
  await page.touchscreen.tap(p.x, p.y);
}
async function select(page, name) {
  const pos = await page.evaluate((name) => {
    const u = window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.find((u) => u.name === name);
    return { col: u.col, row: u.row };
  }, name);
  await tapTile(page, pos.col, pos.row);
}
async function unit(page, name) {
  return page.evaluate((name) => {
    const u = window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.find((u) => u.name === name);
    return {
      hp: u.currentHP,
      acted: u.hasActed,
      col: u.col,
      row: u.row,
      weapon: u.weapon.name,
      usage: u._battleWeaponArtUsage,
      ability: u._battleAbilityUsage,
    };
  }, name);
}
for (const [label, id] of [
  ['Healing Circle', 'healing_circle'],
  ['Rally Cry', 'rally_cry_skill'],
  ['Ensnare', 'ensnare'],
]) {
  test(`${label}: explanation, cancel, then real effect and action consumption`, async ({
    page,
  }) => {
    const { hud, errors } = await boot(page);
    await select(page, 'Utility');
    await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
    await expect(
      hud.getByRole('button', { name: new RegExp(`^${label}`) }).locator('small'),
    ).toBeVisible();
    await hud.getByRole('button', { name: new RegExp(`^${label}`) }).tap();
    await page.keyboard.press('Escape');
    expect((await unit(page, 'Utility')).acted).toBe(false);
    await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
    await hud.getByRole('button', { name: new RegExp(`^${label}`) }).tap();
    await page.screenshot({ path: `test-results/combat-${id}.png` });
    await hud.getByRole('button', { name: new RegExp(`^Use ${label}`) }).tap();
    await expect.poll(async () => (await unit(page, 'Utility')).acted).toBe(true);
    const effect = await page.evaluate((id) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      if (id === 'healing_circle') {
        const u = s.playerUnits.find((u) => u.name === 'Patient');
        return u.currentHP === u.stats.HP;
      }
      if (id === 'ensnare')
        return s.enemyUnits.some((u) => u._conditions?.some((c) => c.id === 'root'));
      return s.playerUnits.some((u) => u._battleTimedWeaponArtBuffs?.length > 0);
    }, id);
    expect(effect).toBe(true);
    expect((await unit(page, 'Utility')).ability.map[id]).toBe(1);
    expect(errors).toEqual([]);
  });
}
test('Blink invalid tile, cancel, then teleport consumes action', async ({ page }) => {
  const { hud, errors } = await boot(page);
  await select(page, 'Utility');
  await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
  await hud.getByRole('button', { name: /^Blink/ }).tap();
  await tapTile(page, 4, 3); // occupied hostile
  expect((await unit(page, 'Utility')).col).toBe(4);
  await page.keyboard.press('Escape');
  await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
  await hud.getByRole('button', { name: /^Blink/ }).tap();
  await tapTile(page, 5, 5);
  await expect.poll(async () => (await unit(page, 'Utility')).acted).toBe(true);
  expect(await unit(page, 'Utility')).toMatchObject({ col: 5, row: 5 });
  expect(errors).toEqual([]);
});
test('Weapon art forecast cancel has no cost; confirmed combat charges once', async ({ page }) => {
  const { hud, errors } = await boot(page);
  await select(page, 'Edric');
  const before = await unit(page, 'Edric');
  await hud.getByRole('button', { name: /^Weapon Art/ }).tap();
  await expect(hud.getByRole('button', { name: /Wrath Strike/ }).locator('small')).toBeVisible();
  await hud.getByRole('button', { name: /Wrath Strike/ }).tap();
  await tapTile(page, 4, 3);
  await expect(page.getByRole('button', { name: 'Confirm attack', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/combat-art-forecast.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect((await unit(page, 'Edric')).hp).toBe(before.hp);
  await tapTile(page, 4, 3);
  await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
  await expect.poll(async () => (await unit(page, 'Edric')).acted, { timeout: 15000 }).toBe(true);
  expect((await unit(page, 'Edric')).hp).toBeLessThanOrEqual(before.hp - 3);
  expect((await unit(page, 'Edric')).usage.map.sword_wrath_strike).toBe(1);
  expect(errors).toEqual([]);
});
for (const action of ['Shove', 'Pull']) {
  test(`${action} moves ally through real targeting`, async ({ page }) => {
    const { hud, errors } = await boot(page);
    await select(page, 'Support');
    await hud.getByRole('button', { name: action, exact: true }).tap();
    await tapTile(page, action === 'Shove' ? 2 : 3, action === 'Shove' ? 4 : 3);
    await expect.poll(async () => (await unit(page, 'Support')).acted).toBe(true);
    expect(await unit(page, action === 'Shove' ? 'Patient' : 'Edric')).toMatchObject(
      action === 'Shove' ? { col: 1, row: 4 } : { col: 3, row: 4 },
    );
    expect(errors).toEqual([]);
  });
}
test('Heal restores HP and re-equips combat weapon', async ({ page }) => {
  const { hud, errors } = await boot(page);
  await select(page, 'Sera');
  await hud.getByRole('button', { name: /^Heal \(/ }).tap();
  await hud.getByRole('button', { name: /^Heal / }).tap();
  await tapTile(page, 2, 4);
  await expect.poll(async () => (await unit(page, 'Sera')).acted).toBe(true);
  expect((await unit(page, 'Sera')).weapon).toBe('Lightning');
  expect((await unit(page, 'Patient')).hp).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
for (const staff of ['Warp Staff', 'Rescue Staff']) {
  test(`${staff}: cancel destination costs nothing; valid destination spends one use`, async ({
    page,
  }) => {
    const { hud, errors } = await boot(page);
    await select(page, 'Sera');
    await hud.getByRole('button', { name: /^Heal \(/ }).tap();
    await hud.getByRole('button', { name: new RegExp(staff) }).tap();
    const target = staff === 'Warp Staff' ? [2, 4] : [4, 4];
    await tapTile(page, ...target);
    await page.keyboard.press('Escape');
    expect((await unit(page, 'Sera')).acted).toBe(false);
    expect(
      await page.evaluate(
        (name) =>
          window.__emblemRogueGame.scene
            .getScene('Battle')
            .playerUnits.find((u) => u.name === 'Sera')
            .inventory.find((w) => w.name === name)._usesSpent,
        staff,
      ),
    ).toBe(0);
    // Back from tile targeting returns to ally selection.
    await tapTile(page, ...target);
    const dest = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').staffRelocateTiles[0],
    );
    await tapTile(page, dest.col, dest.row);
    await expect.poll(async () => (await unit(page, 'Sera')).acted).toBe(true);
    expect(await unit(page, staff === 'Warp Staff' ? 'Patient' : 'Utility')).toMatchObject({
      col: dest.col,
      row: dest.row,
    });
    expect((await unit(page, 'Sera')).weapon).toBe('Lightning');
    expect(
      await page.evaluate(
        (name) =>
          window.__emblemRogueGame.scene
            .getScene('Battle')
            .playerUnits.find((u) => u.name === 'Sera')
            .inventory.find((w) => w.name === name)._usesSpent,
        staff,
      ),
    ).toBe(1);
    expect(errors).toEqual([]);
  });
}
test('Dance refreshes a spent ally, Restore cures a condition', async ({ page }) => {
  const { hud, errors } = await boot(page);
  await select(page, 'Patient');
  await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
  await select(page, 'Support');
  await hud.getByRole('button', { name: 'Dance', exact: true }).tap();
  await tapTile(page, 2, 4);
  await expect.poll(async () => (await unit(page, 'Support')).acted).toBe(true);
  expect((await unit(page, 'Patient')).acted).toBe(false);
  // Synthetic condition setup only; the cure itself uses normal UI and rules.
  await page.evaluate(() => {
    window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.find((u) => u.name === 'Patient')._conditions = [
      { id: 'poison', turnsRemaining: 3 },
    ];
  });
  await select(page, 'Sera');
  await hud.getByRole('button', { name: /^Heal \(/ }).tap();
  await hud.getByRole('button', { name: /Restore/ }).tap();
  await tapTile(page, 2, 4);
  await expect.poll(async () => (await unit(page, 'Sera')).acted).toBe(true);
  expect(
    await page.evaluate(
      () =>
        window.__emblemRogueGame.scene
          .getScene('Battle')
          .playerUnits.find((u) => u.name === 'Patient')._conditions,
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
for (const staff of ['Heal', 'Warp Staff', 'Rescue Staff']) {
  test(`Backing out of ${staff} targeting restores the combat weapon before Wait`, async ({
    page,
  }) => {
    const { hud, errors } = await boot(page);
    await select(page, 'Sera');
    await hud.getByRole('button', { name: /^Heal \(/ }).tap();
    await hud.getByRole('button', { name: new RegExp(`^${staff} `) }).tap();
    expect((await unit(page, 'Sera')).weapon).toBe(staff);
    await page.keyboard.press('Escape');
    expect((await unit(page, 'Sera')).weapon).toBe('Lightning');
    await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
    expect((await unit(page, 'Sera')).weapon).toBe('Lightning');
    expect(errors).toEqual([]);
  });
}

test('Low HP and spent abilities show disabled reasons without consuming an action', async ({
  page,
}) => {
  const { hud, errors } = await boot(page);
  // Put the fixture at the exact affordability boundary: Wrath 3, Dueling 4 HP.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.playerUnits.find((u) => u.name === 'Edric').currentHP = 4;
    s.playerUnits.find((u) => u.name === 'Utility')._battleAbilityUsage = { map: { blink: 1 } };
  });
  await select(page, 'Edric');
  await hud.getByRole('button', { name: /^Weapon Art/ }).tap();
  await expect(hud.getByRole('button', { name: /Dueling Blade.*Not enough HP/ })).toBeDisabled();
  await expect(hud.getByRole('button', { name: /Wrath Strike/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Cancel can return to the selected movement state; deselect before changing units.
  await page.keyboard.press('Escape');
  await select(page, 'Utility');
  await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
  await expect(hud.getByRole('button', { name: /Blink.*Used this battle/ })).toBeDisabled();
  await expect(hud.getByRole('button', { name: /Healing Circle/ })).toBeEnabled();
  expect((await unit(page, 'Utility')).acted).toBe(false);
  expect((await unit(page, 'Edric')).hp).toBe(4);
  expect(errors).toEqual([]);
});

for (const blocked of ['spent', 'silenced', 'no targets']) {
  test(`Ability remains openable when its only skill is ${blocked}`, async ({ page }) => {
    const { hud, errors } = await boot(page);
    await page.evaluate((blocked) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((u) => u.name === 'Utility');
      u.skills = [blocked === 'no targets' ? 'healing_circle' : 'blink'];
      if (blocked === 'spent') u._battleAbilityUsage = { map: { blink: 1 } };
      if (blocked === 'silenced') u._conditions = [{ id: 'silence', turnsRemaining: 2 }];
      if (blocked === 'no targets')
        for (const ally of s.playerUnits) ally.currentHP = ally.stats.HP;
    }, blocked);
    await select(page, 'Utility');
    await expect(hud.getByRole('button', { name: 'Ability', exact: true })).toBeEnabled();
    await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
    const reason =
      blocked === 'spent'
        ? '0/1 uses left.*Used this battle'
        : blocked === 'silenced'
          ? '1/1 uses left.*Silenced'
          : '1/1 uses left.*No valid targets';
    const skill = hud.getByRole('button', { name: new RegExp(reason) });
    await expect(skill).toBeDisabled();
    await expect(skill.locator('small')).toBeVisible();
    await page.screenshot({ path: `test-results/ability-${blocked.replaceAll(' ', '-')}.png` });
    // A picker containing no usable rows must still offer a keyboard/touch exit.
    await expect(
      hud.locator('.mb-actions').getByRole('button', { name: 'Back', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(hud.getByRole('button', { name: 'Ability', exact: true })).toBeVisible();
    expect((await unit(page, 'Utility')).acted).toBe(false);
    expect((await unit(page, 'Utility')).ability?.map?.blink || 0).toBe(
      blocked === 'spent' ? 1 : 0,
    );
    expect(errors).toEqual([]);
  });
}
