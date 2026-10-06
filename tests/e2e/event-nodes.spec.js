// A story Event on the route map, played through the real UI (docs/specs/event-nodes.md §10):
// walk to the Event node, enter it, read its choices (never their outcomes), choose, read what
// came of it, refresh, and Continue. The review route `?devScene=nodemap&preset=event&seed=42
// &event=<id>` (src/utils/devStartup.js applyEventPreset) puts the party one click from an
// event, with the catalog narrowed to the named one.
//
// Ways this can fail, a test each:
//   1. the node cannot be entered from the route (label, Travel), or opens something else;
//   2. the page shows a result before the choice, or loses its choices/reasons at a phone size;
//   3. a choice is not confirmed before it commits, or does not save at once;
//   4. a refresh at the outcome re-rolls, re-applies, or reopens the choices;
//   5. Continue does not complete the node, does not save, or ESC before choosing completes it;
//   6. a choice that starts a fight offers Continue, or Fight does not enter a battle;
//   7. a burden on the run has no chip on the route and no line in the pause menu;
//   8. any of it overflows the page, or is clipped, at 640x480 and a landscape phone;
//   9. a won fight whose spoils cannot be taken forfeits them, traps the player in the page, or
//      cannot be retried or given up (behind a confirmation).
import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, collectErrors } from './helpers.js';

const SIZES = [
  { name: 'desktop 640x480', viewport: { width: 640, height: 480 }, mobile: false },
  { name: 'phone 844x390', viewport: { width: 844, height: 390 }, mobile: true },
];

async function boot(page, eventId, mobile) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      // Teaching on: the review route's session hints teach only the first event's note.
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: true }),
    ),
  );
  await page.goto(
    `/?devScene=nodemap&preset=event&seed=42&event=${eventId}${mobile ? '&mobilePreview=1' : ''}`,
  );
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible' });
  await skip.click();
  await expect(page.locator('.re-node-map')).toBeVisible();
  // A durable slot, so the saves below are real ones.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.persistRunSave();
  });
}

/** Select the reachable Event on the route and press Travel (the player's own path). */
async function enterFromRoute(page, label = 'Travel') {
  await page
    .getByRole('button', { name: /^Event · (Available|You are here)/ })
    .first()
    .click();
  await page.getByRole('button', { name: label, exact: true }).click();
}

/** The event's record on the run, live and as saved in slot 1. */
const record = (page) =>
  page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const pick = (run) => {
      const node = run.nodeMap.nodes.find(
        (n) => n.type === 'event' && run.eventStateByNodeId[n.id],
      );
      const state = node ? run.eventStateByNodeId[node.id] : null;
      return {
        arrived: Boolean(state),
        eventId: state?.eventId ?? null,
        choiceId: state?.choiceId ?? null,
        battle: state?.battle ?? null,
        completed: node?.completed ?? null,
        left: state?.left ?? false,
        gold: run.gold,
        hp: run.roster[0].currentHP,
        log: run.eventLog.length,
      };
    };
    return { live: pick(s.runManager), saved: pick(loadRun(s.gameData, 1)) };
  });

/**
 * The armory's door chosen and its fight won (the battle's own commit, saved), then the scene
 * rebuilt from the slot, as a refresh does, with the run's next gold payment planted to fail
 * once: the route map opens the spoils and they cannot be taken.
 */
async function returnWithSpoilsFailing(page) {
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const run = s.runManager;
    const node = run.nodeMap.nodes.find((n) => n.type === 'event' && run.eventStateByNodeId[n.id]);
    run.completeBattle(run.getRoster(), node.id, 100, { turnCount: 5, turnPar: 5 });
    s.persistRunSave();
    const loaded = loadRun(s.gameData, 1);
    loaded.addGold = function () {
      delete this.addGold; // one failure, then the run behaves
      throw new Error('planted fault');
    };
    s.scene.start('NodeMap', { gameData: s.gameData, runManager: loaded });
  });
}

/** Whether the spoils are owed, live and as saved, and the gold the run holds. */
const spoils = (page) =>
  page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const { eventSpoilsOwed } = await import('/src/engine/EventCommands.js');
    const read = (run) => {
      const node = run.nodeMap.nodes.find(
        (n) => n.type === 'event' && run.eventStateByNodeId[n.id],
      );
      const state = run.eventStateByNodeId[node.id];
      return {
        owed: eventSpoilsOwed(run, node.id),
        forfeited: state.spoilsForfeited === true,
        left: state.left === true,
        gold: run.gold,
      };
    };
    return { live: read(s.runManager), saved: read(loadRun(s.gameData, 1)) };
  });

async function chooseDoorAndLeave(page) {
  await enterFromRoute(page);
  const dialog = page.getByRole('dialog', { name: 'The Abandoned Armory', exact: true });
  await dialog.getByRole('button', { name: /^Force the barred door/ }).click();
  await page
    .getByRole('dialog', { name: 'Force the barred door', exact: true })
    .getByRole('button', { name: 'Choose', exact: true })
    .click();
  await expect(dialog.locator('.ev-outcome')).toHaveText('Someone was still home.');
  await page.keyboard.press('Escape'); // the fight is owed; it is fought and won below
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return dialog;
}

/** Nothing scrolls sideways and no text is cut off inside the page. */
async function expectFits(page, selector) {
  const fit = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      sideways: el.scrollWidth - el.clientWidth,
      page: document.documentElement.scrollWidth - innerWidth,
      right: el.getBoundingClientRect().right - innerWidth,
    };
  }, selector);
  expect(fit.sideways).toBeLessThanOrEqual(1);
  expect(fit.page).toBeLessThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test.describe(`event node ${size.name}`, () => {
    test.use({ viewport: size.viewport, hasTouch: size.mobile, isMobile: size.mobile });

    test('enter, read, choose, read the outcome, refresh, Continue', async ({ page }, info) => {
      test.setTimeout(120_000);
      const errors = collectErrors(page);
      await boot(page, 'drill_yard', size.mobile);
      // Someone is hurt, so the barracks has something to do.
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        s.runManager.roster[0].currentHP = 5;
      });
      await enterFromRoute(page);
      const dialog = page.getByRole('dialog', { name: 'The Drill Yard', exact: true });
      await expect(dialog).toBeVisible();
      // The page: kicker, title, intro, every choice; the first event's note; no result yet.
      await expect(dialog.locator('.ev-kicker')).toHaveText('EVENT');
      await expect(dialog.locator('.ev-title')).toHaveText('The Drill Yard');
      await expect(dialog.locator('.ev-intro')).toContainText('TWO HOURS. NO EXCUSES.');
      await expect(dialog.locator('.ev-status')).toContainText('An event: choose how to meet it');
      await expect(dialog.getByRole('button', { name: /^Drill until dark/ })).toBeEnabled();
      await expect(dialog.getByRole('button', { name: /^Rest in the barracks/ })).toBeEnabled();
      await expect(dialog).not.toContainText('Real beds');
      await expect(dialog).not.toContainText('sore and nobody is slower');
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('event-choosing.png') });
      // The event is recorded and saved the moment it was entered.
      expect(await record(page)).toMatchObject({
        live: { arrived: true, choiceId: null, completed: false },
        saved: { arrived: true, eventId: 'drill_yard', choiceId: null },
      });

      // A choice asks to be confirmed first; backing out changes nothing.
      await dialog.getByRole('button', { name: /^Rest in the barracks/ }).click();
      const confirm = page.getByRole('dialog', { name: 'Rest in the barracks', exact: true });
      await expect(confirm).toContainText('This cannot be undone.');
      await confirm.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(confirm).toHaveCount(0);
      expect(await record(page)).toMatchObject({
        live: { choiceId: null },
        saved: { choiceId: null },
      });

      // Choose it for real.
      await dialog.getByRole('button', { name: /^Rest in the barracks/ }).click();
      await confirm.getByRole('button', { name: 'Choose', exact: true }).click();
      await expect(dialog.locator('.ev-outcome')).toHaveText('Real beds. Lumpy, but real.');
      await expect(dialog.locator('.ev-chosen')).toContainText('You chose: Rest in the barracks');
      await expect(dialog.locator('.ev-result[data-kind="hp"]')).toContainText(
        /The army recovers \d+ HP/,
      );
      await expect(dialog.getByRole('button', { name: 'Drill until dark' })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(2); // header + the page's own
      const chosen = await record(page);
      expect(chosen.saved).toMatchObject({ choiceId: 'rest', completed: false, log: 1 });
      expect(chosen.live.hp).toBeGreaterThan(5);
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('event-outcome.png') });

      // A refresh here (the scene rebuilt from the slot) reopens the outcome, never the choices.
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const { loadRun } = await import('/src/engine/RunManager.js');
        s.scene.start('NodeMap', { gameData: s.gameData, runManager: loadRun(s.gameData, 1) });
      });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.re-node-map')).toBeVisible();
      await enterFromRoute(page, 'Return to the event');
      await expect(dialog.locator('.ev-outcome')).toHaveText('Real beds. Lumpy, but real.');
      await expect(dialog.getByRole('button', { name: 'Drill until dark' })).toHaveCount(0);
      const after = await record(page);
      expect(after.live).toMatchObject({ gold: chosen.live.gold, hp: chosen.live.hp, log: 1 });

      // Continue: the node is complete, saved, and the route moves on.
      await dialog.locator('.ev-primary').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await record(page)).toMatchObject({
        live: { completed: true, left: true },
        saved: { completed: true, left: true },
      });
      await page
        .getByRole('button', { name: /^Event · (Completed|You are here)/ })
        .first()
        .click();
      await expect(page.locator('.re-loom-card')).toContainText('You chose: Rest in the barracks');
      expect(errors).toEqual([]);
    });

    test('ESC before choosing returns to the route with the event still current', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await boot(page, 'old_swordmaster', size.mobile);
      await enterFromRoute(page);
      const dialog = page.getByRole('dialog', { name: 'The Old Swordmaster', exact: true });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const left = await record(page);
      expect(left.live).toMatchObject({ arrived: true, choiceId: null, completed: false });
      // Re-entry reopens the same page; the route names the way back.
      await enterFromRoute(page, 'Return to the event');
      await expect(dialog.locator('.ev-intro')).toContainText('splitting firewood');
      // A choice that needs someone asks who, with the unit's reason when it cannot be them.
      await dialog.getByRole('button', { name: /^Ask her to teach/ }).click();
      const picker = page.getByRole('dialog', { name: 'Who trains with her?', exact: true });
      await expect(picker).toBeVisible();
      await expect(picker.getByRole('button', { name: /Edric/ })).toBeVisible();
      await page.keyboard.press('Escape'); // the picker's own ESC: back to the choices
      await expect(picker).toHaveCount(0);
      await expect(dialog).toBeVisible();
      expect((await record(page)).live.choiceId).toBeNull();
    });

    test('a choice that starts a fight offers only Fight, and Fight enters a battle', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await boot(page, 'abandoned_armory', size.mobile);
      await enterFromRoute(page);
      const dialog = page.getByRole('dialog', { name: 'The Abandoned Armory', exact: true });
      await dialog.getByRole('button', { name: /^Force the barred door/ }).click();
      await page
        .getByRole('dialog', { name: 'Force the barred door', exact: true })
        .getByRole('button', { name: 'Choose', exact: true })
        .click();
      await expect(dialog.locator('.ev-outcome')).toHaveText('Someone was still home.');
      await expect(dialog.getByRole('button', { name: 'Fight', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
      await expect(dialog.getByText('There is no way around this fight.')).toBeVisible();
      const owed = await record(page);
      expect(owed.saved).toMatchObject({ choiceId: 'door', battle: 'pending', completed: false });
      // ESC leaves the fight owed; the route offers it again.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await record(page)).live).toMatchObject({ battle: 'pending', completed: false });
      await enterFromRoute(page, 'Return to the event');
      await dialog.getByRole('button', { name: 'Fight', exact: true }).click();
      await waitForScene(page, 'Battle');
      const type = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return s.runManager.nodeMap.nodes.find((n) => n.id === s.nodeId).type;
      });
      expect(type).toBe('event');
    });

    test('spoils that cannot be taken stay owed: Back to map, Try again, nothing lost', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = collectErrors(page);
      await boot(page, 'abandoned_armory', size.mobile);
      const dialog = await chooseDoorAndLeave(page);
      await returnWithSpoilsFailing(page);
      // The map opens the spoils by itself; they fail, and the page says so, with its ways on.
      await expect(dialog).toBeVisible();
      const gold = (await spoils(page)).live.gold; // after the battle's own gold
      await expect(dialog.locator('.ev-failed')).toContainText('The spoils could not be taken.');
      await expect(dialog.locator('.ev-failed')).toContainText('planted fault');
      const actions = dialog.locator('.ev-actions');
      for (const name of ['Try again', 'Back to map', 'Give up the spoils', 'Roster'])
        await expect(actions.getByRole('button', { name, exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('event-spoils-failed.png') });
      expect(await spoils(page)).toMatchObject({
        live: { owed: true },
        saved: { owed: true },
      });

      // Back to map closes it (no trap); everything is still owed, and the route holds the party.
      await actions.getByRole('button', { name: 'Back to map', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.re-node-map')).toBeVisible();
      expect(await spoils(page)).toMatchObject({ live: { owed: true }, saved: { owed: true } });
      await page
        .getByRole('button', { name: /^Event · / })
        .first()
        .click();
      await expect(page.locator('.re-loom-card')).toContainText('the spoils await');
      await page.getByRole('button', { name: 'Return to the event', exact: true }).click();

      // Back in: it tries again, and now they come, once.
      await expect(dialog.locator('.ev-result[data-kind="gold"]')).toContainText('Gained 200 G');
      await expect(dialog.locator('.ev-failed')).toHaveCount(0);
      expect(await spoils(page)).toMatchObject({
        live: { owed: false, gold: gold + 200 },
        saved: { owed: false, gold: gold + 200 },
      });
      await dialog.locator('.ev-primary').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await spoils(page)).toMatchObject({
        live: { owed: false, left: true },
        saved: { owed: false, left: true },
      });
      expect(errors.filter((e) => !/planted fault/.test(e))).toEqual([]);
    });

    test('Give up the spoils asks first, then is final and lets the road go on', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await boot(page, 'abandoned_armory', size.mobile);
      const dialog = await chooseDoorAndLeave(page);
      await returnWithSpoilsFailing(page);
      await expect(dialog.locator('.ev-failed')).toBeVisible();
      const gold = (await spoils(page)).live.gold;
      const actions = dialog.locator('.ev-actions');
      await actions.getByRole('button', { name: 'Give up the spoils', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Give up the spoils?', exact: true });
      await expect(confirm).toContainText('This cannot be undone.');
      // Declining keeps them owed.
      await confirm.getByRole('button', { name: 'Keep them owed', exact: true }).click();
      await expect(confirm).toHaveCount(0);
      await expect(dialog.locator('.ev-failed')).toBeVisible();
      expect(await spoils(page)).toMatchObject({ live: { owed: true }, saved: { owed: true } });
      // Confirming is final, saved at once, and takes nothing.
      await actions.getByRole('button', { name: 'Give up the spoils', exact: true }).click();
      await confirm.getByRole('button', { name: 'Give up the spoils', exact: true }).click();
      await expect(dialog.locator('.ev-result')).toContainText('You gave up the spoils.');
      await expect(dialog).not.toContainText('cellar cache');
      await expect(dialog.locator('.ev-failed')).toHaveCount(0);
      expect(await spoils(page)).toMatchObject({
        live: { owed: false, forfeited: true, gold },
        saved: { owed: false, forfeited: true, gold },
      });
      await dialog.locator('.ev-primary').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await spoils(page)).toMatchObject({
        saved: { owed: false, forfeited: true, left: true, gold },
      });
    });

    test('a burden has a chip on the route and a line in the pause menu', async ({ page }) => {
      test.setTimeout(90_000);
      await boot(page, 'twin_altar', size.mobile);
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const { addBurden } = await import('/src/engine/Burdens.js');
        addBurden(s.runManager, 'debt', { owed: 450 });
        addBurden(s.runManager, 'ill_omen');
        s.drawMap();
      });
      const chips = page.locator('.re-burden');
      await expect(chips).toHaveCount(2);
      await expect(chips.first()).toContainText('Debt');
      await expect(chips.first()).toContainText('450 G');
      await expectFits(page, '.re-node-map');
      await chips.first().click();
      await expect(page.locator('.re-burden-note')).toContainText('450 G owed');
      await chips.first().click();
      await expect(page.locator('.re-burden-note')).toBeHidden();
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      const list = page.locator('.mp-burdens');
      await expect(list).toContainText('Debt');
      await expect(list).toContainText('Ill Omen');
      await expect(list).toContainText('battles left');
    });
  });
}
