// The Rite on Act V's route map and the Vigil's markers, through the real UI
// (docs/specs/act-v-descent.md §4, §8). The Descent ships dark; the review route
// `?devScene=nodemap&preset=fresh&descent=1&difficulty=hard&rite=7&descentRow=4` (src/utils/
// devDescentFixtures.js, dev routes only) switches it on for that page and walks the army to the
// Lieutenant's gate.
//
// Ways this can fail, a test each:
//   1. the Rite chip is missing, wrong, or shows on an ordinary run;
//   2. the chip's note cannot be opened or closed, or reads the wrong tier or bosses;
//   3. the gate's (and the finale's) loom card shows no Rite block, or one for another tier;
//   4. a locked battle's card promises the tier the words stand at instead of its locked map;
//   5. any of it overflows the page sideways or is clipped, at a desktop, a landscape phone and
//      an upright phone;
//   6. the Vigil's markers are not drawn, or are not drawn per state (lit / empty / silent).
import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, collectErrors } from './helpers.js';
import {
  expectNoSidewaysScroll,
  expectPortraitUi,
  phone,
  quietSettings,
} from './portraitHelpers.js';

const ROUTE = '?devScene=nodemap&preset=fresh&descent=1&difficulty=hard&descentRow=4&seed=42';

async function openRoute(page, { rite = 7, query = '', mobile = false } = {}) {
  await page.goto(`/${ROUTE}&rite=${rite}${query}${mobile ? '&mobilePreview=1' : ''}`);
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible' });
  await skip.click();
  const route = page.locator('.re-node-map');
  await expect(route).toBeVisible();
  await expect(route.locator('.re-node.is-live').first()).toBeVisible();
  return route;
}

/** The node of the Descent's route with this key, selected in the loom (the real selection). */
const selectNode = (page, key) =>
  page.evaluate((key) => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const node = scene.runManager.nodeMap.nodes.find((n) => n.descentKey === key);
    scene.nodeView._select(node.id);
    return node.id;
  }, key);

const cardText = (route) => route.locator('.re-loom-card .re-loom-rite');

for (const size of [
  { name: 'desktop 640x480', viewport: { width: 640, height: 480 }, mobile: false },
  { name: 'phone 844x390', viewport: { width: 844, height: 390 }, mobile: true },
]) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport });

    test('the Rite chip: words and tier, a note with the way up and each boss, closed by a tap', async ({
      page,
    }) => {
      const errors = collectErrors(page);
      const route = await openRoute(page, { rite: 7, mobile: size.mobile });
      const chip = route.locator('.re-burden.re-rite');
      await expect(chip.locator('.re-burden-name')).toHaveText('The Rite');
      await expect(chip.locator('.re-burden-short')).toHaveText('7 words · Spoken');
      await expect(chip).toHaveAttribute('aria-expanded', 'false');
      const note = route.locator('.re-burden-note');
      await expect(note).toBeHidden();

      await chip.click();
      await expect(chip).toHaveAttribute('aria-expanded', 'true');
      await expect(note).toBeVisible();
      await expect(note.locator('.re-rite-progress')).toHaveText(
        'Spoken · 5 more words to Answered (12).',
      );
      // The Entity's road: the Lieutenant's gate, then the Entity; Spoken changes neither.
      await expect(note.locator('[data-rite-target]')).toHaveText([
        'The Lieutenant: No change',
        'The Entity: No change',
      ]);
      await expect(note.locator('.re-rite-from')).toHaveText('From: The Eclipse +7');
      // The note lies over the loom: the page does not move for it.
      await expectNoSidewaysScroll(page);
      await note.click();
      await expect(note).toBeHidden();
      await expect(chip).toHaveAttribute('aria-expanded', 'false');
      expect(errors).toEqual([]);
    });

    test('the gate and the finale preview what the tier does to that boss', async ({ page }) => {
      const route = await openRoute(page, { rite: 14, mobile: size.mobile });
      // The gate is where the party stands next; Answered gives the Lieutenant a stone and a wave.
      await selectNode(page, 'gate');
      const gate = cardText(route);
      await expect(gate).toHaveAttribute('data-rite', 'open');
      await expect(gate).toHaveAttribute('data-rite-target', 'lieutenant');
      await expect(gate.locator('.re-loom-rite-head')).toHaveText('The Rite · Answered · 14 words');
      await expect(gate.locator('.re-loom-rite-lines li')).toHaveText([
        'The Lieutenant carries 1 more Revival Stone',
        '2 Hollowed join him on turn 4',
      ]);
      await expect(gate.locator('.re-loom-rite-note')).toHaveText('Read when the battle begins.');
      // The Entity's card speaks of its splash and its waves, never of its life.
      await selectNode(page, 'entity');
      const entity = cardText(route);
      await expect(entity).toHaveAttribute('data-rite-target', 'entity');
      await expect(entity.locator('.re-loom-rite-lines li')).toHaveText([
        "The Entity's splash strikes 1 tile more",
        'Each of its waves brings 2 Hollowed',
      ]);
      await expect(entity).not.toContainText(/HP|Stone|hinge|rally/i);
      // A fight that is not a boss the Rite reads has no block.
      await selectNode(page, 'vigil');
      await expect(route.locator('.re-loom-card')).toBeVisible();
      await expect(cardText(route)).toHaveCount(0);
    });
  });
}

test('a locked battle previews its locked map, not the tier the words stand at now', async ({
  page,
}) => {
  const route = await openRoute(page, { rite: 14 });
  // The map is locked at Answered, as the battle's own generation locks it ...
  await page.evaluate(async () => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const rm = scene.runManager;
    const scout = await import('/src/engine/BattleScout.js');
    const node = rm.nodeMap.nodes.find((n) => n.descentKey === 'gate');
    const params = rm.getBattleParams(node);
    scout.applyGenerationFields(params, { deployCount: 6, isBoss: true });
    rm.lockBattleConfig(
      node.id,
      scout.generateSeededBattle(params, rm.gameData, params.battleSeed),
    );
    scene.nodeView.render();
    scene.nodeView._select(node.id);
  });
  const gate = cardText(route);
  await expect(gate).toHaveAttribute('data-rite', 'locked');
  await expect(gate.locator('.re-loom-rite-note')).toHaveText('Set for this battle.');
  const locked = await gate.locator('.re-loom-rite-lines li').allTextContents();
  expect(locked[0]).toBe('The Lieutenant carries 1 more Revival Stone');
  expect(locked[1]).toMatch(/^\d+ Hollowed join him on turn 4$/);
  // ... and the words fall to Broken afterwards: the chip follows them, the locked card does not.
  await page.evaluate(() => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    scene.runManager.rite = { ...scene.runManager.rite, words: 0 };
    scene.nodeView.render();
    scene.nodeView._select(scene.runManager.nodeMap.nodes.find((n) => n.descentKey === 'gate').id);
  });
  await expect(route.locator('.re-burden.re-rite .re-burden-short')).toHaveText('0 words · Broken');
  await expect(cardText(route).locator('.re-loom-rite-lines li')).toHaveText(locked);
});

test('an ordinary run has no Rite chip and no Rite block', async ({ page }) => {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible' });
  await skip.click();
  const route = page.locator('.re-node-map');
  await expect(route.locator('.re-node.is-live').first()).toBeVisible();
  await expect(route.locator('.re-rite')).toHaveCount(0);
  await expect(route.locator('.re-loom-rite')).toHaveCount(0);
  const hasRite = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.rite,
  );
  expect(hasRite).toBeNull();
});

test.describe('an upright phone', () => {
  test.use(phone({ width: 390, height: 844 }));

  test('the chip, its note and the card’s Rite block fit the screen', async ({ page }) => {
    await quietSettings(page);
    await page.addInitScript(() => {
      localStorage.setItem('emblem_rogue_portrait_battles', 'on');
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.classList.add('portrait-ui');
        const style = document.createElement('style');
        style.textContent = '#rotate-prompt{display:none!important}';
        document.head.append(style);
      });
    });
    const route = await openRoute(page, { rite: 14 });
    await expectPortraitUi(page);
    const chip = route.locator('.re-burden.re-rite');
    await expect(chip.locator('.re-burden-short')).toHaveText('14 words · Answered');
    await chip.tap();
    await expect(route.locator('.re-burden-note')).toBeVisible();
    await expectNoSidewaysScroll(page);
    // Inside the viewport, whole.
    const box = await route.locator('.re-burden-note').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 0.5);
    await chip.tap();
    await selectNode(page, 'gate');
    await expect(cardText(route)).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});

test.describe('the Vigil’s markers', () => {
  test('four sigils lit under their Voices and four open circles; a fallen Voice’s says so', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto(
      '/?devScene=battle&preset=battle_smoke&setPiece=the_vigil&act=5&difficulty=hard&seed=42',
    );
    await waitForGame(page);
    await waitForScene(page, 'Battle');
    const shown = () =>
      page.evaluate(() => {
        const ctrl = window.__emblemRogueGame.scene.getScene('Battle')._vigilCtrl;
        return ctrl
          ? {
              sigils: ctrl.shown.sigils.map((s) => `${s.id}:${s.state}`),
              circles: ctrl.shown.circles.map((c) => `${c.id}:${c.state}`),
            }
          : null;
      });
    await expect.poll(shown).toEqual({
      sigils: ['sigil_calling:lit', 'sigil_binding:lit', 'sigil_feeding:lit', 'sigil_waking:lit'],
      circles: [
        'circle_calling:open',
        'circle_binding:open',
        'circle_feeding:open',
        'circle_waking:open',
      ],
    });
    // A Voice that falls (the roster is the engine's: removing it as a kill would do) darkens its
    // sigil and closes its circle on the next frame; the others are untouched.
    await page.evaluate(() => {
      const scene = window.__emblemRogueGame.scene.getScene('Battle');
      const voice = scene.enemyUnits.find((u) => u.authoredId === 'voice_feeding');
      scene.removeUnitGraphic(voice);
      scene.enemyUnits.splice(scene.enemyUnits.indexOf(voice), 1);
    });
    await expect.poll(shown).toMatchObject({
      sigils: expect.arrayContaining(['sigil_feeding:silent', 'sigil_calling:lit']),
      circles: expect.arrayContaining(['circle_feeding:closed', 'circle_waking:open']),
    });
    expect(errors).toEqual([]);
  });
});
