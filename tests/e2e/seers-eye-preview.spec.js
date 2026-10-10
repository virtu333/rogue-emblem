// Seer's Eye (docs/specs/blessings-v3.md §6.6): the route map's card lists the foes a battle holds
// (the scout: engine/BattleScout.js), and the battle entered from it fields exactly those foes, with
// the fog never hiding one. On a landscape phone, then upright. Every wait is on state (the scene,
// the battle's state, the card's panel), never on time.
import { test, expect } from '@playwright/test';
import { attachSlot, pageErrors, phone, quietSettings } from './portraitHelpers.js';
import { waitForGame, waitForScene } from './helpers.js';

test.setTimeout(150_000);

/** The dev route map, with Seer's Eye held and the first reachable node a fogged battle. */
async function routeWithTheEye(page) {
  await quietSettings(page, { battleSpeed: 'fast' });
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  if (await skip.isVisible()) await skip.tap();
  await attachSlot(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')?.isSceneReady),
    )
    .toBe(true);
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const r = s.runManager;
    if (!r.addBlessingMidRun('seers_eye', { earned: true })) throw new Error('no Seer’s Eye');
    // A battle the party can walk into, with fog (a run's first battle never has fog).
    const node = r.getAvailableNodes().find((n) => n.type === 'battle' && n.battleParams);
    if (!node) throw new Error('no battle in reach');
    node.fogEnabled = true;
    r.completedBattles = Math.max(1, r.completedBattles || 0);
    // A small army: every unit deploys, as the scout assumes (no deploy screen to choose fewer).
    r.roster = r.roster.slice(0, 2);
    s.drawMap();
    return node.id;
  });
}

const card = (page) => page.locator('.re-loom-card');
const panel = (page) => card(page).locator('.re-loom-scout');

test.describe('landscape phone', () => {
  const { defaultBrowserType: _browser, ...use } = phone({ width: 667, height: 375 });
  test.use(use);

  test("the card lists the battle's foes; the battle fields exactly them, none hidden by fog", async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const nodeId = await routeWithTheEye(page);
    await page.locator(`.re-node[data-node="${nodeId}"]`).tap();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText("Seer's Eye");
    await expect(panel(page)).toContainText('Scouted for 2 in the field.');
    const rows = await panel(page).locator('li').allTextContents();
    expect(rows.length).toBeGreaterThan(0);
    // The scout never locked the node (the Eclipse could still take it).
    expect(
      await page.evaluate(
        (id) =>
          window.__emblemRogueGame.scene
            .getScene('NodeMap')
            .runManager.nodeMap.nodes.find((n) => n.id === id).encounterLocked === true,
        nodeId,
      ),
    ).toBe(false);
    // Nothing spills sideways on a phone.
    expect(await card(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    const scouted = await page.evaluate(async (id) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const { scoutBattle } = await import('/src/engine/BattleScout.js');
      const node = s.runManager.nodeMap.nodes.find((n) => n.id === id);
      return scoutBattle(s.runManager, node).foes.map((f) => `${f.className}:${f.level}`);
    }, nodeId);

    await page.getByRole('button', { name: 'Travel', exact: true }).tap();
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
      timeout: 90_000,
    });
    const field = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const hidden = s.enemyUnits.filter((e) => !s.grid.isVisible(e.col, e.row));
      return {
        spawns: s.battleConfig.enemySpawns.map((e) => `${e.className}:${e.level}`),
        fog: s.grid.fogEnabled,
        foesShown: s.grid.foesShown,
        inFog: hidden.length,
        drawn: s.enemyUnits.every((e) => e.graphic?.visible !== false),
      };
    });
    // The scout's list is the battle's own.
    expect(field.spawns).toEqual(scouted);
    // Fog on, foes in it, and every foe drawn.
    expect(field.fog).toBe(true);
    expect(field.foesShown).toBe(true);
    expect(field.inFog).toBeGreaterThan(0);
    expect(field.drawn).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('upright phone', () => {
  const { defaultBrowserType: _browser, ...use } = phone({ width: 375, height: 667 });
  test.use(use);

  test('the panel wraps inside the card: no sideways scroll, every row readable', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const nodeId = await routeWithTheEye(page);
    await expect(page.locator('html')).toHaveClass(/\bportrait-ui\b/);
    await page.locator(`.re-node[data-node="${nodeId}"]`).tap();
    await expect(panel(page)).toBeAttached();
    await panel(page).scrollIntoViewIfNeeded();
    await expect(panel(page)).toContainText('Scouted for 2 in the field.');
    expect(await card(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    const rows = panel(page).locator('li');
    for (const row of await rows.all())
      expect(await row.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
});
