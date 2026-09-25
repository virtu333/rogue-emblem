import { test, expect } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';

// Strategy layer (docs/specs/strategy-layer.md): a recruit knot on the Loom names who
// waits there (class, level, traits) and warns that it is an elite fight; the recruit
// battle then spawns exactly that unit, within reach of a lord, under a gold banner
// from turn 1. Desktop and phone landscape. Captures feed
// docs/art-direction/gameplay/strategy-layer/ when STRATEGY_LAYER_SHOTS is set.

const SHOTS = process.env.STRATEGY_LAYER_SHOTS || null;
// Each test boots the game and builds a run (and, for the battle, a map); allow for a
// loaded CI box like the other battle specs do.
test.setTimeout(90_000);
const VIEWPORTS = [
  { label: 'desktop', width: 1280, height: 800, mobile: false },
  { label: 'phone', width: 844, height: 390, mobile: true },
];

for (const vp of VIEWPORTS) {
  test(`the loom previews a recruit knot (${vp.label})`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(
      `/?devScene=nodemap&preset=battle_smoke&seed=42${vp.mobile ? '&mobilePreview=1' : ''}`,
    );
    await waitForScene(page, 'NodeMap');
    await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
    const route = page.locator('.re-node-map');
    await expect(route).toBeVisible();

    const expected = await page.evaluate(() => {
      const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
      const node = rm.nodeMap.nodes.find((n) => n.type === 'recruit' && !n.completed && !n.eclipse);
      if (!node) return null;
      const built = rm.getRecruitNodeUnit(node);
      const again = rm.getRecruitNodeUnit(node);
      return {
        id: node.id,
        name: built.unit.name,
        className: built.unit.className,
        level: built.unit.level,
        traits: (built.unit.traits || []).length,
        stable:
          again.unit.name === built.unit.name &&
          again.unit.level === built.unit.level &&
          JSON.stringify(again.unit.stats) === JSON.stringify(built.unit.stats),
        mods: rm.getRecruitNodeBattleMods(node),
      };
    });
    expect(expected, 'seed 42 act II has a recruit knot').not.toBeNull();
    expect(expected.stable).toBe(true);

    await route.locator(`.re-node[data-node="${expected.id}"]`).click();
    const card = route.locator('.re-loom-card');
    const block = card.locator('.re-loom-recruit');
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute(
      'aria-label',
      `Recruit: ${expected.name}, ${expected.className}, level ${expected.level}`,
    );
    await expect(block.locator('.re-loom-recruit-name')).toHaveText(expected.name);
    await expect(block.locator('.re-loom-recruit-kicker')).toContainText(
      `${expected.className.toUpperCase()} · LV ${expected.level}`,
    );
    await expect(block.locator('.re-loom-recruit-stats > div')).toHaveCount(6);
    if (expected.traits > 0)
      await expect(block.locator('.re-loom-recruit-traits li')).toHaveCount(expected.traits);
    await expect(card.locator('.re-loom-place')).toHaveText(new RegExp(`^${expected.name}, `));
    // The elite warning: extra hunters and a captain (difficulty data).
    await expect(card.locator('.re-loom-tag.is-bad').first()).toHaveText(
      `Hunters +${expected.mods.enemyCountBonus}`,
    );
    await expect(card.locator('.re-loom-tag', { hasText: 'Captain' })).toHaveCount(1);
    await expect(card.locator('.re-loom-text')).toHaveText(
      `Hunters are closing on ${expected.name}. Reach them with a lord and Talk.`,
    );

    // The card stays inside its pane (no horizontal overflow at either size).
    const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (SHOTS) {
      await block.scrollIntoViewIfNeeded();
      // Dev routes have no save slot; let that toast clear before the capture.
      await expect(page.getByText(/^Save failed/)).toHaveCount(0, { timeout: 20_000 });
      await page.screenshot({ path: `${SHOTS}/loom_recruit_${vp.label}.png` });
    }
    expect(errors).toEqual([]);
  });

  test(`the recruit battle marks the previewed recruit from turn 1 (${vp.label})`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(
      `/?devScene=battle&preset=battle_smoke&seed=42&devNode=recruit${vp.mobile ? '&mobilePreview=1' : ''}`,
    );
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      null,
      { timeout: 30_000 },
    );
    const state = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const rm = s.runManager;
      const node = rm.nodeMap.nodes.find((n) => n.id === s.nodeId);
      const preview = rm.getRecruitNodeUnit(node).unit;
      const npc = s.npcUnits[0];
      const beacon = s._recruitBeacon;
      const label = beacon?.objects.find((o) => o.name === 'recruit-beacon-label');
      const lords = s.playerUnits.filter((u) => u.isLord);
      const nearest = Math.min(
        ...lords.map((u) => Math.abs(u.col - npc.col) + Math.abs(u.row - npc.row)),
      );
      return {
        npc: { name: npc?.name, className: npc?.className, level: npc?.level },
        preview: { name: preview.name, className: preview.className, level: preview.level },
        beaconOn: beacon?.npc === npc,
        label: label ? { text: label.text, visible: label.visible, depth: label.depth } : null,
        objective: s.objectiveText?.text || '',
        nearest,
        turn: s.turnManager?.turnNumber,
      };
    });
    expect(state.turn).toBe(1);
    expect(state.npc).toEqual(state.preview);
    expect(state.beaconOn).toBe(true);
    expect(state.label).toEqual({ text: 'RECRUIT', visible: true, depth: 14 });
    expect(state.objective).toContain(`Recruit: reach ${state.npc.name} with a lord`);
    // Placed for a rescue: a lord starts within a couple of turns' walk.
    expect(state.nearest).toBeLessThanOrEqual(12);
    // The one-time field note names the recruit, then gets out of the way.
    const note = page.getByText(
      `${state.npc.name} (${state.npc.className}) holds out under the gold banner`,
    );
    await expect(note).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(note).toHaveCount(0);
    if (SHOTS) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/battle_beacon_${vp.label}.png` });
    }
    expect(errors).toEqual([]);
  });
}
