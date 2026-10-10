// Seer's Eye (docs/specs/blessings-v3.md §6.6): the route map's card lists the foes a battle holds
// (the scout: engine/BattleScout.js), and the battle entered from it fields exactly those foes, with
// the fog never hiding one. On a landscape phone (the upright panel is portrait-seers-eye.spec.js,
// in the portrait lane). Every wait is on state (the scene, the battle's state, the card's panel),
// never on time.
import { test, expect } from '@playwright/test';
import { pageErrors, phone } from './portraitHelpers.js';
import { loomCard as card, routeWithTheEye, scoutPanel as panel } from './seersEyeHelpers.js';

test.setTimeout(150_000);

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
