import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

// The Roster from the formation screen (src/ui/FormationRoster.js): manage gear and
// items before turn 1, then come back to placement with everyone where they stood.
// eslint-disable-next-line no-unused-vars
const { defaultBrowserType, ...IPHONE } = devices['iPhone 13'];
const PHONE = '/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&formation=1';
const DESKTOP = '/?devScene=battle&preset=combat_actions&seed=42&formation=1';

const battle = (page, fn, arg) =>
  page.evaluate(
    ([source, a]) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return new Function('s', 'a', source)(s, a);
    },
    [fn, arg],
  );

async function ready(page, url) {
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')._formation?.ready === true,
    null,
    { timeout: 30_000 },
  );
}

const snapshot = (page) =>
  battle(
    page,
    `const f = s._formation;
     return {
       session: s._battleSession,
       state: s.battleState,
       tiles: f.units.map((u, i) => [u.name, f.formation.at[i] === null ? null : f.tiles[f.formation.at[i]]]),
       edricConsumables: f.units[0].consumables.map((i) => i.uid),
       convoy: s.runManager.convoy.consumables.map((i) => i.uid),
       flag: Boolean(s.runManager.battleInProgress),
     };`,
  );

/** Wait for the battle the Roster's close re-opened (a new session, placement ready). */
const reopened = (page, session) =>
  page.waitForFunction(
    (n) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return s._battleSession > n && s._formation?.ready === true;
    },
    session,
    { timeout: 30_000 },
  );

test.describe('phone', () => {
  test.use({ ...IPHONE, viewport: { width: 844, height: 390 } });

  test('Roster on the rail: store an item, come back to the same formation, start', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await ready(page, PHONE);
    const rail = page.getByRole('complementary', { name: 'Battle commands' });
    await rail.getByRole('button', { name: 'Auto-place', exact: true }).tap();
    // One unit waits, so waiting is kept as well as placement.
    await battle(page, 's._formation.unplace(4);');
    const before = await snapshot(page);
    expect(before.flag).toBe(true);
    const vulnerary = before.edricConsumables[0];
    expect(vulnerary).toBeTruthy();

    await rail.getByRole('button', { name: /^Roster/ }).tap();
    const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
    await expect(sheet).toBeVisible();
    // The run left the battle as Back to map does: the save says "on the map".
    expect((await snapshot(page)).flag).toBe(false);
    await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
    // Edric's Vulnerary goes to the convoy (his consumable row's Store).
    await sheet.getByRole('button', { name: 'Store', exact: true }).last().tap();
    await sheet.getByRole('button', { name: 'Back to formation', exact: true }).tap();
    await expect(sheet).toHaveCount(0);
    await reopened(page, before.session);

    const after = await snapshot(page);
    expect(after.state).toBe('DEPLOY_POSITIONING');
    expect(after.tiles).toEqual(before.tiles);
    expect(after.edricConsumables).not.toContain(vulnerary);
    expect(after.convoy.filter((uid) => uid === vulnerary)).toHaveLength(1);
    expect(after.flag).toBe(true); // the battle was entered again
    await expect(rail).toContainText('Roster saved');
    await expect(rail).toContainText('4 / 5 placed');

    await rail.getByRole('button', { name: 'Auto-place', exact: true }).tap();
    await rail.getByRole('button', { name: 'Start battle', exact: true }).tap();
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
    expect(await battle(page, 'return s.playerUnits.length;')).toBe(5);
    expect(errors).toEqual([]);
  });

  test("a placed unit's menu opens the Roster on that unit", async ({ page }) => {
    await ready(page, PHONE);
    const rail = page.getByRole('complementary', { name: 'Battle commands' });
    await rail.getByRole('button', { name: 'Auto-place', exact: true }).tap();
    await battle(page, 's._formation.holdUnit(s._formation.units[1]);');
    await rail.getByRole('button', { name: 'Options', exact: true }).tap();
    const menu = page.getByRole('dialog', { name: 'Sera', exact: true });
    await menu.getByRole('button', { name: 'Gear & skills', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Sera, Level/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test('desktop: the dock offers Roster; O opens it, Escape comes back to placement', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, DESKTOP);
  const dock = page.getByRole('region', { name: 'Formation' });
  await dock.getByRole('button', { name: 'Auto-place', exact: true }).click();
  await expect(dock.getByRole('button', { name: /^Roster/ })).toBeVisible();
  const before = await snapshot(page);

  await page.keyboard.press('o');
  const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await expect(sheet).toBeVisible();
  await expect(page.locator('.fm-dock')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await reopened(page, before.session);
  const after = await snapshot(page);
  expect(after.tiles).toEqual(before.tiles);
  // Nothing changed in the Roster: no "saved" line.
  await expect(page.getByRole('region', { name: 'Formation' })).not.toContainText('Roster saved');
  expect(errors).toEqual([]);
});
