// The motivating case for the roster's Discard (CLAUDE.md "Roster Discard"), as one journey through the
// real page reloads: a won contract whose reward is a weapon, with every bag and the convoy full of
// weapons, is owed and holds the party at the node, where no shop can buy a weapon off it.
//   fixture (saved to slot 1) -> page reload -> Continue: the contract page opens by itself, Claim waits
//   -> its Roster -> Convoy -> Discard (confirmed) -> Close -> back on the page
//   -> page reload: the discard is saved and the reward is still owed -> Claim: the reward lands
//   -> Continue -> page reload: the discarded weapon is still gone, the Steel Lance is still owned, nothing
//   is owed again and nothing is paid twice.
// The run is only fixtured before the first reload (the review route supplies the party; the victory
// commit is the engine's own `completeBattle`); everything after is clicks on the real page, roster,
// confirmation and Title, and every read of the run comes from a run loaded out of storage.
//
// Ways this can fail:
//   1. Claim with no room changes the run, or the page does not say why it waits;
//   2. Discard in the contract page's Roster frees the wrong slot or is not saved;
//   3. a reload between the Discard and the Claim loses the discard or the owed reward;
//   4. Claim after the Discard still refuses, or pays twice, or a later reload owes the reward again.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
import { bootEvent } from './eventHelpers.js';

test.use({ viewport: { width: 640, height: 480 } });

/** The run as a reload reads it from slot 1, and the live scene's run. */
const state = (page) =>
  page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const read = (run) => ({
      lances: [...run.roster.flatMap((u) => u.inventory), ...run.convoy.weapons].filter(
        (i) => i.name === 'Steel Lance',
      ).length,
      stored: run.convoy.weapons.map((i) => i.uid),
      owed: Boolean(run.contractOwed),
    });
    return { live: read(s.runManager), saved: read(loadRun(s.gameData, 1)) };
  });

/** A signed weapon contract, every bag and the convoy full of Iron Swords, the battle won and saved. */
async function fixtureWonWithFullArmy(page) {
  await page.evaluate(async () => {
    const game = window.__emblemRogueGame;
    const s = game.scene.getScene('NodeMap');
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const { normalizeContract } = await import('/src/engine/Contracts.js');
    // Attach this test's isolated browser profile to a real slot, so Title offers it after a reload.
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    game.registry.set('activeSlot', 1);
    setActiveSlot(1);
    const run = s.runManager;
    run.contract = normalizeContract({
      goal: 'underPar',
      reward: [{ type: 'item', name: 'Steel Lance' }],
      penalty: [],
      eventId: 'mercenary_contract',
      nodeId: 'dev-contract',
      act: run.currentAct,
    });
    const sword = s.gameData.weapons.find((w) => w.name === 'Iron Sword');
    const blade = (name, uid) => ({ ...structuredClone(sword), name, uid });
    for (const unit of run.roster) {
      unit.inventory = Array.from({ length: 5 }, (_, i) =>
        blade(`${unit.name} Blade ${i}`, `${unit.name}-${i}`),
      );
      unit.weapon = unit.inventory[0];
    }
    const caps = run.getConvoyCapacities();
    run.convoy.weapons = Array.from({ length: caps.weapons }, (_, i) =>
      blade(`Stored Blade ${i + 1}`, `stored-${i + 1}`),
    );
    const battle = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
    run.currentNodeId = battle.id;
    run.completeBattle(run.getRoster(), battle.id, 100, { turnCount: 1, turnPar: 5 });
    s.persistRunSave();
  });
}

/** A real reload: the page, the Title, Save Slots, Select Slot 1, back on the route map. */
async function reloadAndContinue(page) {
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  const slots = page.getByRole('button', { name: 'Save Slots', exact: true });
  await expect(slots).toBeEnabled();
  // The boot-to-title router has a short cooldown: retry the click until the picker is up.
  await expect(async () => {
    await slots.click();
    await page.waitForFunction(() => window.__sceneState?.activeScene === 'SlotPicker', null, {
      timeout: 1500,
    });
  }).toPass();
  const select = page.getByRole('button', { name: 'Select Slot 1', exact: true });
  await expect(select).toBeEnabled();
  await select.click();
  await waitForScene(page, 'NodeMap');
}

test('full army, owed weapon reward: discard in the Roster, reload, Claim, reload', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
  await bootEvent(page, 'seed=42&event=abandoned_armory');
  await fixtureWonWithFullArmy(page);
  await reloadAndContinue(page);

  const dialog = page.getByRole('dialog', { name: 'Contract' });
  const actions = dialog.locator('.ev-actions');
  await expect(dialog.locator('.ev-failed')).toContainText('No room for Steel Lance');
  const before = await state(page);
  expect(before.live.owed).toBe(true);
  expect(before.live.stored).toHaveLength(before.saved.stored.length);
  expect(before.live.stored).toContain('stored-7');

  // Claim with no room: still owed, nothing changed.
  await actions.getByRole('button', { name: 'Claim', exact: true }).click();
  await expect(dialog).toContainText('Still waiting: No room for Steel Lance');
  expect(await state(page)).toEqual(before);

  // Roster > Convoy > Discard Stored Blade 7 > confirm > Close: back on the contract page.
  await actions.getByRole('button', { name: 'Roster', exact: true }).click();
  const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await expect(roster).toBeVisible();
  await roster.getByRole('button', { name: 'Convoy', exact: true }).click();
  const card = roster.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'Stored Blade 7', exact: true }),
  });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: 'Discard', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Discard Stored Blade 7?', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await roster.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toBeVisible();
  const made = await state(page);
  for (const view of [made.live, made.saved]) {
    expect(view.stored).not.toContain('stored-7');
    expect(view.stored).toHaveLength(before.live.stored.length - 1);
    expect(view.owed).toBe(true);
  }

  // A reload between the discard and the Claim keeps both: the weapon is gone, the reward still owed.
  await reloadAndContinue(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.ev-failed')).toContainText('No room for Steel Lance');
  await expect(actions.getByRole('button', { name: 'Claim', exact: true })).toBeVisible();
  const resumed = await state(page);
  for (const view of [resumed.live, resumed.saved]) {
    expect(view.stored).not.toContain('stored-7');
    expect(view.stored).toHaveLength(before.live.stored.length - 1);
    expect(view.lances).toBe(before.live.lances);
    expect(view.owed).toBe(true);
  }

  // Claim: the Steel Lance arrives, once, and the save holds it.
  await actions.getByRole('button', { name: 'Claim', exact: true }).click();
  await expect(dialog.locator('.ev-result[data-kind="item"]')).toContainText('Steel Lance');
  await expect(dialog).toContainText('The reward arrived.');
  const claimed = await state(page);
  for (const view of [claimed.live, claimed.saved]) {
    expect(view.lances).toBe(before.live.lances + 1);
    expect(view.owed).toBe(false);
    expect(view.stored).toHaveLength(before.live.stored.length);
  }

  // Continue frees the party; one more reload: still gone, still owned, nothing owed or paid again.
  await actions.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await reloadAndContinue(page);
  await expect(page.locator('.re-node-map')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await state(page);
  for (const view of [after.live, after.saved]) {
    expect(view.stored).not.toContain('stored-7');
    expect(view.stored).toHaveLength(before.live.stored.length);
    expect(view.lances).toBe(before.live.lances + 1);
    expect(view.owed).toBe(false);
  }
});
