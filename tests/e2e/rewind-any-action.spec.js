import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

// Rewind to before any player unit's action: phone (844×390, touch) and
// desktop (1280×800, keyboard + mouse). Real actions through the real UI; the
// digest compares the complete gameplay state the player can observe plus the
// battle RNG cursor, so "exact restore" and "same moves, same outcomes" are
// both checked, including after a reload.
const URL = '/?devScene=battle&preset=combat_actions&seed=42&battleLab=1';
const SHOTS = process.env.REWIND_SHOTS || '';
// iPhone SE touch/UA metrics at the landscape phone size (engine from the config).
const { defaultBrowserType: _engine, ...PHONE } = devices['iPhone SE'];

async function boot(page, { mobile = true } = {}) {
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: 'instant' }),
    ),
  );
  await page.goto(mobile ? `${URL}&mobilePreview=1` : URL);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = s.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    s.registry.set('activeSlot', 1);
    setActiveSlot(1);
    s.runManager.visionChargesRemaining = 3;
    s.updateVisionHud?.();
    s._captureSuspendCheckpoint();
  });
  return errors;
}

/** Everything a rewind must restore, plus the battle RNG. */
function digest(page) {
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = (u) => ({
      id: u.battleEntityId,
      pos: [u.col, u.row],
      hp: u.currentHP,
      acted: u.hasActed === true,
      moved: u.hasMoved === true,
      xp: u.xp,
      weapon: u.weapon?.name || null,
      items: (u.inventory || []).map((w) => [w.name, w.uses ?? null, w._usesSpent ?? 0]),
      consumables: (u.consumables || []).map((c) => [c.name, c.uses ?? null]),
      arts: u._battleWeaponArtUsage || null,
      abilities: u._battleAbilityUsage || null,
      conditions: (u._conditions || []).map((c) => c.id),
    });
    return {
      turn: s.turnManager.turnNumber,
      phase: s.turnManager.currentPhase,
      players: s.playerUnits.map(unit),
      enemies: s.enemyUnits.map(unit),
      gold: s.runManager.gold,
      goldEarned: s.goldEarned,
      rng: s._battleRng.getState(),
    };
  });
}

const charges = (page) =>
  page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').runManager.visionChargesRemaining,
  );
const idle = (page) =>
  page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    null,
    { timeout: 20000 },
  );
const acted = (page, name) =>
  page.waitForFunction(
    (n) =>
      window.__emblemRogueGame.scene.getScene('Battle').playerUnits.find((u) => u.name === n)
        ?.hasActed,
    name,
    { timeout: 20000 },
  );

async function tapTile(page, col, row, { touch = true } = {}) {
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
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
async function select(page, name, opts) {
  const pos = await page.evaluate((n) => {
    const u = window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.find((unit) => unit.name === n);
    return { col: u.col, row: u.row };
  }, name);
  await tapTile(page, pos.col, pos.row, opts);
}

/** Patient waits, Edric attacks the Knight, Sera heals Patient (phone HUD). */
async function threeActionsOnPhone(page) {
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  const states = [await digest(page)];
  await select(page, 'Patient');
  await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
  await idle(page);
  states.push(await digest(page));
  await select(page, 'Edric');
  await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
  await tapTile(page, 4, 3);
  await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
  await acted(page, 'Edric');
  await idle(page);
  states.push(await digest(page));
  await select(page, 'Sera');
  await hud.getByRole('button', { name: /^Heal \(/ }).tap();
  await hud.getByRole('button', { name: /^Heal / }).tap();
  await tapTile(page, 2, 4);
  await acted(page, 'Sera');
  await idle(page);
  states.push(await digest(page));
  return states;
}

async function reloadSavedBattle(page) {
  await page.evaluate(() => history.replaceState(null, '', '/?mobilePreview=1'));
  await page.reload();
  await waitForScene(page, 'Title');
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Save Slots', exact: true }).tap();
  await waitForScene(page, 'SlotPicker');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
  await waitForScene(page, 'Battle');
  await idle(page);
}

test.describe('phone 844×390', () => {
  test.use({ ...PHONE, viewport: { width: 844, height: 390 } });
  test.setTimeout(120000);

  test('lists every action newest first; rewinding before the second action is exact, repeatable and survives reload', async ({
    page,
  }) => {
    const errors = await boot(page);
    const states = await threeActionsOnPhone(page);
    const rngBeforeOpen = (await digest(page)).rng;
    await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
    const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
    await expect(picker).toBeVisible();
    const rows = picker.locator('.vr-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('.vr-title')).toHaveText('Before Sera’s heal on Patient');
    await expect(rows.nth(1).locator('.vr-title')).toHaveText('Before Edric’s attack on Knight');
    await expect(rows.nth(2).locator('.vr-title')).toHaveText('Start of turn 1');
    await expect(rows.nth(2).locator('.vr-sub')).toHaveText('before Patient’s wait');
    // Opens on the most recent point, which is visible and selected.
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(0)).toBeInViewport();
    await expect(rows.nth(0).locator('.vr-chip')).toHaveText(['+9 HP']);
    await expect(picker.locator('.vr-charges')).toContainText('3 left');
    const confirm = picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true });
    await expect(confirm).toBeInViewport();
    // One tap previews (free, nothing changes)...
    await rows.nth(1).tap();
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(picker.locator('.vr-status')).toContainText('Undoes the last 2 actions');
    await expect(picker.locator('.vr-ribbon')).toHaveText(
      'Turn 1 · before Edric’s attack on Knight',
    );
    await page.waitForFunction(
      () =>
        window.__emblemRogueGame.scene.getScene('Battle')._visionController._historySession?.scene
          ?.renderer?.frame,
    );
    expect(await charges(page)).toBe(3);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/rewind-phone-844x390.png` });
    // ...one tap confirms.
    await confirm.tap();
    await expect(picker).toHaveCount(0);
    await idle(page);
    expect(await charges(page)).toBe(2);
    const rewound = await digest(page);
    expect(rewound).toEqual(states[1]);
    expect(rewound.rng).not.toEqual(rngBeforeOpen);
    // Same move, same outcome: the attack resolves exactly as it did before.
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await select(page, 'Edric');
    await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
    await tapTile(page, 4, 3);
    await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
    await acted(page, 'Edric');
    await idle(page);
    expect(await digest(page)).toEqual(states[2]);
    // The rewind (and the repeated attack) persist: reload resumes exactly here.
    const beforeReload = await digest(page);
    await reloadSavedBattle(page);
    expect(await digest(page)).toEqual(beforeReload);
    expect(await charges(page)).toBe(2);
    // The rewound timeline carries on: the new attack is a destination too.
    await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
    await expect(picker.locator('.vr-row .vr-title')).toHaveText([
      'Before Edric’s attack on Knight',
      'Start of turn 1',
    ]);
    await picker.getByRole('button', { name: 'Back', exact: true }).tap();
    await expect(picker).toHaveCount(0);
    expect(await digest(page)).toEqual(beforeReload);
    expect(errors).toEqual([]);
  });

  test('previewing and closing never touches the battle, the save or the RNG', async ({ page }) => {
    const errors = await boot(page);
    await threeActionsOnPhone(page);
    const before = await digest(page);
    const saved = await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_run'));
    await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
    const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
    for (const index of [2, 1, 0, 2]) await picker.locator('.vr-row').nth(index).tap();
    await picker.getByRole('button', { name: 'History', exact: true }).tap();
    const history = page.getByRole('dialog', { name: 'Battle timeline', exact: true });
    await expect(history).toBeVisible();
    await history.getByRole('button', { name: 'Back to rewind', exact: true }).tap();
    await expect(picker).toBeVisible();
    await expect(picker.locator('.vr-row').nth(2)).toHaveAttribute('aria-selected', 'true');
    await picker.getByRole('button', { name: 'Back', exact: true }).tap();
    await expect(picker).toHaveCount(0);
    await idle(page);
    expect(await digest(page)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_run'))).toBe(saved);
    expect(await charges(page)).toBe(3);
    expect(errors).toEqual([]);
  });

  test('a traded-then-parked unit gets its own point, and the next unit rewinds without undoing the trade', async ({
    page,
  }) => {
    const errors = await boot(page);
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    // Support hands Patient a consumable, then is set aside without acting.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const support = s.playerUnits.find((u) => u.name === 'Support');
      support.consumables = [{ name: 'Vulnerary', effect: 'heal', value: 10, uses: 3 }];
      // Fixture loadout belongs to the turn start, not to a free bag change.
      s._timelineBoundary = 'turn_start';
      s._captureSuspendCheckpoint();
    });
    await select(page, 'Support');
    await hud.getByRole('button', { name: 'Trade', exact: true }).tap();
    await tapTile(page, 2, 4);
    const trade = page.getByRole('dialog', { name: 'Trade items', exact: true });
    await trade
      .getByRole('button', { name: /^Vulnerary/ })
      .first()
      .tap();
    await trade.getByRole('button', { name: 'Give Vulnerary to Patient', exact: true }).tap();
    await trade.getByRole('button', { name: 'Done', exact: true }).tap();
    // Leave the action menu: Support stays committed but has not acted.
    await page.keyboard.press('Escape');
    await idle(page);
    const afterTrade = await digest(page);
    expect(afterTrade.players.find((u) => u.id && u.consumables.length)).toBeTruthy();
    await select(page, 'Patient');
    await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
    await idle(page);
    await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
    const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
    await expect(picker.locator('.vr-row .vr-title')).toHaveText([
      'Before Patient’s wait',
      'Start of turn 1',
    ]);
    await expect(picker.locator('.vr-row').nth(1).locator('.vr-sub')).toHaveText(
      'before Support’s trade with Patient',
    );
    await picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true }).tap();
    await idle(page);
    expect(await digest(page)).toEqual(afterTrade);
    expect(errors).toEqual([]);
  });
});

test.describe('desktop 1280×800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.setTimeout(120000);

  test('R opens Rewind; arrows preview, Enter moves to the button, Enter spends', async ({
    page,
  }) => {
    const errors = await boot(page, { mobile: false });
    const states = [await digest(page)];
    // Desktop actions through the canvas menus' own handlers.
    for (const name of ['Patient', 'Support', 'Utility']) {
      // The canvas menu's Wait handler, exactly.
      await page.evaluate((n) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const u = s.playerUnits.find((unit) => unit.name === n);
        s.selectUnit(u);
        s.showActionMenu(u);
        s.finishUnitAction(u, { skipCanto: true });
      }, name);
      await idle(page);
      states.push(await digest(page));
    }
    await page.keyboard.press('r');
    const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
    await expect(picker).toBeVisible();
    await expect(picker.locator('.vr-row .vr-title')).toHaveText([
      'Before Utility’s wait',
      'Before Support’s wait',
      'Start of turn 1',
    ]);
    await expect(picker.locator('.vr-row').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(picker.locator('.vr-row').nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    const confirm = picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true });
    await expect(confirm).toBeFocused();
    expect(await charges(page)).toBe(3);
    await page.waitForTimeout(600);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/rewind-desktop-1280x800.png` });
    await page.keyboard.press('Enter');
    await expect(picker).toHaveCount(0);
    await idle(page);
    expect(await charges(page)).toBe(2);
    expect(await digest(page)).toEqual(states[1]);
    // Mouse: reopen, click the turn start, click Rewind here.
    await page.keyboard.press('r');
    await picker.locator('.vr-row').last().click();
    await picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true }).click();
    await idle(page);
    expect(await digest(page)).toEqual(states[0]);
    expect(await charges(page)).toBe(1);
    expect(errors).toEqual([]);
  });
});
