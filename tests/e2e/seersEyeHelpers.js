// Seer's Eye in the browser (docs/specs/blessings-v3.md §6.7): the dev route map with the card held
// and a fogged battle in reach. Shared by seers-eye-preview.spec.js (a landscape phone) and
// portrait-seers-eye.spec.js (upright, the portrait lane). Every wait is on state.
import { expect } from '@playwright/test';
import { attachSlot, quietSettings } from './portraitHelpers.js';
import { waitForGame, waitForScene } from './helpers.js';

/** The dev route map, with Seer's Eye held and the first reachable node a fogged battle. */
export async function routeWithTheEye(page) {
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

/** The route map's inspect card, and its scout panel. */
export const loomCard = (page) => page.locator('.re-loom-card');
export const scoutPanel = (page) => loomCard(page).locator('.re-loom-scout');
