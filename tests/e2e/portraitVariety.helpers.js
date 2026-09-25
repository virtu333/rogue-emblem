import { expect } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

// Portrait variety (src/engine/PortraitVariants.js): two recruits of the same
// class wear different faces in the roster, on a phone and on desktop; every
// unit on a battle map has its face before anything shows it.
export const SHOTS = 'docs/art-direction/portraits-variety';

export async function openRosterWithTwoFighters(page) {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  // The act's opening conversation may be up; skip it when it appears.
  const talking = await page
    .waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay?.visible,
      null,
      { timeout: 4000 },
    )
    .then(() => true)
    .catch(() => false);
  if (talking) await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
  await page.waitForFunction(
    () => !window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay?.visible,
  );
  const faces = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1); // saves succeed (no storage toast in captures)
    const { createUnit } = await import('/src/engine/UnitManager.js');
    const fighter = s.gameData.classes.find((c) => c.name === 'Fighter');
    // The playtest pair: two Fighters recruited in one run.
    const pair = ['Bram', 'Roderick'].map((name) =>
      createUnit(fighter, 4, s.gameData.weapons, { name }),
    );
    s.runManager.assignPortraitVariants(pair);
    s.runManager.roster.push(...pair);
    s._openRoster();
    return pair.map((u) => u.portraitVariant);
  });
  const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await expect(sheet).toBeVisible();
  return { sheet, faces };
}

export async function listFaces(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.mr-units button')].map((b) => {
      const img = b.querySelector('img.mr-unit-face');
      return {
        name: b.textContent.trim(),
        id: img?.dataset.portraitId || null,
        loaded: Boolean(img?.complete && img.naturalWidth > 0),
        w: img?.naturalWidth || 0,
      };
    }),
  );
}

export async function expectDistinctFighters(page, faces) {
  expect(faces[0]).not.toBe(faces[1]);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('img.mr-unit-face')].every((i) => i.complete),
  );
  const rows = await listFaces(page);
  const bram = rows.find((r) => r.name.includes('Bram'));
  const roderick = rows.find((r) => r.name.includes('Roderick'));
  expect(bram?.id).toBeTruthy();
  expect(roderick?.id).toBeTruthy();
  expect(bram.id).not.toBe(roderick.id);
  expect(bram.id).toMatch(/^generic_fighter/);
  expect(roderick.id).toMatch(/^generic_fighter/);
  expect(bram.loaded && roderick.loaded).toBe(true);
  expect(bram.w).toBe(32); // list faces ship at their display size
  return rows;
}

/** Colosseum merc board and church lists show each unit's face; screenshots per viewport. */
export async function servicesShowFaces(page, suffix) {
  await openRosterWithTwoFighters(page);
  await page
    .getByRole('dialog', { name: 'Manage roster', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.runManager.gold = 10000;
    const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
    window.arena = new ColosseumOverlay(s, s.runManager, s.gameData);
    window.arena.show(s.runManager.getAvailableNodes()[0], () => {});
  });
  await page.getByRole('button', { name: 'Mercenary board', exact: true }).click();
  const merc = page.getByRole('dialog', { name: 'Mercenary board', exact: true });
  const rows = merc.locator('.re-menu-body button.has-face');
  await expect(rows.first()).toBeVisible();
  const ids = await rows.evaluateAll((bs) =>
    bs.map((b) => b.querySelector('img.mr-unit-face')?.dataset.portraitId || null),
  );
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length); // offered together, never twins
  await page.waitForFunction(() =>
    [...document.querySelectorAll('img.mr-unit-face')].every((i) => i.complete),
  );
  await page.screenshot({ path: `${SHOTS}/merc-board-${suffix}.png` });
  await merc.getByRole('button', { name: 'Back', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Colosseum', exact: true })
    .getByRole('button', { name: 'Arena', exact: true })
    .click();
  const fighters = page.getByRole('dialog', { name: 'Arena · Choose fighter', exact: true });
  await expect(fighters.locator('button.has-face', { hasText: 'Roderick' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/arena-fighters-${suffix}.png` });
}
