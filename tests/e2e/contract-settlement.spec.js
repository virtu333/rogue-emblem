// A contract's earned reward that cannot be delivered stays owed (docs/specs/event-nodes-phase2.md
// "Contract settlement recovery"): the party won a battle under a kept contract with every bag and the
// convoy full, so the reward (a consumable) has nowhere to go. The route map holds the party at the
// battle node and opens the settlement page; the player makes room through the real Roster, Claims, and
// the reward arrives exactly once. The review route (`?devScene=nodemap&preset=event`) supplies the run;
// the battle's victory commit is the engine's own (`completeBattle`, saved, then the scene is rebuilt from
// the slot as a refresh does), the rest is clicks on the real page, roster and route map.
//
// Ways this can fail, a test each:
//   1. the won battle closes a full-army reward as a "No room" note (forfeited unasked), or the map
//      does not open the page, or the page hides why it waits or one of its ways on;
//   2. Claim with no room loses the claim or says nothing; Back to map traps the player or forgets it;
//      the held node cannot be re-entered (the loom's card, the contract chip);
//   3. making room through the Roster and pressing Claim does not deliver the reward exactly once,
//      does not save it, or leaves the party held;
//   4. Give up is not confirmed, or is not final and saved;
//   5. the page overflows or is clipped at 640x480 and on a landscape phone.
import { test, expect } from '@playwright/test';
import { collectErrors } from './helpers.js';
import { bootEvent, expectFits, refreshFromSlot } from './eventHelpers.js';

const SIZES = [
  { name: 'desktop 640x480', viewport: { width: 640, height: 480 }, mobile: false },
  { name: 'phone 844x390', viewport: { width: 844, height: 390 }, mobile: true },
];

/**
 * A signed contract (reward: a Vulnerary), every consumable bag and the convoy full of one-use Elixirs,
 * Edric wounded (so an Elixir can be used to make room), the next battle won in the engine's own victory
 * commit and saved, then the scene rebuilt from the slot, as a refresh does.
 */
async function wonWithFullArmy(page) {
  return page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const { normalizeContract } = await import('/src/engine/Contracts.js');
    const run = s.runManager;
    run.contract = normalizeContract({
      goal: 'underPar',
      reward: [{ type: 'item', name: 'Vulnerary' }],
      penalty: [],
      eventId: 'mercenary_contract',
      nodeId: 'dev-contract',
      act: run.currentAct,
    });
    const elixir = () => ({ ...run.getConsumableTemplate('Elixir'), uses: 1 });
    run.roster[0].consumables = []; // Edric carries nothing but Elixirs: his first Use frees a slot
    for (const unit of run.roster)
      while (unit.consumables.length < 3) unit.consumables.push(elixir());
    const caps = run.getConvoyCapacities();
    while (run.convoy.consumables.length < caps.consumables) run.convoy.consumables.push(elixir());
    run.roster[0].currentHP = 1;
    const battle = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
    run.currentNodeId = battle.id;
    const have = () =>
      run.roster.flatMap((u) => u.consumables).filter((i) => i.name === 'Vulnerary').length +
      run.convoy.consumables.filter((i) => i.name === 'Vulnerary').length;
    const vulneraries = have(); // the starting kit already carries some
    run.completeBattle(run.getRoster(), battle.id, 100, { turnCount: 1, turnPar: 5 });
    s.registry.set('activeSlot', 1);
    s.persistRunSave();
    s.scene.start('NodeMap', { gameData: s.gameData, runManager: loadRun(s.gameData, 1) });
    return { battleId: battle.id, vulneraries };
  });
}

/** The run's contract state and how many Vulneraries the army carries, live and as saved in slot 1. */
const state = (page, battleId) =>
  page.evaluate(async (id) => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const read = (run) => {
      const vulneraries =
        run.roster.flatMap((u) => u.consumables).filter((i) => i.name === 'Vulnerary').length +
        run.convoy.consumables.filter((i) => i.name === 'Vulnerary').length;
      return {
        owed: run.contractOwed
          ? { kept: run.contractOwed.kept, blocked: run.contractOwed.blocked }
          : null,
        open: run.contract ? run.contract.goal : null,
        vulneraries,
        held:
          run
            .getAvailableNodes()
            .map((n) => n.id)
            .join() === id,
        elixirs:
          run.roster.flatMap((u) => u.consumables).filter((i) => i.name === 'Elixir').length +
          run.convoy.consumables.filter((i) => i.name === 'Elixir').length,
      };
    };
    return { live: read(s.runManager), saved: read(loadRun(s.gameData, 1)) };
  }, battleId);

const page_ = (page) => page.getByRole('dialog', { name: 'Contract' });
/** The page's own action row (the header's close button reads the same words). */
const actions = (dialog) => dialog.locator('.ev-actions');

for (const size of SIZES) {
  test.describe(`contract settlement ${size.name}`, () => {
    test.use({ viewport: size.viewport });

    test('a full army wins a kept contract: the reward waits, room is made through the Roster, Claim delivers once', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = collectErrors(page);
      await bootEvent(
        page,
        `seed=42&event=abandoned_armory${size.mobile ? '&mobilePreview=1' : ''}`,
      );
      const { battleId, vulneraries } = await wonWithFullArmy(page);
      const dialog = page_(page);

      // The map holds the party at the battle node and opens the page by itself.
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.ev-failed')).toContainText('The reward is waiting.');
      await expect(dialog.locator('.ev-failed')).toContainText('No room for Vulnerary');
      for (const name of ['Claim', 'Back to map', 'Give up the reward', 'Roster'])
        await expect(actions(dialog).getByRole('button', { name, exact: true })).toBeVisible();
      await expect(
        actions(dialog).getByRole('button', { name: 'Continue', exact: true }),
      ).toHaveCount(0);
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('contract-owed.png') });
      expect(await state(page, battleId)).toMatchObject({
        live: { owed: { kept: true, blocked: 'No room for Vulnerary' }, open: null, held: true },
        saved: { owed: { kept: true }, held: true },
      });

      // Claim with no room: it says so, and everything is still owed.
      await actions(dialog).getByRole('button', { name: 'Claim', exact: true }).click();
      await expect(dialog).toContainText('Still waiting: No room for Vulnerary');
      expect((await state(page, battleId)).saved.vulneraries).toBe(vulneraries);

      // Back to map: no trap, still owed; the held node's card and the chip reopen the page.
      await actions(dialog).getByRole('button', { name: 'Back to map', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.re-node-map')).toBeVisible();
      expect(await state(page, battleId)).toMatchObject({
        live: { owed: { kept: true }, held: true },
        saved: { owed: { kept: true }, held: true },
      });
      // The held node's card says so and its button settles the contract.
      await page
        .getByRole('button', { name: /· You are here/ })
        .first()
        .click();
      await expect(page.locator('.re-loom-card')).toContainText('the contract reward waits');
      await page.getByRole('button', { name: 'Settle contract', exact: true }).click();
      await expect(dialog).toBeVisible();
      await actions(dialog).getByRole('button', { name: 'Back to map', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const chip = page.locator('.re-burden.re-contract.is-owed');
      await expect(chip).toContainText('Reward waiting');
      await chip.click();
      await expect(dialog).toBeVisible();
      await actions(dialog).getByRole('button', { name: 'Back to map', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // A refresh reopens it by itself: the claim was saved.
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const { loadRun } = await import('/src/engine/RunManager.js');
        s.scene.start('NodeMap', { gameData: s.gameData, runManager: loadRun(s.gameData, 1) });
      });
      await expect(dialog).toBeVisible();

      // Make room through the real Roster: Edric uses an Elixir (one use: its slot is freed).
      await actions(dialog).getByRole('button', { name: 'Roster', exact: true }).click();
      const roster = page.getByRole('dialog').last();
      await expect(roster).toBeVisible();
      await roster.getByRole('button', { name: /Edric/ }).first().click();
      await roster.getByRole('button', { name: 'Equipment', exact: true }).click();
      await roster.getByRole('button', { name: 'Use', exact: true }).first().click();
      await roster.getByRole('button', { name: 'Close', exact: true }).first().click();
      await expect(dialog).toBeVisible();
      expect((await state(page, battleId)).live.elixirs).toBeGreaterThan(0);

      // Claim: the reward arrives, once; the page says what came, and saved.
      await actions(dialog).getByRole('button', { name: 'Claim', exact: true }).click();
      await expect(dialog.locator('.ev-result[data-kind="item"]')).toContainText('Vulnerary');
      await expect(dialog).toContainText('The reward arrived.');
      expect(await state(page, battleId)).toMatchObject({
        live: { owed: null, vulneraries: vulneraries + 1 },
        saved: { owed: null, vulneraries: vulneraries + 1 },
      });
      await page.screenshot({ path: info.outputPath('contract-claimed.png') });

      // Continue frees the party; nothing is owed after a refresh, and nothing more is paid.
      await actions(dialog).getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await refreshFromSlot(page);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await state(page, battleId)).toMatchObject({
        live: { owed: null, vulneraries: vulneraries + 1, held: false },
        saved: { owed: null, vulneraries: vulneraries + 1, held: false },
      });
      expect(errors).toEqual([]);
    });

    test('Give up asks first, then is final: nothing is paid and the road goes on', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await bootEvent(
        page,
        `seed=42&event=abandoned_armory${size.mobile ? '&mobilePreview=1' : ''}`,
      );
      const { battleId, vulneraries } = await wonWithFullArmy(page);
      const dialog = page_(page);
      await expect(dialog).toBeVisible();
      await actions(dialog)
        .getByRole('button', { name: 'Give up the reward', exact: true })
        .click();
      const confirm = page.getByRole('dialog').last();
      await expect(confirm).toContainText('Give up the reward?');
      await expect(confirm).toContainText('This cannot be undone.');
      // Keep it owed: nothing changes.
      await confirm.getByRole('button', { name: 'Keep it owed', exact: true }).click();
      await expect(dialog).toContainText('The reward is waiting.');
      expect((await state(page, battleId)).saved.owed).toMatchObject({ kept: true });
      // Confirmed: final, saved, and the party is free.
      await actions(dialog)
        .getByRole('button', { name: 'Give up the reward', exact: true })
        .click();
      await page
        .getByRole('dialog')
        .last()
        .getByRole('button', { name: 'Give up the reward', exact: true })
        .click();
      await expect(dialog).toContainText('You gave up the reward.');
      expect(await state(page, battleId)).toMatchObject({
        live: { owed: null, vulneraries, held: false },
        saved: { owed: null, vulneraries, held: false },
      });
      await actions(dialog).getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.re-burden.re-contract')).toHaveCount(0);
    });
  });
}
