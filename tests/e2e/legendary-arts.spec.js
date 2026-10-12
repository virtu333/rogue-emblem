// E2E: the reworked legendary arts (docs/specs/legendary-arts-rework.md), played by touch on
// a phone through the real menus and board: Doomblade's leap (§5), Oathblade's dash (§4),
// Ruin's cone (§1), Hermit's Bow's fan (§2) and Starfall's falling-star volley (§3).
//
// The combat_actions lab (10×8; Water down column 8 in rows 0-4): Utility is the art's user;
// the units it acts on are placed for each test, every other unit moved out of the way.
// Expected damage is worked from the stats the test sets, by the area rules: an area blow
// always lands, never crits, reads its victim's own DEF and the weapon triangle, and is the
// art's strike × its share.
import { test, expect, devices } from '@playwright/test';
import { attachSceneCrashArtifacts, waitForScene } from './helpers.js';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone SE'];
test.use({ ...phone, viewport: { width: 667, height: 375 } });
const url = '/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1';

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

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

/**
 * Lay out the board: Utility takes `weapon` (Master rank in its type) and `stats`, everyone
 * listed in `place` goes to its tile, and every other unit is parked along row 7 (out of
 * reach of every shape here), its foes at 1 HP so none can stop a test by acting.
 */
async function setup(page, { weapon, stats, place, foeStats = {} }) {
  await page.evaluate(
    ({ weapon, stats, place, foeStats }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const all = [...s.playerUnits, ...s.enemyUnits];
      const u = s.playerUnits.find((x) => x.name === 'Utility');
      const item = structuredClone(s.gameData.weapons.find((w) => w.name === weapon));
      u.proficiencies = [{ type: item.type, rank: 'Mast' }];
      u.inventory = [item];
      u.weapon = item;
      Object.assign(u.stats, { HP: 60, SKL: 30, SPD: 20, LCK: 0, DEF: 20, RES: 20 }, stats);
      u.currentHP = 50;
      let park = 0;
      for (const x of all) {
        const spot = place[x.name] || place[x.className];
        if (spot) [x.col, x.row] = spot;
        else if (x !== u) [x.col, x.row] = [park++, 7];
        if (x.faction === 'enemy') {
          Object.assign(x.stats, { HP: 90, SPD: 0, LCK: 0, DEF: 5 }, foeStats[x.className] || {});
          x.currentHP = 90;
        }
        s.updateUnitPosition(x);
      }
    },
    { weapon, stats, place, foeStats },
  );
}

async function tapTile(page, col, row) {
  const p = await page.evaluate(
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
  await page.touchscreen.tap(p.x, p.y);
}

const board = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const out = {};
    for (const x of [...s.playerUnits, ...s.enemyUnits])
      out[x.faction === 'enemy' ? x.className : x.name] = {
        hp: x.currentHP,
        col: x.col,
        row: x.row,
        acted: x.hasActed,
        str: x.stats.STR,
        def: x.stats.DEF,
      };
    return { state: s.battleState, units: out };
  });

async function settled(page) {
  await expect.poll(async () => (await board(page)).state, { timeout: 20_000 }).toBe('PLAYER_IDLE');
}

async function openArt(page, hud, name) {
  const at = await board(page);
  await tapTile(page, at.units.Utility.col, at.units.Utility.row);
  await hud.getByRole('button', { name: /^Weapon Art/ }).tap();
  await hud.getByRole('button', { name: new RegExp(name) }).tap();
}

test('Doomblade: Doom Thrust leaps over a foe and strikes both foes beside the landing', async ({
  page,
}) => {
  const { hud, errors } = await boot(page);
  // Utility (4,4); the Knight (5,4) stands between it and the landing (6,4); the Fighter is
  // beside the landing at (6,3). Doomblade 12 + STR 20 + the art's 6 = 38 a strike: on the
  // Knight's DEF 5 (lance on lance) 33 × 0.8 = 26; on the Fighter's DEF 5 (lance against an
  // axe: −1 at Master rank) 32 × 0.8 = 25.
  await setup(page, {
    weapon: 'Doomblade',
    stats: { STR: 20 },
    place: { Utility: [4, 4], Knight: [5, 4], Fighter: [6, 3] },
  });
  await openArt(page, hud, 'Doom Thrust');
  await expect.poll(async () => (await board(page)).state).toBe('SELECTING_AREA_CENTER');
  // An occupied tile is no landing.
  await tapTile(page, 5, 4);
  await expect(hud.getByRole('button', { name: /^Leap: Doom Thrust/ })).toHaveCount(0);
  await tapTile(page, 6, 4);
  await page.screenshot({ path: 'test-results/legendary-leap-prompt.png' });
  await hud.getByRole('button', { name: /^Leap: Doom Thrust/ }).tap();
  await settled(page);
  const { units } = await board(page);
  expect(units.Utility).toMatchObject({ col: 6, row: 4, hp: 50 - 8, acted: true });
  expect(units.Knight.hp).toBe(90 - 26);
  expect(units.Fighter.hp).toBe(90 - 25);
  expect(errors).toEqual([]);
});

test('Oathblade: Phantom Rush strikes, cuts the line and dashes past it, stopping short of water', async ({
  page,
}) => {
  const { hud, errors } = await boot(page);
  // Utility (4,4) attacks the Fighter (5,4) east; the Knight on (6,4) is on the line. The run
  // could land on (8,4), but that is Water: it lands on (7,4). The line's blow: Oathblade 15 +
  // STR 20 + the art's 4 = 39; on the Knight's DEF 5 (sword on lance: −1 at Master) 33 ×
  // 0.75 = 24.
  await setup(page, {
    weapon: 'Oathblade',
    stats: { STR: 20 },
    place: { Utility: [4, 4], Fighter: [5, 4], Knight: [6, 4] },
  });
  await openArt(page, hud, 'Phantom Rush');
  await tapTile(page, 5, 4);
  await expect(page.getByRole('button', { name: 'Confirm attack', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/legendary-dash-forecast.png' });
  await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
  await settled(page);
  const { units } = await board(page);
  expect(units.Utility).toMatchObject({ col: 7, row: 4, acted: true });
  expect(units.Knight.hp).toBe(90 - 24);
  expect(units.Fighter.hp).toBeLessThan(90);
  expect(errors).toEqual([]);
});

test("Ruin: Cataclysm's cone hits 75% then 50% behind the target, nothing beside it", async ({
  page,
}) => {
  const { hud, errors } = await boot(page);
  // Utility (2,4) attacks the Knight (3,4) east. Row 1 behind it is column 4 (rows 3-5), row 2
  // column 5. The Fighter on (4,5) is in row 1; the Archer on (5,3) in row 2; Edric (an ally)
  // on (4,3) is never hit. Ruin 14 + STR 20 + the art's 5 = 39: on the Fighter's DEF 5 (axe
  // on axe) 34 × 0.75 = 25; on the Archer's DEF 5 (axe on bow) 34 × 0.5 = 17.
  await setup(page, {
    weapon: 'Ruin',
    stats: { STR: 20 },
    place: { Utility: [2, 4], Knight: [3, 4], Fighter: [4, 5], Archer: [5, 3], Edric: [4, 3] },
  });
  const before = await board(page);
  await openArt(page, hud, 'Cataclysm');
  await tapTile(page, 3, 4);
  await expect(page.getByRole('button', { name: 'Confirm attack', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/legendary-cone-forecast.png' });
  await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
  await settled(page);
  const { units } = await board(page);
  expect(units.Fighter.hp).toBe(90 - 25);
  expect(units.Archer.hp).toBe(90 - 17);
  expect(units.Edric.hp).toBe(before.units.Edric.hp);
  expect(units.Utility.acted).toBe(true);
  expect(errors).toEqual([]);
});

test("Hermit's Bow: Fan Shot fans out to the two tiles beside the target on its ring", async ({
  page,
}) => {
  const { hud, errors } = await boot(page);
  // Utility (4,2), alone (no ally beside it: the bow's +4 STR holds). The Knight is 2 south
  // (4,4); the ring's neighbours are (3,3) and (5,3): the Fighter and the Archer stand there.
  // Hermit's Bow 11 + STR 15 + 4 = 30; on DEF 5: 25 × 0.7 = 17 (bows sit outside the triangle).
  await setup(page, {
    weapon: "Hermit's Bow",
    stats: { STR: 15 },
    place: { Utility: [4, 2], Knight: [4, 4], Fighter: [3, 3], Archer: [5, 3] },
  });
  await openArt(page, hud, 'Fan Shot');
  await tapTile(page, 4, 4);
  await expect(page.getByRole('button', { name: 'Confirm attack', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/legendary-fan-forecast.png' });
  await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
  await settled(page);
  const { units } = await board(page);
  expect(units.Fighter.hp).toBe(90 - 17);
  expect(units.Archer.hp).toBe(90 - 17);
  expect(errors).toEqual([]);
});

test('Starfall: Starfall Volley comes down on a tile 3-7 away, sure to hit, no counter', async ({
  page,
}) => {
  const { hud, errors } = await boot(page);
  // Utility (0,4) aims (5,4), 5 away: the Fighter there and the Knight beside it on (5,5)
  // are struck, the Archer on (5,6) (2 from the center) is not. Starfall 12 + STR 20 + the
  // art's 3 = 35; on DEF 5: 30 × 0.6 = 18.
  await setup(page, {
    weapon: 'Starfall',
    stats: { STR: 20 },
    place: { Utility: [0, 4], Fighter: [5, 4], Knight: [5, 5], Archer: [5, 6] },
  });
  await openArt(page, hud, 'Starfall Volley');
  await expect.poll(async () => (await board(page)).state).toBe('SELECTING_AREA_CENTER');
  await tapTile(page, 5, 4);
  await hud.getByRole('button', { name: /^Fire Starfall Volley/ }).tap();
  await settled(page);
  const { units } = await board(page);
  expect(units.Fighter.hp).toBe(90 - 18);
  expect(units.Knight.hp).toBe(90 - 18);
  expect(units.Archer.hp).toBe(90);
  expect(units.Utility).toMatchObject({ hp: 50 - 7, acted: true });
  expect(errors).toEqual([]);
});
