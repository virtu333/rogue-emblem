// Zombie remains (playtest 2026-09-29 #11): a fallen Zombie leaves a bone pile with a
// countdown of the enemy phases before it rises; Smash finishes it, and the last
// remains of a Rout win the battle. Review preset: devScenarios.js `zombie_remains`
// (the Rout is down to one weak Zombie beside Edric). Upright phones: the portrait lane
// (portrait-remains.spec.js).
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

const URL = '/?devScene=battle&preset=zombie_remains&seed=42';
// A whole attack, an enemy phase and a Smash: more than the default 30 s under load.
test.setTimeout(120_000);

async function boot(page, extra = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  await page.goto(URL + extra);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.battleState === 'PLAYER_IDLE' && s._devScenarioResult;
  });
  // The review's field note (shown before turn 1) is read and put away.
  const note = page.getByRole('button', { name: 'Continue', exact: true });
  if (await note.count()) await note.click();
  return errors;
}

/** Screen point (CSS px) of a tile's centre, through the board's presentation. */
async function tilePoint(page, col, row) {
  return page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(col, row);
      const p = s._worldToScreen(w.x, w.y);
      const r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
}

/** What the board shows: the remains, the drawn countdowns, the objective, the phase. */
async function remainsState(page) {
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const labels = (s.children?.list || []).filter(
      (o) => o.name === 'remains-countdown' && o.active !== false,
    );
    return {
      records: (s._zombieTombstones || []).map((r) => [r.col, r.row, r.turnsRemaining]),
      shown: (s._remainsCtrl?.markers?.shown || []).map((m) => [m.col, m.row, m.turnsRemaining]),
      countdowns: labels.map((o) => o.text),
      enemies: s.enemyUnits.length,
      objective: s.objectiveText?.text || '',
      state: s.battleState,
      phase: s.turnManager?.currentPhase,
      turn: s.turnManager?.turnNumber,
    };
  });
}

const scenario = (page) =>
  page.evaluate(() => {
    const r = window.__emblemRogueGame.scene.getScene('Battle')._devScenarioResult;
    return { edric: { col: r.unit.col, row: r.unit.row }, spot: r.spot };
  });

test.describe('landscape phone: the rail', () => {
  // eslint-disable-next-line no-unused-vars
  const { defaultBrowserType, ...iPhoneSE } = devices['iPhone SE'];
  test.use({ ...iPhoneSE, viewport: { width: 667, height: 375 } });

  test('fell the Zombie: "3"; end turns: "2"; Smash: the bones go and the Rout is won', async ({
    page,
  }) => {
    const errors = await boot(page, '&mobilePreview=1&battleLab=1');
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    const { edric, spot } = await scenario(page);

    // Edric attacks the Zombie from where he stands.
    let p = await tilePoint(page, edric.col, edric.row);
    await page.touchscreen.tap(p.x, p.y);
    await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
    p = await tilePoint(page, spot.col, spot.row);
    await page.touchscreen.tap(p.x, p.y);
    await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
    await expect
      .poll(async () => (await remainsState(page)).records, { timeout: 20_000 })
      .toEqual([[spot.col, spot.row, 3]]);
    await expect.poll(async () => (await remainsState(page)).countdowns).toEqual(['3']);
    let now = await remainsState(page);
    expect(now.enemies).toBe(0);
    expect(now.objective).toContain('1 reviving');
    await page.screenshot({ path: 'test-results/zombie-remains-landscape.png' });

    // The tile says what the bones are and when they rise.
    await page.touchscreen.tap(p.x, p.y);
    await expect(hud.locator('.mb-remains')).toHaveText('Zombie remains · rises in 3 enemy phases');

    // End the turn: one enemy phase passes, the count falls to 2.
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
    await hud.getByRole('button', { name: 'End turn now', exact: true }).tap();
    await expect
      .poll(
        async () => {
          const s = await remainsState(page);
          return [s.turn, s.phase, s.state, s.countdowns];
        },
        { timeout: 20_000 },
      )
      .toEqual([2, 'player', 'PLAYER_IDLE', ['2']]);

    // Smash: a rail command, then the pile.
    p = await tilePoint(page, edric.col, edric.row);
    await page.touchscreen.tap(p.x, p.y);
    await hud.getByRole('button', { name: 'Smash', exact: true }).tap();
    await expect
      .poll(async () => (await remainsState(page)).state)
      .toBe('SELECTING_REMAINS_TARGET');
    p = await tilePoint(page, spot.col, spot.row);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(async () => (await remainsState(page)).records).toEqual([]);
    now = await remainsState(page);
    expect(now.shown).toEqual([]);
    expect(now.countdowns).toEqual([]);
    await expect.poll(async () => (await remainsState(page)).state).toBe('BATTLE_END');
    expect(errors).toEqual([]);
  });
});

test.describe('desktop: mouse and keyboard', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Smash from the canvas menu with the keyboard, the pile picked with the mouse', async ({
    page,
  }) => {
    const errors = await boot(page);
    const { edric, spot } = await scenario(page);
    // Fell the Zombie (the real death path; the landscape test attacks through the UI).
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const r = s._devScenarioResult;
      await s.removeUnit(r.zombie, { killer: r.unit });
    });
    await expect.poll(async () => (await remainsState(page)).countdowns).toEqual(['3']);
    await page.screenshot({ path: 'test-results/zombie-remains-desktop.png' });

    // Hovering the pile names it in the tile info.
    let p = await tilePoint(page, spot.col, spot.row);
    await page.mouse.move(p.x, p.y);
    await expect
      .poll(() =>
        page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').infoText.text),
      )
      .toContain('Zombie remains · rises in 3 enemy phases');

    // Select Edric, stay, then walk the canvas menu to Smash with the arrow keys.
    p = await tilePoint(page, edric.col, edric.row);
    await page.mouse.click(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
    );
    const index = await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        ._menuFocus.items.findIndex((item) => item.id === 'smash'),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await remainsState(page)).state)
      .toBe('SELECTING_REMAINS_TARGET');
    p = await tilePoint(page, spot.col, spot.row);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await remainsState(page)).records).toEqual([]);
    await expect.poll(async () => (await remainsState(page)).state).toBe('BATTLE_END');
    expect(errors).toEqual([]);
  });
});
