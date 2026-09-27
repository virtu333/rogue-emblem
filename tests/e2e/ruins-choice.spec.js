// The Ruins offer Rest (heal, revive) OR Scavenge (the wares), one per visit
// (engine/RuinsCommands.js). Each flow walks the real sanctuary: choose, use the
// chosen side, leave, re-enter from the route — and the other side never returns.
// The choice screen and its confirmation must fit at the design size and on two
// landscape phones.
import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, collectErrors } from './helpers.js';

const SIZES = [
  { name: 'desktop 640x480', viewport: { width: 640, height: 480 }, mobile: false },
  { name: 'phone 844x390', viewport: { width: 844, height: 390 }, mobile: true },
  { name: 'phone 667x375', viewport: { width: 667, height: 375 }, mobile: true },
];
const REST = 'Rest — heal everyone, revive the fallen';
const SCAVENGE = "Scavenge — the ruins' wares (+25%)";

// No horizontal overflow, and the whole box inside the viewport's width.
async function expectFits(locator, viewport) {
  await locator.scrollIntoViewIfNeeded();
  expect(await locator.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  const box = await locator.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

// Walk the route to the act's real pre-boss ruins with one unit wounded and one ally fallen.
async function enterRuins(page, mobile) {
  await page.goto(`/?devScene=nodemap${mobile ? '&mobilePreview=1' : ''}`);
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible' });
  await skip.click();
  return page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const r = s.runManager;
    s.registry.set('activeSlot', 1);
    r.gold = 10000;
    const ruins = r.nodeMap.nodes.find((n) => n.type === 'ruins');
    const before = r.nodeMap.nodes.find((n) => n.edges.includes(ruins.id));
    before.completed = true;
    r.currentNodeId = before.id;
    r.roster[0].currentHP = 1;
    const { createUnit } = await import('/src/engine/UnitManager.js');
    const fallen = createUnit(
      s.gameData.classes.find((c) => c.name === 'Fighter'),
      2,
      s.gameData.weapons,
      { name: 'Ruinsfallen' },
    );
    fallen.currentHP = 0;
    r.fallenUnits.push(fallen);
    s.onNodeClick(ruins);
    return { id: ruins.id, maxHp: r.roster[0].stats.HP };
  });
}

const runState = (page, id) =>
  page.evaluate(async (nodeId) => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const r = s.runManager;
    const { loadRun } = await import('/src/engine/RunManager.js');
    return {
      choice: r.ruinsChoiceByNodeId[nodeId] ?? null,
      saved: loadRun(s.gameData, 1)?.ruinsChoiceByNodeId?.[nodeId] ?? null,
      hp: r.roster[0].currentHP,
      gold: r.gold,
      revived: r.roster.some((u) => u.name === 'Ruinsfallen'),
    };
  }, id);

// The route's inspect card names the chosen path; re-entering opens the sanctuary.
async function reenterFromRoute(page, chosenLine) {
  await page
    .getByRole('button', { name: /^Ruins ·/ })
    .first()
    .click();
  await expect(page.getByText(chosenLine, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to ruins', exact: true }).click();
}

for (const size of SIZES) {
  test.describe(`ruins choice ${size.name}`, () => {
    test.use({ viewport: size.viewport, hasTouch: size.mobile, isMobile: size.mobile });

    test('Scavenge: buy, leave and re-enter — no heal or revive offered', async ({
      page,
    }, info) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      const { id } = await enterRuins(page, size.mobile);
      const sanctuary = page.getByRole('dialog', { name: 'Ruins sanctuary', exact: true });
      await expect(sanctuary).toBeVisible();
      await expect(sanctuary.locator('.ia-band-kicker')).toHaveText('Heal or wares');
      const rest = sanctuary.getByRole('button', { name: REST, exact: true });
      const scavenge = sanctuary.getByRole('button', { name: SCAVENGE, exact: true });
      await expect(rest).toBeVisible();
      await expect(scavenge).toBeVisible();
      await expect(sanctuary.getByRole('button', { name: 'Heal all · Free' })).toHaveCount(0);
      await expect(sanctuary.getByRole('button', { name: 'Browse wares' })).toHaveCount(0);
      await expect(sanctuary.getByRole('button', { name: /Revive/ })).toHaveCount(0);
      for (const target of [sanctuary, rest, scavenge]) await expectFits(target, size.viewport);
      await page.screenshot({ path: info.outputPath('ruins-choice.png') });

      await scavenge.click();
      const confirm = page.getByRole('dialog', { name: 'Scavenge the ruins?', exact: true });
      await expect(confirm).toContainText('This cannot be undone.');
      await expectFits(confirm, size.viewport);
      await page.screenshot({ path: info.outputPath('ruins-confirm.png') });
      await confirm.getByRole('button', { name: 'Scavenge', exact: true }).click();

      const market = page.getByRole('dialog', { name: 'Ruins market', exact: true });
      await expect(market).toBeVisible();
      expect(await runState(page, id)).toMatchObject({ choice: 'scavenge', saved: 'scavenge' });

      // Buy the stock's Vulnerary (the shop guarantees one) for its listed price.
      const goldBefore = (await runState(page, id)).gold;
      await market.locator('.shop-row').filter({ hasText: 'Vulnerary' }).first().click();
      const buy = market.getByRole('button', { name: /^Buy · \d+ G$/ });
      const price = Number((await buy.textContent()).match(/(\d+) G/)[1]);
      await buy.click();
      const give = page.getByRole('dialog', { name: 'Give Vulnerary to', exact: true });
      await give.locator('.re-btn--primary').click();
      await expect(give).toHaveCount(0);
      expect((await runState(page, id)).gold).toBe(goldBefore - price);

      await market.getByRole('button', { name: 'Return to ruins', exact: true }).click();
      await expect(sanctuary).toBeVisible();
      await expect(sanctuary).toContainText('You chose to scavenge here. No rest tonight.');
      await expect(sanctuary.locator('.ia-band-kicker')).toHaveText('Scavenge · Wares');
      await expect(sanctuary.getByRole('button', { name: 'Browse wares' })).toBeVisible();
      for (const gone of [REST, SCAVENGE, 'Heal all · Free'])
        await expect(sanctuary.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
      await expect(sanctuary.getByRole('button', { name: /Revive/ })).toHaveCount(0);

      await sanctuary.getByRole('button', { name: 'Leave', exact: true }).click();
      await expect(sanctuary).toHaveCount(0);
      await reenterFromRoute(page, 'You chose to scavenge here. No rest tonight.');
      await expect(sanctuary).toBeVisible();
      await expect(sanctuary.getByRole('button', { name: 'Browse wares' })).toBeVisible();
      await expect(sanctuary.getByRole('button', { name: 'Heal all · Free' })).toHaveCount(0);
      await expect(sanctuary.getByRole('button', { name: REST, exact: true })).toHaveCount(0);
      await expect(sanctuary.getByRole('button', { name: /Revive/ })).toHaveCount(0);
      expect(await runState(page, id)).toMatchObject({
        choice: 'scavenge',
        saved: 'scavenge',
        hp: 1,
        revived: false,
      });
      expect(errors).toEqual([]);
    });

    test('Rest: heals at once, revives, and no wares after re-entry', async ({ page }, info) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      const { id, maxHp } = await enterRuins(page, size.mobile);
      const sanctuary = page.getByRole('dialog', { name: 'Ruins sanctuary', exact: true });
      await sanctuary.getByRole('button', { name: REST, exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Rest here?', exact: true });
      await expect(confirm).toContainText('1 waiting');
      await expectFits(confirm, size.viewport);
      await confirm.getByRole('button', { name: 'Rest', exact: true }).click();
      await expect(confirm).toHaveCount(0);
      await expect(sanctuary.getByRole('status')).toContainText('All units healed.');
      expect(await runState(page, id)).toMatchObject({ choice: 'rest', saved: 'rest', hp: maxHp });
      await expect(sanctuary).toContainText('You chose to rest here. The wares stay buried.');
      await expect(sanctuary.locator('.ia-band-kicker')).toHaveText('Rest · Heal · Revive');
      await expect(sanctuary.getByRole('button', { name: 'Browse wares' })).toHaveCount(0);
      await expect(sanctuary.getByRole('button', { name: SCAVENGE, exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('ruins-rest.png') });

      // Ruinsfallen: a level 2 Fighter, 500 + 2 × 300 gold.
      const gold = (await runState(page, id)).gold;
      await sanctuary
        .getByRole('button', { name: /Ruinsfallen · Fighter · Revive 1100 G/ })
        .click();
      await page
        .getByRole('dialog', { name: 'Revive Ruinsfallen?', exact: true })
        .getByRole('button', { name: 'Confirm', exact: true })
        .click();
      await expect(sanctuary.getByRole('status')).toContainText('Ruinsfallen revived');
      expect(await runState(page, id)).toMatchObject({ gold: gold - 1100, revived: true });

      await sanctuary.getByRole('button', { name: 'Leave', exact: true }).click();
      await reenterFromRoute(page, 'You chose to rest here. The wares stay buried.');
      await expect(sanctuary).toBeVisible();
      await expect(sanctuary.getByRole('button', { name: 'Heal all · Free' })).toBeVisible();
      await expect(sanctuary.getByRole('button', { name: 'Browse wares' })).toHaveCount(0);
      await expect(sanctuary.getByRole('button', { name: SCAVENGE, exact: true })).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: 'Ruins market' })).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}
