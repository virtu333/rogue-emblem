// Shared by the Rite's route-map specs (descent-rite.spec.js, portrait-descent-rite.spec.js): the
// review route, opening it past the cold open, selecting a Descent node, and the Rite's tier
// thresholds. The thresholds are the data's (`descent.json` rite.bands), read here and never
// typed: they are tuned apart from the UI, and a word count is chosen relative to a band's `min`.
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

export const ROUTE =
  '?devScene=nodemap&preset=fresh&descent=1&difficulty=hard&descentRow=4&seed=42';

const bands = JSON.parse(readFileSync('data/descent.json', 'utf8')).rite.bands;
const bandMin = (id) => bands.find((b) => b.id === id).min;
export const SPOKEN = bandMin('spoken');
export const ANSWERED = bandMin('answered');
/** Words well inside Spoken and inside Answered, whatever the thresholds are. */
export const IN_SPOKEN = SPOKEN + 2;
export const IN_ANSWERED = ANSWERED + 2;

export async function openRoute(page, { rite = IN_SPOKEN, query = '', mobile = false } = {}) {
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
export const selectNode = (page, key) =>
  page.evaluate((key) => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const node = scene.runManager.nodeMap.nodes.find((n) => n.descentKey === key);
    scene.nodeView._select(node.id);
    return node.id;
  }, key);
