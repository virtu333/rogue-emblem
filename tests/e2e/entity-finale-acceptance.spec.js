// Acceptance, scenario 5 (screen): the Entity's finale on the Descent's last node, with the
// counter-reach display (#321) and the rally cards (#319) together in ONE battle, on a phone in
// the real shell. The Descent ships dark; the review route switches it on for the page
// (`&descent=1&difficulty=hard&devNode=boss`: the Nightfall route's finale, the Entity).
// Ways this breaks:
//   - the Danger display shows no counter band, or a band tile the Entity could strike, or one
//     outside 3..4 of its body
//   - the Entity's card does not say both reaches
//   - a real first wound does not raise the rally, or the rally's card hides the board's centre
//   - Cancel goes to the card while a unit is selected (it must back the unit out first), or the
//     card's Skip leaves a line to come back later
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  attackInPlace,
  battleIdle,
  battleRail,
  openDevBattle,
  pageErrors,
  phone,
  quietSettings,
  tapTile,
} from './portraitHelpers.js';

test.setTimeout(150_000);

const shot = (page, name) =>
  page.screenshot({
    path: process.env.ACCEPTANCE_SHOTS
      ? `${process.env.ACCEPTANCE_SHOTS}/${name}.png`
      : test.info().outputPath(`${name}.png`),
  });

const ENTITY_ROUTE = '&descent=1&difficulty=hard&devNode=boss';
const card = (page) => page.locator('.rc-card:not([hidden])');

test.describe('the Entity finale on an upright phone', () => {
  // eslint-disable-next-line no-unused-vars
  const { defaultBrowserType, ...context } = phone(PORTRAIT_PHONES[1]);
  test.use(context);

  test('counter reach shown, a real wound raises the rally, Cancel backs out first, Skip ends it', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    await quietSettings(page, { guidance: 'off' });
    await openDevBattle(page, { slot: null, query: ENTITY_ROUTE });
    // The Descent's finale: the Entity on its sanctum.
    const field = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const e = b.enemyUnits.find((u) => u.isEntity);
      return {
        template: b.battleConfig.templateId,
        role: b.battleParams.bossRole,
        entity: e ? { id: e.battleEntityId, col: e.col, row: e.row } : null,
      };
    });
    expect(field.entity).not.toBeNull();
    expect(field.template).toBe('eldritch_sanctum');
    expect(field.role).toBe('finale');
    // The finale opens on its story lines (the commander and Sera before the Entity): skipped.
    const story = page.getByRole('dialog', { name: 'Story' });
    await expect(story).toBeVisible({ timeout: 20_000 });
    await story.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
    await expect(story).toBeHidden();
    await battleIdle(page);

    // The Danger display: the Entity's strike zone and its counter-only band, 3..4 from its body.
    // Its escort's own reach covers the band on this opening board (a tile another foe strikes
    // is a strike tile), so the escort leaves the field first: the Entity alone, as late in the
    // fight, when a bow at range 3 is the question the band answers.
    await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      for (const u of b.enemyUnits.filter((e) => !e.isEntity)) b.removeUnitGraphic(u);
      b.enemyUnits.splice(0, b.enemyUnits.length, ...b.enemyUnits.filter((e) => e.isEntity));
      b.dangerZoneStale = true;
    });
    const rail = battleRail(page);
    await rail.getByRole('button', { name: 'Danger', exact: true }).tap();
    const band = () =>
      page.evaluate(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        const e = b.enemyUnits.find((u) => u.isEntity);
        const dist = (c, r) => {
          const dx = Math.max(e.col - c, 0, c - (e.col + 2));
          const dy = Math.max(e.row - r, 0, r - (e.row + 2));
          return dx + dy;
        };
        const tiles = b.dangerZone?.visible ? b.dangerZone.tiles : [];
        return {
          visible: Boolean(b.dangerZone?.visible),
          counter: tiles.filter((t) => t.counterThreat).map((t) => dist(t.col, t.row)),
          strikeAtThreeOrMore: tiles.filter((t) => t.tier > 0 && !t.counterThreat).length,
        };
      });
    await expect.poll(async () => (await band()).counter.length).toBeGreaterThan(0);
    const drawn = await band();
    expect(drawn.visible).toBe(true);
    for (const d of drawn.counter) {
      expect(d).toBeGreaterThanOrEqual(3);
      expect(d).toBeLessThanOrEqual(4);
    }
    await shot(page, 'entity-counter-band-390x844');
    await rail.getByRole('button', { name: 'Danger', exact: true }).tap();

    // The Entity's card says both reaches.
    await tapTile(page, field.entity.col + 1, field.entity.row + 1);
    await expect(page.getByText('Strikes within 2 · Counters within 4').first()).toBeVisible();
    await shot(page, 'entity-reach-card-390x844');
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await battleIdle(page);

    // A real first wound: Edric (made to survive the answer) strikes from beside the body.
    await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const e = b.enemyUnits.find((u) => u.isEntity);
      const edric = b.playerUnits.find((u) => u.name === 'Edric');
      Object.assign(edric.stats, { HP: 99, STR: 50, DEF: 60, RES: 60, SKL: 80, SPD: 40, LCK: 40 });
      edric.currentHP = 99;
      const taken = (c, r) => Boolean(b.getUnitAt?.(c, r));
      const beside = [];
      // The tiles touching the 3x3 body's sides.
      for (let c = e.col; c <= e.col + 2; c++)
        beside.push({ col: c, row: e.row - 1 }, { col: c, row: e.row + 3 });
      for (let r = e.row; r <= e.row + 2; r++)
        beside.push({ col: e.col - 1, row: r }, { col: e.col + 3, row: r });
      const spot = beside.find(
        ({ col, row }) =>
          col >= 0 &&
          row >= 0 &&
          col < b.grid.cols &&
          row < b.grid.rows &&
          !taken(col, row) &&
          (b.grid.getTerrainAt(col, row)?.moveCost?.Infantry ?? 99) < 99,
      );
      b.removeUnitGraphic(edric);
      Object.assign(edric, spot);
      b.addUnitGraphic(edric);
    });
    const entityHp = () =>
      page.evaluate(
        () =>
          window.__emblemRogueGame.scene.getScene('Battle').enemyUnits.find((u) => u.isEntity)
            .currentHP,
      );
    const before = await entityHp();
    await attackInPlace(page, 'Edric', field.entity.id);
    expect(await entityHp()).toBeLessThan(before);

    // The finale answers: the rally's first card, clear of the board's centre.
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    const fit = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const r = document.querySelector('.rc-card').getBoundingClientRect();
      const mid = b._guidance.battlefieldRect();
      const x = mid.left + mid.width / 2;
      const y = mid.top + mid.height / 2;
      return {
        inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        coversCentre: x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
      };
    });
    expect(fit).toEqual({ inViewport: true, coversCentre: false });

    // Cancel priority: a selected unit takes Back first; the rally is not skipped by it.
    const rallyState = () =>
      page.evaluate(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        const rally = b._battleBeats?._rally;
        return {
          skipped: rally?.skipped === true,
          timers: rally?._timers?.length ?? 0,
          state: b.battleState,
          selected: b.selectedUnit?.name || null,
        };
      });
    const mover = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const u = b.playerUnits.find((p) => !p.hasActed && p.currentHP > 0);
      return { name: u.name, col: u.col, row: u.row };
    });
    expect((await rallyState()).timers, 'lines still to come').toBeGreaterThan(0);
    await tapTile(page, mover.col, mover.row);
    await expect.poll(async () => (await rallyState()).selected).toBe(mover.name);
    // (A rally of three lines lasts about ten seconds: the steps below are kept quick.)
    await shot(page, 'entity-rally-card-390x844');
    // One Back with the unit selected: it goes to the unit (its menu or range closes), never to
    // the card, which is still up and not skipped.
    const selectedState = (await rallyState()).state;
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await expect.poll(async () => (await rallyState()).state).not.toBe(selectedState);
    expect(await rallyState()).toMatchObject({ skipped: false });
    await expect(card(page)).toBeVisible();

    // Skip (the card's button) ends the rally: no card, no beat to come back.
    await card(page).locator('.rc-skip').tap();
    await expect(page.locator('.rc-card')).toHaveCount(0);
    const left = await rallyState();
    expect({ skipped: left.skipped, timers: left.timers }).toEqual({ skipped: true, timers: 0 });
    // And the unit still backs out to idle as ever.
    for (let i = 0; i < 4 && (await rallyState()).state !== 'PLAYER_IDLE'; i++)
      await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await battleIdle(page);
    expect(errors).toEqual([]);
  });
});
