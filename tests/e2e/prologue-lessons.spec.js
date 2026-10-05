// P1, "Banner at Dawn", on a phone: the title promotes the prologue (a fresh device's
// item starts the prologue run), the guided steps gate the first select and the move
// to the Fort, the core note reads over the thing it explains (the forecast's own
// numbers), the reinforcement is a tip that never takes the rail (the Fort, the
// Vulnerary beside the map; the triangle a line in the forecast itself), each marks
// the slot's hint only once read, and victory takes the run on to its route map while
// recording only the lessons read.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test.setTimeout(120000);
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
test('a fresh prologue teaches the forecast as a note, the Fort, the triangle and the Vulnerary as tips, then goes on to the route', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Title');
  // The title is DOM: the promoted prologue leads the run column with its subtitle
  // inside the same 44px+ tap target.
  const prologue = page.getByRole('button', { name: /^Prologue/ });
  await expect(prologue).toBeVisible();
  await expect(prologue).toHaveClass(/is-primary/);
  await expect(prologue.locator('.re-title-subtext')).toHaveText('Start here');
  const fits = await prologue.evaluate((b) => {
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
  if (!fits) throw new Error('Prologue recommendation must fit its tap target');
  await prologue.tap();
  await waitForScene(page, 'Battle');
  const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
  // Teach by doing: no welcome wall. The coach states one goal at a time over the map
  // and always offers a way out.
  const coach = page.getByRole('region', { name: 'Prologue guide', exact: true });
  await expect(coach).toBeVisible({ timeout: 15000 });
  await expect(coach.locator('.re-coach-goal')).toHaveText('Select Edric');
  await expect(
    coach.getByRole('button', { name: 'Skip the rest of the prologue', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').runManager?.mode),
  ).toBe('prologue');
  await expect(note).toHaveCount(0);
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s._prologue?.gate?.kind === 'select' && s.battleState === 'PLAYER_IDLE';
  });
  // Edric is the only unit to select; the right tap moves the goal to the Fort, and a
  // tap on any other tile is a nudge, not a note.
  await tapTile(page, 0, 2);
  await expect(coach.locator('.re-coach-goal')).toHaveText('Move onto the Fort');
  await expect(note).toHaveCount(0);
  await tapTile(page, 2, 2);
  await expect(coach.locator('.re-coach-nudge')).toHaveText('Move Edric to the gold-framed Fort.');
  await tapTile(page, 3, 2);
  // The Fort is reinforcement: a tip beside the map, the rail live underneath.
  const fortTip = page.locator('.re-guide[data-guide="prologue:battle_terrain"]');
  await expect(fortTip).toContainText('Fort tile reached');
  await expect(fortTip).toContainText('Defense +2');
  await expect(fortTip.locator('.re-guide-kicker')).toHaveText('Tip');
  await expect(note).toHaveCount(0);
  await expect(page.locator('.mobile-battle-hud')).toBeVisible();
  expect(await page.locator('.mobile-battle-hud').evaluate((e) => e.inert)).toBe(false);
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle')._mobileTerrainFocus,
    ),
  ).toEqual({ col: 3, row: 2 });
  await page.screenshot({ path: info.outputPath('fort-tip.png') });
  await page.waitForFunction(
    () => !window.__emblemRogueGame.scene.getScene('Battle')._prologue.isGateActive(),
  );
  const hintSeen = (id) =>
    page.evaluate((hint) => window.__emblemRogueGame.registry.get('hints').hasSeen(hint), id);
  // Shown is not read: the slot's terrain hint waits for the player to read the tip.
  expect(await hintSeen('battle_terrain')).toBe(false);
  await fortTip.getByRole('button', { name: 'Got it', exact: true }).tap();
  await expect(fortTip).toHaveCount(0);
  expect(await hintSeen('battle_terrain')).toBe(true);

  // The core forecast lesson reads over the forecast's own numbers (against `a`).
  for (const [expected, target] of [['Reading a forecast', 'a']]) {
    await page.evaluate((id) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        attacker = s.playerUnits[0],
        d = s.enemyUnits.find((u) => u.authoredId === id);
      s.hideForecast();
      s.hideActionMenu();
      d.col = attacker.col + 1;
      d.row = attacker.row;
      void s.showForecast(attacker, d);
    }, target);
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
  // The triangle against the holding Fighter `b`: one line in the forecast's own notes,
  // never a note over it; read when the player cancels (or confirms).
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      attacker = s.playerUnits[0],
      d = s.enemyUnits.find((u) => u.authoredId === 'b');
    s.hideForecast();
    s.hideActionMenu();
    d.col = attacker.col + 1;
    d.row = attacker.row;
    void s.showForecast(attacker, d);
  });
  const forecast = page.getByRole('dialog', { name: 'Combat forecast', exact: true });
  await expect(forecast).toContainText('Swords beat axes, axes beat lances, lances beat swords.');
  await expect(note).toHaveCount(0);
  expect(await forecast.locator('..').evaluate((e) => e.inert)).toBe(false);
  expect(await hintSeen('battle_triangle')).toBe(false);
  await forecast.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect.poll(() => hintSeen('battle_triangle')).toBe(true);
  // A hit that leaves Edric at 60% or less tips the Vulnerary with its real numbers.
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      edric = s.playerUnits[0];
    edric.currentHP = 11;
    void s._prologue.onCombatResolved(s.enemyUnits[0], edric, { initiator: 'enemy' });
  });
  const vulneraryTip = page.locator('.re-guide[data-guide="prologue:battle_consumable_supply"]');
  await expect(vulneraryTip).toContainText('Item → Vulnerary heals 10 HP');
  await expect(note).toHaveCount(0);
  await vulneraryTip.getByRole('button', { name: 'Got it', exact: true }).tap();
  await expect(vulneraryTip).toHaveCount(0);

  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  // Gaspar rides in: two lines, then the run goes on to its route map (no handoff).
  const edricLine = page.getByRole('dialog', { name: 'Edric', exact: true });
  await expect(edricLine).toContainText('You swore you were done with saddles.');
  await edricLine.getByRole('button', { name: 'Continue', exact: true }).tap();
  const gasparLine = page.getByRole('dialog', { name: 'Gaspar', exact: true });
  await expect(gasparLine).toContainText('The saddle was not consulted.');
  await gasparLine.getByRole('button', { name: 'Continue', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  // The only note now is the route map's own first-visit note, never a handoff.
  await expect(note).toContainText('Tap any node to preview it');
  const taught = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_tutorial_lessons')),
  );
  expect(taught.sort()).toEqual([
    'battle_consumable_supply',
    'battle_first_turn',
    'battle_forecast',
    'battle_terrain',
    'battle_triangle',
  ]);
  const meta = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_slot_1_meta')),
  );
  expect(meta.prologue).toMatchObject({
    state: 'in_progress',
    chaptersCompleted: ['p1_banner_at_dawn'],
    practised: [], // the forecasts here were looked at, never committed
  });
  expect(meta.runsStarted).toBe(0);
  expect(errors).toEqual([]);
});
