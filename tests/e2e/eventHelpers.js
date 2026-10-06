// Shared steps for the Event page specs (event-pages.spec.js, portrait-event-pages.spec.js,
// docs/specs/event-nodes-phase2.md §2E). The review route `?devScene=nodemap&preset=event
// &seed=N&event=<id>` puts the party one click from an event; the Phase 2 extras (devStartup
// applyEventPreset) are `as=church|colosseum`, `burdens=`, `contract=`, `omen=1` and `units=`,
// and the `dev_*` events are review fixtures (src/utils/devEventFixtures.js).
import { expect } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

/**
 * Open the review route and reach the route map with a durable slot (so a save is a real one).
 * `tap`: skip the story with a tap (a touch context), else a click.
 */
export async function bootEvent(page, query, { tap = false, hints = false } = {}) {
  await page.addInitScript(
    (settings) => localStorage.setItem('emblem_rogue_settings', JSON.stringify(settings)),
    { musicVolume: 0, sfxVolume: 0, hints },
  );
  await page.goto(`/?devScene=nodemap&preset=event&${query}`);
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible' });
  if (tap) await skip.tap();
  else await skip.click();
  await expect(page.locator('.re-node-map')).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.persistRunSave();
  });
}

/** Select the node of this kind ("Event", "Church", "Colosseum", ...) and press Travel. */
export async function enterNode(page, kind = 'Event', { label = 'Travel', tap = false } = {}) {
  const node = page.getByRole('button', {
    name: new RegExp(`^${kind} · (Available|You are here)`),
  });
  if (tap) await node.first().tap();
  else await node.first().click();
  const go = page.getByRole('button', { name: label, exact: true });
  if (tap) await go.tap();
  else await go.click();
}

/** A press: a tap on a touch context, else a click. */
export const press = (locator, tap) => (tap ? locator.tap() : locator.click());

/** Choose a choice of the event page through its confirmation (nothing is chosen until Choose). */
export async function chooseThrough(page, dialog, name, { tap = false } = {}) {
  const choice = dialog.getByRole('button', { name });
  await press(choice, tap);
  const confirm = page.getByRole('dialog').last();
  await press(confirm.getByRole('button', { name: /^Choose/ }), tap);
}

/** The event node's saved record (slot 1): what a refresh would read. */
export const savedEvent = (page) =>
  page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const run = loadRun(s.runManager.gameData, 1);
    const node = run.nodeMap.nodes.find((n) => run.eventStateByNodeId[n.id]);
    const state = node ? run.eventStateByNodeId[node.id] : null;
    return {
      eventId: state?.eventId ?? null,
      page: state?.page ?? 'start',
      steps: (state?.path || []).length,
      choiceId: state?.choiceId ?? null,
      counters: state?.counters ?? null,
      completed: node?.completed ?? null,
      gold: run.gold,
      contract: run.contract ?? null,
      burdens: (run.burdens || []).map((b) => b.id),
      roster: run.roster.map((u) => u.name),
      vows: run.churchVowByNodeId || {},
    };
  });

/** A refresh: the scene rebuilt from the saved slot, as a reload would. */
export async function refreshFromSlot(page) {
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    s.scene.start('NodeMap', {
      gameData: s.runManager.gameData,
      runManager: loadRun(s.runManager.gameData, 1),
    });
  });
  await expect(page.locator('.re-node-map')).toBeVisible();
}

/** Nothing scrolls sideways and nothing leaves the viewport on the right. */
export async function expectFits(page, selector) {
  await page.evaluate(() => document.fonts.ready);
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
