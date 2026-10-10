import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
import {
  PORTRAIT_PHONES,
  expectNoSidewaysScroll,
  expectPortraitUi,
  expectTappable,
  pageErrors,
  phone as phoneContext,
  quietSettings,
} from './portraitHelpers.js';

// phone() spreads a device descriptor whose defaultBrowserType would force a new worker
// inside a describe group; the lane runs Chromium either way.
// eslint-disable-next-line no-unused-vars
const phone = (viewport) => (({ defaultBrowserType, ...rest }) => rest)(phoneContext(viewport));

// Formation on an upright phone: a tap on a visible foe shows that foe's own move and
// attack range and its summary in the rail, as it does on a turn (playtest: only the
// global Danger zone could be read before turn 1).
//
// Failure modes each test guards against:
//   - the tap opens nothing, or the foe's range is never drawn in DEPLOY_POSITIONING;
//   - the range is wiped by a formation redraw, or lingers after the foe is tapped
//     again, bare terrain is tapped, a unit is picked up or Start battle is pressed;
//   - looking at a foe puts the unit in hand down;
//   - the foe's summary or View unit pushes Start battle out of reach, or the page
//     scrolls sideways;
//   - Danger's purple outline (status-staff reach) is drawn with no word for it.

const ROUTE = '/?devScene=battle&preset=combat_actions&seed=42&formation=1';
const OUT = process.env.FORMATION_INSPECT_SHOTS || '';

const battle = (page, source, arg) =>
  page.evaluate(
    ([src, a]) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return new Function('s', 'a', src)(s, a);
    },
    [source, arg],
  );

const rail = (page) => page.getByRole('complementary', { name: 'Battle commands' });

const tileCss = (page, col, row) =>
  battle(
    page,
    `const w = s.grid.gridToPixel(a.col, a.row);
     const p = s._worldToScreen(w.x, w.y);
     const r = s.game.canvas.getBoundingClientRect();
     return { x: r.left + (p.x * r.width) / s.scale.width, y: r.top + (p.y * r.height) / s.scale.height };`,
    { col, row },
  );

const lit = (page) =>
  battle(
    page,
    `return {
       move: s.grid.highlightTiles.length,
       attack: s.grid.attackHighlightTiles.length,
       panel: s.inspectionPanel.visible ? s.inspectionPanel._unit?.name : null,
       held: s._formation.heldUnit?.name ?? null,
       state: s.battleState,
     };`,
  );

/** A foe the player can see whose tile is inside the canvas (the first one, deterministic). */
const visibleFoe = (page) =>
  battle(
    page,
    `const r = s.game.canvas.getBoundingClientRect();
     const on = (u) => {
       const w = s.grid.gridToPixel(u.col, u.row); const p = s._worldToScreen(w.x, w.y);
       const x = r.left + (p.x * r.width) / s.scale.width, y = r.top + (p.y * r.height) / s.scale.height;
       return x > r.left + 8 && x < r.right - 8 && y > r.top + 8 && y < r.bottom - 8;
     };
     const foe = s.enemyUnits.find((u) => u.currentHP > 0 && u.weapon && u.graphic?.visible !== false && on(u));
     return foe ? { name: foe.name, col: foe.col, row: foe.row } : null;`,
  );

/** An open tile (not a formation tile, nobody on it, on screen) to tap as "bare terrain". */
const bareTile = (page) =>
  battle(
    page,
    `const r = s.game.canvas.getBoundingClientRect();
     const formation = new Set(s._formation.tiles.map((t) => t.col + ',' + t.row));
     const taken = new Set([...s.playerUnits, ...s.enemyUnits, ...s.npcUnits].map((u) => u.col + ',' + u.row));
     for (let row = 0; row < s.grid.rows; row++) for (let col = 0; col < s.grid.cols; col++) {
       const k = col + ',' + row;
       if (formation.has(k) || taken.has(k)) continue;
       const w = s.grid.gridToPixel(col, row); const p = s._worldToScreen(w.x, w.y);
       const x = r.left + (p.x * r.width) / s.scale.width, y = r.top + (p.y * r.height) / s.scale.height;
       if (x > r.left + 16 && x < r.right - 16 && y > r.top + 16 && y < r.bottom - 16)
         return { col, row };
     }
     return null;`,
  );

async function formation(page) {
  await quietSettings(page);
  await page.goto(ROUTE);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')._formation?.ready === true,
    null,
    { timeout: 30_000 },
  );
  await expectPortraitUi(page);
}

for (const size of [PORTRAIT_PHONES[0], PORTRAIT_PHONES[1]]) {
  test.describe(`Formation inspection upright ${size.width}x${size.height}`, () => {
    test.use(phone(size));

    test('a tap on a visible foe shows its range and summary; tapping again, terrain, a unit or Start clears it', async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const errors = pageErrors(page);
      await formation(page);
      const hud = rail(page);
      expect(await battle(page, 'return s.grid.board.rotation')).toBe('ccw');
      const foe = await visibleFoe(page);
      expect(foe, 'a visible foe on screen').not.toBeNull();
      const at = await tileCss(page, foe.col, foe.row);

      // Nothing is drawn before the tap.
      expect(await lit(page)).toMatchObject({ move: 0, attack: 0, panel: null });

      await page.touchscreen.tap(at.x, at.y);
      await expect
        .poll(() => lit(page))
        .toMatchObject({ panel: foe.name, state: 'DEPLOY_POSITIONING' });
      const shown = await lit(page);
      expect(shown.move).toBeGreaterThan(0);
      expect(shown.attack).toBeGreaterThan(0);
      // The rail names the foe and offers its details; Start battle stays whole.
      await expect(hud.locator('.mb-summary')).toContainText(foe.name);
      await expectTappable(hud.getByRole('button', { name: 'View unit', exact: true }));
      await expect(hud.getByRole('button', { name: /^Start battle/ })).toBeVisible();
      await expectNoSidewaysScroll(page);
      if (OUT) await page.screenshot({ path: `${OUT}/inspect-${size.width}.png` });

      // The formation's own markers are intact under the look.
      expect(await battle(page, 'return s._formation.markers.length')).toBeGreaterThan(0);

      // Tapping the foe again clears it.
      await page.touchscreen.tap(at.x, at.y);
      await expect.poll(() => lit(page)).toMatchObject({ move: 0, attack: 0, panel: null });
      await expect(hud.locator('.mb-summary')).not.toContainText(foe.name);

      // Bare terrain clears it too.
      await page.touchscreen.tap(at.x, at.y);
      await expect.poll(() => lit(page)).toMatchObject({ panel: foe.name });
      const bare = await bareTile(page);
      expect(bare, 'a bare tile on screen').not.toBeNull();
      const bareAt = await tileCss(page, bare.col, bare.row);
      await page.touchscreen.tap(bareAt.x, bareAt.y);
      await expect.poll(() => lit(page)).toMatchObject({ move: 0, attack: 0, panel: null });

      // A unit in hand stays in hand through the look, and setting it down ends the look.
      await hud.getByRole('button', { name: 'Auto-place', exact: true }).tap();
      const first = await battle(
        page,
        `const f = s._formation; const t = f.tiles[f.formation.at[0]]; return { col: t.col, row: t.row, name: f.units[0].name };`,
      );
      const firstAt = await tileCss(page, first.col, first.row);
      await page.touchscreen.tap(firstAt.x, firstAt.y);
      await expect.poll(() => lit(page)).toMatchObject({ held: first.name });
      await page.touchscreen.tap(at.x, at.y);
      await expect.poll(() => lit(page)).toMatchObject({ panel: foe.name, held: first.name });
      expect((await lit(page)).move).toBeGreaterThan(0);
      await page.touchscreen.tap(firstAt.x, firstAt.y);
      // Tapping the held unit's own tile opens its menu; closing it keeps the unit in hand.
      await expect.poll(() => lit(page)).toMatchObject({ panel: null, move: 0 });
      await page.keyboard.press('Escape');

      // Start battle begins turn 1 with nothing of the look left on the board.
      await battle(page, 'return s._formation.release()');
      await page.touchscreen.tap(at.x, at.y);
      await expect.poll(() => lit(page)).toMatchObject({ panel: foe.name });
      await hud.getByRole('button', { name: 'Start battle', exact: true }).tap();
      await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
      expect(await lit(page)).toMatchObject({ move: 0, attack: 0, panel: null });
      expect(errors).toEqual([]);
    });
  });
}

test.describe('Formation Danger legend upright', () => {
  test.use(phone(PORTRAIT_PHONES[0]));

  test('the purple outline of a status staff is explained beside the Danger zone', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors = pageErrors(page);
    await formation(page);
    const hud = rail(page);
    await expect(hud).not.toContainText('Purple outline');
    // A Sleep staff on a visible foe, then the Danger zone.
    await battle(
      page,
      `const foe = s.enemyUnits.find((u) => u.currentHP > 0);
       foe.statusStaff = { name: 'Sleep', type: 'Staff', range: '3-5', uses: 3, statusEffect: 'sleep' };
       s.dangerZoneStale = true;`,
    );
    await hud.getByRole('button', { name: /^Danger/ }).tap();
    await expect
      .poll(() => battle(page, 'return s.dangerZone.tiles.some((t) => t.statusThreat)'))
      .toBe(true);
    await expect(hud).toContainText('Purple outline: a foe’s status staff (Sleep, Silence)');
    await expectNoSidewaysScroll(page);
    await expectTappable(hud.getByRole('button', { name: /^Start battle/ }), { min: 40 });
    if (OUT) await page.screenshot({ path: `${OUT}/danger-legend.png` });
    expect(errors).toEqual([]);
  });
});

test.describe('Ballista upright', () => {
  test.use(phone(PORTRAIT_PHONES[0]));

  // A plain tap on a ballista toggles its reach and reads its details, in Formation and on
  // a turn (before, only a long press drew the range and nothing said what it does).
  test('a tap on a ballista draws its range and reads its details, in Formation and on turn 1', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors = pageErrors(page);
    await formation(page);
    const hud = rail(page);
    const spot = await bareTile(page);
    expect(spot, 'a bare tile on screen').not.toBeNull();
    // No preset has a ballista: stand one on a bare tile (terrain and battle record).
    await battle(
      page,
      `const idx = s.gameData.terrain.findIndex((t) => t.name === 'Ballista');
       s.grid.mapLayout[a.row][a.col] = idx;
       s.ballistas.push({ col: a.col, row: a.row, owner: 'enemy', captured: false, range: 4 });`,
      spot,
    );
    const at = await tileCss(page, spot.col, spot.row);
    const reach = () => battle(page, 'return s.grid.attackHighlightTiles.length');

    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(reach).toBeGreaterThan(0);
    await expect(hud).toContainText('Enemy ballista · Range 1-4');
    await expect(hud).toContainText('Mt 10 vs RES · Hit 85 · no counter');
    await expect(hud).toContainText('Fires at your nearest unit each enemy phase.');
    await expectNoSidewaysScroll(page);
    await expect(hud.getByRole('button', { name: /^Start battle/ })).toBeVisible();
    if (OUT) await page.screenshot({ path: `${OUT}/ballista-formation.png` });

    // Tapping it again clears the range.
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(reach).toBe(0);

    // On turn 1 the same tap does the same.
    await hud.getByRole('button', { name: 'Auto-place', exact: true }).tap();
    await hud.getByRole('button', { name: 'Start battle', exact: true }).tap();
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(reach).toBeGreaterThan(0);
    await expect(hud).toContainText('Enemy ballista · Range 1-4');
    if (OUT) await page.screenshot({ path: `${OUT}/ballista-turn.png` });
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(reach).toBe(0);
    expect(errors).toEqual([]);
  });
});
