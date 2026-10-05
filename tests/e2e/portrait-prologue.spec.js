// The prologue upright on a phone, through ordinary taps only (docs/specs/prologue-
// chapter.md §9; docs/portrait-battles.md): the title's Prologue item, P1's guided steps
// on the turned board (a tap on Edric, a tap on the Fort), the forecast's note and its
// Confirm on the phone's forecast, the fight on the rail, Gaspar's lines, the route map,
// P2 played the lesson's way, the reward card, then the fork's Market and the roster
// lesson's Withdraw and Equip on the phone's roster sheet. Portrait mode is on by the
// device default; every step stays upright with nothing scrolling sideways.
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  phone,
  expectPortraitUi,
  expectNoSidewaysScroll,
  expectTappable,
} from './portraitHelpers.js';
import { QUIET, driver, activeScene, slotMeta, slotRun } from './prologueDriver.js';
import { playP1, playP2, toRoute, forkStop, coach } from './prologueJourney.js';

test.use(phone(PORTRAIT_PHONES[1]));
test.setTimeout(600_000);

test('upright: P1 by taps, P2, and the fork with its roster lesson', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (s) => localStorage.setItem('emblem_rogue_settings', JSON.stringify(s)),
    QUIET,
  );
  await page.goto('/');
  await activeScene(page, 'Title');
  await expectPortraitUi(page);
  const d = driver(page, { touch: true });
  const prologue = page.getByRole('button', { name: /^Prologue/ });
  await expectTappable(prologue);
  await prologue.tap();
  await activeScene(page, 'Battle');
  await d.idle();
  // The board is turned upright, the coach and its Skip within reach.
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').grid.board?.rotation), // prettier-ignore
  ).not.toBe(0);
  await expectTappable(
    coach(page).getByRole('button', { name: 'Skip the rest of the prologue', exact: true }),
  );
  await expectNoSidewaysScroll(page);

  await playP1(d, { wrongWay: true, cancels: 1 });
  await toRoute(d);
  await expectPortraitUi(page);
  await expectNoSidewaysScroll(page);
  expect(d.notes().filter((n) => n.includes('Reading a forecast'))).toHaveLength(1);
  expect((await slotMeta(page)).prologue.chaptersCompleted).toEqual(['p1_banner_at_dawn']);

  await playP2(d);
  await toRoute(d);
  expect((await slotMeta(page)).prologue.chaptersCompleted).toHaveLength(2);

  await forkStop(d, 'market', { lesson: 'core' });
  await expectNoSidewaysScroll(page);
  const run = await slotRun(page);
  expect(run.roster.find((u) => u.name === 'Tamsin').weapon?.name).toBe('Iron Bow');
  expect(run.prologueRosterLesson).toMatchObject({ more: 'declined' });
  // Armed: the road on to P3 asks nothing.
  await expect(page.locator('.re-node[data-node="prologue_3"]')).toHaveClass(/is-live/);
  expect(errors).toEqual([]);
});
