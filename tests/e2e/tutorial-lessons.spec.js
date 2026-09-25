import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test.setTimeout(90000);
async function tapTile(page, col, row) {
  const p = await page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        w = s.grid.gridToPixel(col, row),
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
test('fresh tutorial teaches visible terrain, forecast and resource lessons with safe first-run handoff', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Title');
  // The title is DOM: the promoted tutorial leads the run column with its subtitle
  // inside the same 44px+ tap target.
  const tutorial = page.getByRole('button', { name: /^Tutorial/ });
  await expect(tutorial).toBeVisible();
  await expect(tutorial).toHaveClass(/is-primary/);
  await expect(tutorial.locator('.re-title-subtext')).toHaveText('Start here');
  const fits = await tutorial.evaluate((b) => {
    const box = b.getBoundingClientRect();
    return (
      [...b.querySelectorAll('span')].every((s) => {
        const r = s.getBoundingClientRect();
        return (
          r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom
        );
      }) && box.height >= 44
    );
  });
  if (!fits) throw new Error('Tutorial recommendation must fit its tap target');
  await tutorial.tap();
  await waitForScene(page, 'Battle');
  const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
  // Teach by doing: no welcome wall. The coach states one goal at a time over the map
  // and always offers a way out.
  const coach = page.getByRole('region', { name: 'Tutorial guide', exact: true });
  await expect(coach).toBeVisible({ timeout: 15000 });
  await expect(coach.locator('.re-coach-goal')).toHaveText('Select Edric');
  await expect(coach.getByRole('button', { name: 'Leave tutorial', exact: true })).toBeVisible();
  await expect(note).toHaveCount(0);
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').tutorialStep === 2,
  );
  await tapTile(page, 1, 2);
  await expect(coach.locator('.re-coach-goal')).toHaveText('Move onto the Fort');
  await expect(note).toHaveCount(0);
  await tapTile(page, 3, 3);
  await expect(note).toContainText('Fort tile reached');
  await expect(note).toContainText('Defense +2');
  await expect(page.locator('.mobile-battle-hud')).toBeVisible();
  await expect.poll(() => page.locator('.mobile-battle-hud').evaluate((e) => e.inert)).toBe(true);
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle')._mobileTerrainFocus,
    ),
  ).toEqual({ col: 3, row: 3 });
  await page.screenshot({ path: info.outputPath('fort-note.png') });
  await note.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')._tutorialStrictGateReleased,
  );

  // Controlled matchup exercises each real forecast lesson without depending on AI movement or random hits.
  for (const expected of ['Review damage per hit', 'Weapon triangle', 'Attack speed']) {
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        a = s.playerUnits[0],
        d = s.enemyUnits[0];
      s.hideForecast();
      s.hideActionMenu();
      a.skills = [];
      d.skills = [];
      a.accessory = null;
      d.accessory = null;
      a.stats.SPD = 20;
      d.stats.SPD = 1;
      a.stats.STR = 10;
      d.stats.HP = 100;
      d.currentHP = 100;
      d.col = a.col + 1;
      d.row = a.row;
      a.weapon = { ...s.gameData.weapons.find((w) => w.name === 'Iron Sword') };
      a.inventory = [a.weapon];
      d.weapon = { ...s.gameData.weapons.find((w) => w.name === 'Iron Axe') };
      d.inventory = [d.weapon];
      void s.showForecast(a, d);
    });
    await expect(note).toContainText(expected);
    const forecast = page.getByRole('dialog', { name: 'Combat forecast', exact: true });
    await expect(forecast).toBeVisible();
    await expect.poll(() => forecast.locator('..').evaluate((e) => e.inert)).toBe(true);
    expect(await note.getByRole('button', { name: 'Continue', exact: true }).count()).toBe(1);
    await expect(page.locator('.mb-tutorial-forecast')).toBeVisible();
    await expect
      .poll(
        async () => {
          const subjects = await page.locator('.mb-tutorial-subject').all();
          const noteRect = await note.boundingBox();
          if (!subjects.length || !noteRect) return false;
          for (const subject of subjects) {
            const rect = await subject.boundingBox();
            if (!rect || rect.y < 0 || rect.y + rect.height > noteRect.y - 1) return false;
          }
          return true;
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`forecast-${expected.split(' ')[0]}.png`) });
    await note.getByRole('button', { name: 'Continue', exact: true }).tap();
    await expect(note).toHaveCount(0);
    await expect(page.locator('.mb-tutorial-forecast')).toHaveCount(0);
    await expect.poll(() => forecast.locator('..').evaluate((e) => e.inert)).toBe(false);
    await forecast.getByRole('button', { name: 'Cancel', exact: true }).tap();
  }
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      sera = s.playerUnits.find((u) => u.name === 'Sera'),
      edric = s.playerUnits[0];
    edric.currentHP = 1;
    sera.col = edric.col;
    sera.row = edric.row + 1;
    s.selectedUnit = sera;
    s.battleState = 'UNIT_ACTION_MENU';
    s.startHealTargetSelection(sera, [edric]);
  });
  await expect(note).toContainText('Staff uses refill every battle');
  await note.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'SELECTING_HEAL_TARGET',
  );
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  await expect(note).toContainText('completed the tutorial');
  // A fresh player may go straight into the first run; this path returns to the title.
  await expect(note.getByRole('button', { name: 'Start first run', exact: true })).toBeVisible();
  await note.getByRole('button', { name: 'Back to title', exact: true }).tap();
  await waitForScene(page, 'Title');
  await expect(page.getByRole('button', { name: 'Start First Run', exact: true })).toBeVisible();
  const taught = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_tutorial_lessons')),
  );
  expect(taught).toEqual(
    expect.arrayContaining([
      'battle_terrain',
      'battle_triangle',
      'battle_doubling',
      'battle_staff_scope',
    ]),
  );
  expect(errors).toEqual([]);
});
