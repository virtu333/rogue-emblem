// E2E: a whole journey through the real menus, starting from "/" with no dev shortcuts.
//
//   Title -New Game-> NodeMap (first-run fast path) -> Battle -Abandon-> Title
//   -Save Slots-> SlotPicker -Slot 1-> HomeBase -Begin Run-> DifficultySelect
//   -> BlessingSelect -> NodeMap -> Battle -Save & Return-> Title
//
// A brand-new save skips Home Base, Difficulty and Blessing (#44, firstRunFastPath);
// the same slot's second run, after the first was abandoned, goes through all three.

import { test, expect } from '@playwright/test';
import {
  waitForGame,
  waitForScene,
  getSceneState,
  assertNoInvariantErrors,
  collectErrors,
  attachSceneCrashArtifacts,
} from './helpers.js';

function installSaveStateReset(page) {
  return page.addInitScript(() => {
    const directKeys = new Set([
      'emblem_rogue_active_slot',
      'emblem_rogue_meta_save',
      'emblem_rogue_run_save',
      'emblem_rogue_tutorial_completed',
    ]);
    const prefixes = ['emblem_rogue_slot_', 'emblem_rogue_hints_slot_'];
    for (const key of Object.keys(localStorage)) {
      if (directKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
    // Helpers off: this journey is about the scene flow. First-run field notes open
    // on their own delay (a modal one in battle) and would race the key presses.
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, guidance: 'off' }),
    );
  });
}

const sceneHistory = async (page) => (await getSceneState(page)).history.map((entry) => entry.to);

function expectInOrder(history, expected) {
  let cursor = 0;
  for (const scene of expected) {
    const foundAt = history.indexOf(scene, cursor);
    expect(foundAt, `${scene} after position ${cursor} in ${history.join(' > ')}`).toBeGreaterThan(
      -1,
    );
    cursor = foundAt + 1;
  }
}

/** Get past the route map's story conversation and field notes (if any). */
async function readyRoute(page) {
  const route = page.locator('.re-node-map');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  const notes = page.getByRole('dialog', { name: 'Field notes', exact: true });
  for (let i = 0; i < 8 && !(await route.isVisible()); i++) {
    await expect(route.or(skip).or(notes).filter({ visible: true }).first()).toBeVisible();
    if (await skip.isVisible()) await skip.click();
    else if (await notes.isVisible())
      await notes.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(route).toBeVisible();
  await page.waitForFunction(() => window.__sceneState?.nodeMap?.state === 'IDLE');
}

/** Choose the first reachable battle node on the route and travel to it. */
async function travelToBattle(page) {
  const nodeId = await page.evaluate(() => {
    const nodeMap = window.__emblemRogueGame.scene.getScene('NodeMap');
    return nodeMap.runManager.getAvailableNodes().find((node) => node.type === 'battle')?.id;
  });
  expect(nodeId).toBeTruthy();
  const node = page.locator(`.re-node-map [data-node="${nodeId}"]`);
  await node.click();
  await expect(node).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Travel', exact: true }).click();
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
    null,
    { timeout: 30_000 },
  );
  const deploy = page.getByRole('dialog', { name: 'Deploy units', exact: true });
  if (await deploy.isVisible())
    await deploy.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
    timeout: 30_000,
  });
}

async function openPause(page) {
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toBeVisible();
  return pause;
}

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

test('journey: first run from Title, abandon, then a full second run and Save & Return', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await installSaveStateReset(page);

  await page.goto('/');
  await waitForGame(page);
  await waitForScene(page, 'Title');

  // First run: a brand-new save goes straight to the route map.
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await waitForScene(page, 'NodeMap');
  const firstRun = await sceneHistory(page);
  const titleAt = firstRun.lastIndexOf('Title');
  expect(firstRun.slice(titleAt)).toEqual(['Title', 'NodeMap']);
  await readyRoute(page);
  await travelToBattle(page);

  // Abandon it: the run ends and the game returns to the title.
  let pause = await openPause(page);
  await pause.getByRole('button', { name: 'Abandon Run', exact: true }).click();
  await pause.getByRole('button', { name: 'Abandon run', exact: true }).click();
  await waitForScene(page, 'Title');

  // Second run in the same slot: Home Base, Difficulty and Blessing come first.
  await page.getByRole('button', { name: 'Save Slots', exact: true }).click();
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).click();
  await waitForScene(page, 'HomeBase');
  await page.getByRole('button', { name: 'Begin Run', exact: true }).click();
  await waitForScene(page, 'DifficultySelect');
  const difficulty = page.getByRole('dialog', { name: 'Choose difficulty' });
  await difficulty.getByRole('button', { name: 'Confirm', exact: true }).click();
  await waitForScene(page, 'BlessingSelect');
  const blessing = page.getByRole('dialog', { name: 'Choose a blessing' });
  await blessing.getByRole('button', { name: 'No blessing', exact: true }).click();
  await blessing.getByRole('button', { name: 'Confirm', exact: true }).click();
  await waitForScene(page, 'NodeMap');
  await readyRoute(page);
  await travelToBattle(page);

  pause = await openPause(page);
  await pause.getByRole('button', { name: 'Save & Return to Title', exact: true }).click();
  await pause.getByRole('button', { name: 'Save & return', exact: true }).click();
  await waitForScene(page, 'Title');

  expectInOrder(await sceneHistory(page), [
    'Title',
    'NodeMap',
    'Battle',
    'Title',
    'SlotPicker',
    'HomeBase',
    'DifficultySelect',
    'BlessingSelect',
    'NodeMap',
    'Battle',
    'Title',
  ]);
  // The suspended second run is what Title now offers to resume.
  await expect(page.getByRole('button', { name: /^Resume · Act 1/ })).toBeVisible();
  await assertNoInvariantErrors(page);
  expect(errors).toEqual([]);
});
