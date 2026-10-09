// The desktop battle camera (docs/specs/large-maps/01-camera-and-navigation.md).
//
// Desktop has no battle camera controller today: the board is centred on the main camera
// once, at scroll 0, and the HUD plates are world objects drawn at the canvas corners.
// §1.5.1: [N] on a unit near the view's edge used to `centerOn` the main camera with
// nothing to clamp it, carrying the whole battle (plates included) off by a quarter of
// the canvas and leaving it there. [N] must locate the unit and leave the view alone.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.setTimeout(120000);

// The HUD objects the desktop plates are drawn from (DesktopBattleHud), by scene key.
const PLATE_KEYS = [
  'turnCounterText',
  'visionHudText',
  'objectiveText',
  'dangerButton',
  'rosterButton',
  'endTurnButton',
  'instructionText2',
];

async function bootDesktopBattle(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  return errors;
}

/**
 * Re-open the battle on a generated Act IV board (18 columns). The dev routes reach Act II
 * at most (14x10 or 16x10), where column 0 still sits inside the locator's comfortable
 * margin, so they cannot show the drift. No node id: nothing is locked or resumed.
 */
async function reopenOnLargeBoard(page) {
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    window.__previousGrid = s.grid;
    s.scene.restart({
      ...s.sys.settings.data,
      nodeId: null,
      battleParams: { ...s.battleParams, act: 'act4', objective: 'rout', battleSeed: 7 },
    });
  });
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s?.grid && s.grid !== window.__previousGrid && s.battleState === 'PLAYER_IDLE';
  });
}

/** Put `name` on the open column-0 tile nearest where it stands (boardSetup's "open"). */
function placeOnColumnZero(page, name) {
  return page.evaluate((name) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const grid = s.grid;
    const unit = s.playerUnits.find((u) => u.name === name);
    if (!unit) throw new Error(`no player unit named ${name}`);
    if (unit.col === 0) return { col: 0, row: unit.row };
    const open = (c, r) => {
      const terrain = grid.getTerrainAt(c, r);
      if (!terrain) return false;
      if (!['Infantry', 'Armored', 'Cavalry', 'Flying'].every((t) => terrain.moveCost[t] === '1'))
        return false;
      if (s.getUnitAt(c, r)) return false;
      return !(s.npcUnits || []).some((n) => n.col === c && n.row === r);
    };
    let best = null;
    for (let row = 0; row < grid.rows; row++) {
      if (!open(0, row)) continue;
      const d = Math.abs(row - unit.row);
      if (!best || d < best.d) best = { row, d };
    }
    if (!best) throw new Error('no open tile on column 0');
    unit.col = 0;
    unit.row = best.row;
    s.updateUnitPosition(unit);
    return { col: 0, row: best.row };
  }, name);
}

/** The main camera and where each plate is drawn on the canvas (world − scroll × factor). */
function readView(page, keys) {
  return page.evaluate((keys) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const cam = s.cameras.main;
    const onCanvas = (obj) => ({
      x: Math.round((obj.x - cam.scrollX * obj.scrollFactorX) * cam.zoom),
      y: Math.round((obj.y - cam.scrollY * obj.scrollFactorY) * cam.zoom),
    });
    const plates = {};
    for (const key of keys) if (s[key]) plates[key] = onCanvas(s[key]);
    if (s._desktopHud?.plates) plates.platesGraphic = onCanvas(s._desktopHud.plates);
    return {
      scroll: { x: cam.scrollX, y: cam.scrollY, zoom: cam.zoom },
      view: { x: cam.worldView.x, y: cam.worldView.y },
      plates,
    };
  }, keys);
}

test('desktop: [N] on a column-0 unit keeps the view and the HUD plates put', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = await bootDesktopBattle(page);
  await reopenOnLargeBoard(page);

  const setup = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      cols: s.grid.cols,
      controller: Boolean(s._battleCamera),
      desktopHud: Boolean(s._desktopHud?.active),
    };
  });
  // A desktop battle: no camera controller, the canvas HUD plates in use.
  expect(setup).toEqual({ cols: 18, controller: false, desktopHud: true });

  const target = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.playerUnits.find((u) => u.name !== 'Edric' && u.currentHP > 0 && !u.hasActed).name;
  });
  const tile = await placeOnColumnZero(page, target);
  // The test is only meaningful if the locator would judge this unit off-comfort: its
  // tile lies inside the 12% margin of the view (what used to trigger the centring).
  const uncomfortable = await page.evaluate(({ col, row }) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const p = s.grid.gridToPixel(col, row);
    const v = s.cameras.main.worldView;
    return p.x < v.x + v.width * 0.12;
  }, tile);
  expect(uncomfortable).toBe(true);

  const before = await readView(page, PLATE_KEYS);
  expect(before.scroll).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(Object.keys(before.plates)).toEqual([...PLATE_KEYS, 'platesGraphic']);

  // Walk every ready unit with [N] (reading order), cancelling in between; the column-0
  // unit is one of them. After each, the view and every plate are exactly where they were.
  const ready = await page.evaluate(
    () =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .playerUnits.filter((u) => u.currentHP > 0 && !u.hasActed).length,
  );
  await page.locator('canvas').first().hover();
  const located = [];
  for (let i = 0; i < ready; i++) {
    await page.keyboard.press('n');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          return s.battleState === 'UNIT_SELECTED' && Boolean(s._unitLocator);
        }),
      )
      .toBe(true);
    located.push(
      await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name,
      ),
    );
    expect(await readView(page, PLATE_KEYS)).toEqual(before);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
  }
  // Each press located the next unit: every ready unit once, the column-0 unit among them.
  expect(new Set(located).size).toBe(ready);
  expect(located).toContain(target);
  // Still put once the locator's brackets have faded.
  await page.waitForFunction(() => !window.__emblemRogueGame.scene.getScene('Battle')._unitLocator);
  expect(await readView(page, PLATE_KEYS)).toEqual(before);
  expect(errors).toEqual([]);
  await context.close();
});
