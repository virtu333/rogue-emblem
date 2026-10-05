// Skipping the prologue part-way, through ordinary play (docs/specs/prologue-chapter.md
// §9): an exit chosen on a note is honoured, never dropped. On P1's first forecast the
// note's "Skip prologue" backs out of the uncommitted forecast (no attack is made) and
// opens the confirmation; on the note before the turn passes to the enemy it waits for
// the player's next turn and opens there. Then P1 is won, and P2's pause menu skips the
// rest; another run skips from the fork's route map. Each ends with the skip's ending,
// the handoff, Home Base with the grant, and a refresh that pays nothing twice. A
// standalone replay's note offers Leave the same way.
import { test, expect } from '@playwright/test';
import { bootDesktop, driver, activeScene, slotMeta, slotRun } from './prologueDriver.js';
import {
  startPrologue,
  playP1,
  playP2,
  toRoute,
  travel,
  fightOut,
  coach,
} from './prologueJourney.js';

test.setTimeout(600_000);

/** The skip's ending (no win claimed), the handoff, Home Base, and the grant once. */
async function endingToHomeBase(d) {
  const { page } = d;
  const handoff = await d.dialog('From here, it counts');
  await expect(handoff).toContainText('The prologue ends');
  expect(d.log.some((e) => e.text.includes('PROLOGUE COMPLETE'))).toBe(false);
  await expect(page.locator('.ce-runend-word', { hasText: 'PROLOGUE COMPLETE' })).toHaveCount(0);
  expect((await slotMeta(page)).prologue.state).toBe('in_progress');
  await d.click(handoff.getByRole('button', { name: 'To Home Base', exact: true }));
  await activeScene(page, 'HomeBase');
  const meta = await slotMeta(page);
  expect(meta.prologue).toMatchObject({ state: 'complete', grantPaid: true });
  expect([meta.totalValor, meta.totalSupply, meta.runsStarted]).toEqual([60, 40, 0]);
  expect(await slotRun(page)).toBeNull();
  await page.reload();
  await activeScene(page, 'Title');
  const again = await slotMeta(page);
  expect([again.totalValor, again.totalSupply, again.prologue.grantPaid]).toEqual([60, 40, true]);
  // Home Base again from the title: still the one grant.
  await d.click(page.getByRole('button', { name: /^Save Slots/ }));
  await activeScene(page, 'SlotPicker');
  await d.click(page.getByRole('button', { name: 'Select Slot 1', exact: true }));
  await activeScene(page, 'HomeBase');
  expect([(await slotMeta(page)).totalValor, (await slotMeta(page)).totalSupply]).toEqual([60, 40]); // prettier-ignore
}

const paused = (page) => page.getByRole('dialog', { name: 'Paused', exact: true });

test('P1: Skip on the forecast note backs out with nothing committed; Skip on the turn note opens at the next turn; P2 skips from the pause menu', async ({
  browser,
}) => {
  const { context, page, errors } = await bootDesktop(browser);
  const d = driver(page);
  await startPrologue(d);
  await d.select('Edric');
  await d.moveSelected(3, 2);
  await d.menu('Attack');
  await d.drain(() => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'SELECTING_TARGET'); // prettier-ignore
  const a = await d.enemy('a');
  const edric = await d.unit('Edric');
  await d.tile(a.col, a.row);
  const forecastNote = page
    .getByRole('dialog', { name: 'Field notes', exact: true })
    .filter({ hasText: 'Reading a forecast' });
  await d.click(forecastNote.getByRole('button', { name: 'Skip prologue', exact: true }));
  // The confirmation opens on the player's own turn; nothing was committed.
  await expect(paused(page)).toContainText('Skip the rest of the prologue?');
  const nudge = coach(page).locator('.re-coach-nudge');
  expect((await nudge.isVisible()) && (await nudge.textContent()).includes('once your turn is back')).toBe(false); // prettier-ignore
  expect(await d.enemy('a')).toMatchObject({ hp: a.hp });
  expect(await d.unit('Edric')).toMatchObject({ hp: edric.hp, acted: false, col: 3, row: 2 });
  expect(await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').forecastTarget)).toBeNull(); // prettier-ignore
  // Cancel the exit: the turn is the player's, at the action menu, and the attack can be made.
  await d.click(paused(page).getByRole('button', { name: 'Cancel', exact: true }));
  await d.click(paused(page).getByRole('button', { name: 'Resume', exact: true }));
  await expect(paused(page)).toHaveCount(0);
  expect((await d.battleState()).state).toBe('UNIT_ACTION_MENU');
  await d.menu('Attack');
  await d.drain(() => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'SELECTING_TARGET'); // prettier-ignore
  await d.tile(a.col, a.row);
  await d.forecastOpen();
  await d.confirmForecast();
  // The turn note comes as Edric's action ends: Skip there waits out the enemy phase.
  const turnNote = page
    .getByRole('dialog', { name: 'Field notes', exact: true })
    .filter({ hasText: "Wait ends Edric's move." });
  await d.drain(() => false, null, {
    stopAt: (top) => top.name === 'Field notes' && top.text.includes("Wait ends Edric's move."),
  });
  await d.click(turnNote.getByRole('button', { name: 'Skip prologue', exact: true }));
  await page.waitForFunction(() => window.__emblemRogueGame.scene.getScene('Battle').turnManager.currentPhase === 'enemy'); // prettier-ignore
  expect(await paused(page).count()).toBe(0);
  // The next player turn: the confirmation opens there, once.
  await expect(paused(page)).toContainText('Skip the rest of the prologue?', { timeout: 60_000 });
  expect(await d.battleState()).toMatchObject({ phase: 'player', turn: 2 });
  await d.click(paused(page).getByRole('button', { name: 'Cancel', exact: true }));
  await d.click(paused(page).getByRole('button', { name: 'Resume', exact: true }));
  await expect(paused(page)).toHaveCount(0);
  // P1 played to its end.
  await fightOut(d, ['Edric']);
  await toRoute(d);
  // P2: Esc, Skip Prologue, confirm.
  await travel(d, 'prologue_1');
  await activeScene(page, 'Battle');
  await d.idle();
  await page.keyboard.press('Escape');
  await d.click(paused(page).getByRole('button', { name: 'Skip Prologue', exact: true }));
  await d.click(paused(page).getByRole('button', { name: 'Skip prologue', exact: true }));
  await endingToHomeBase(d);
  expect(errors).toEqual([]);
  await context.close();
});

test('the fork: the route map pause skips the rest of the prologue', async ({ browser }) => {
  const { context, page, errors } = await bootDesktop(browser);
  const d = driver(page);
  await startPrologue(d);
  await playP1(d);
  await toRoute(d);
  await playP2(d);
  await toRoute(d);
  await expect(page.locator('.re-node[data-node="prologue_2a"]')).toHaveClass(/is-live/);
  await d.click(page.locator('.re-node-map').getByRole('button', { name: 'Menu', exact: true }));
  await d.click(paused(page).getByRole('button', { name: 'Skip Prologue', exact: true }));
  await d.click(paused(page).getByRole('button', { name: 'Skip prologue', exact: true }));
  await endingToHomeBase(d);
  expect(errors).toEqual([]);
  await context.close();
});

test('a replay: Leave on the first forecast note opens the confirmation, no attack made', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, reduceMotion: true, battleSpeed: 'instant' }),
    );
    // A slot that already started a run: the Prologue item is a chapter select.
    localStorage.setItem(
      'emblem_rogue_slot_1_meta',
      JSON.stringify({ totalValor: 12, totalSupply: 3, runsStarted: 1, savedAt: 1 }),
    );
  });
  await page.goto('/');
  await activeScene(page, 'Title');
  const d = driver(page);
  await d.click(page.getByRole('button', { name: /^Prologue/ }));
  await d.click(page.getByRole('button', { name: 'Banner at Dawn', exact: true }));
  await activeScene(page, 'Battle');
  await d.idle();
  await d.select('Edric');
  await d.moveSelected(3, 2);
  await d.menu('Attack');
  await d.drain(() => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'SELECTING_TARGET'); // prettier-ignore
  const a = await d.enemy('a');
  await d.tile(a.col, a.row);
  const note = page
    .getByRole('dialog', { name: 'Field notes', exact: true })
    .filter({ hasText: 'Reading a forecast' });
  await d.click(note.getByRole('button', { name: 'Leave prologue', exact: true }));
  await expect(paused(page)).toContainText('Leave the prologue?');
  expect(await d.enemy('a')).toMatchObject({ hp: a.hp });
  expect(await d.unit('Edric')).toMatchObject({ acted: false });
  await d.click(paused(page).getByRole('button', { name: 'Leave prologue', exact: true }));
  await activeScene(page, 'Title');
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /_slot_1_run$/.test(k)))).toEqual([]); // prettier-ignore
  expect(errors).toEqual([]);
  await context.close();
});
