import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';
import {
  SHOTS,
  expectDistinctFighters,
  openRosterWithTwoFighters,
  servicesShowFaces,
} from './portraitVariety.helpers.js';

// Portrait variety (src/engine/PortraitVariants.js) on desktop; the phone
// roster is portrait-variety-mobile.spec.js.
test.use({ viewport: { width: 1280, height: 800 } });
test('two Fighters in the roster wear different faces', async ({ page }) => {
  const { faces } = await openRosterWithTwoFighters(page);
  await expectDistinctFighters(page, faces);
  await page.screenshot({ path: `${SHOTS}/roster-1280x800.png` });
});

test('every unit on a battle map has its face; canvas faces load lazily', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').enemyUnits?.length > 0,
  );
  const state = await page.evaluate(async () => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const { portraitIdForUnit, isVariantPortrait } = await import('/src/ui/portraitArt.js');
    const units = [...b.playerUnits, ...b.enemyUnits, ...(b.npcUnits || [])];
    const generic = units.filter((u) => !u.isLord && !u.isBoss);
    const ids = generic.map((u) => portraitIdForUnit(u, b.gameData));
    const variants = ids.filter((id) => isVariantPortrait(id));
    // Warmed forecast faces (40 px) for every variant on the field.
    await new Promise((r) => setTimeout(r, 500));
    const keys = b.textures.getTextureKeys().filter((k) => k.startsWith('pc98v-'));
    return {
      missing: generic.filter((u) => !u.portraitVariant).map((u) => u.name),
      variants: [...new Set(variants)],
      warmed: keys,
    };
  });
  expect(state.missing).toEqual([]);
  for (const id of state.variants) expect(state.warmed).toContain(`pc98v-40-${id}`);
});

test('service lists show the same faces (colosseum)', async ({ page }) => {
  test.setTimeout(90000);
  await servicesShowFaces(page, '1280x800');
});
