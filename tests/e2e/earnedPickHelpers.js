// The act boss's earned-blessing pick in the browser (docs/specs/blessings-v3.md §6.4), shared by
// earned-blessing-pick.spec.js (landscape phone, run-flow lane) and
// portrait-earned-pick.spec.js (upright phone, portrait lane). Every wait is on state (the
// dialogs, the scene, the slot's save), never on time.
import { expect } from '@playwright/test';
import { attachSlot, quietSettings } from './portraitHelpers.js';
import { waitForScene } from './helpers.js';

export const PICK = 'An earned blessing';

/** The slot's saved run, with the act it stands in (`currentAct`, from `actIndex`). */
export const savedRun = (page) =>
  page.evaluate(() => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
    return run ? { ...run, currentAct: run.actSequence?.[run.actIndex] ?? null } : null;
  });

export const frames = (page, n = 2) =>
  page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
        step(n);
      }),
    n,
  );

/** Tap the middle of the screen (a card or a line skips on a tap). */
export function tapMiddle(page) {
  const { width, height } = page.viewportSize();
  return page.touchscreen.tap(Math.round(width / 2), Math.round(height / 2));
}

/** Whatever card or line is up: tap it away, like a player. */
async function dismiss(page) {
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  if (await next.count()) await next.first().tap();
  else await tapMiddle(page);
  await frames(page, 6);
}

/** The pick's cards, as the ids they show. */
export const pickIds = (dialog) =>
  dialog.locator('.ch-card').evaluateAll((cards) => cards.map((c) => c.dataset.blessing));

/**
 * Act I's boss, won like a player up to the pick: the boss card cleared, the victory band
 * skipped, the story and deed cards tapped away, the boss recruit skipped and the reward
 * claimed (its gold). Returns the pick dialog and what the victory save held.
 */
export async function winBossToPick(page, { mobilePreview = true } = {}) {
  await quietSettings(page, { battleSpeed: 'fast' });
  await page.goto(
    `/?devScene=battle&devNode=boss&seed=42${mobilePreview ? '&mobilePreview=1' : ''}`,
  );
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
    timeout: 90_000,
  });
  await attachSlot(page);
  while (await page.locator('.ce-layer').count()) await dismiss(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    for (const e of s.enemyUnits) e.currentHP = 0;
    s.onVictory();
  });
  await page.waitForSelector('.ce-band-layer--victory');
  // The pick is rolled and saved with the victory, before anything is shown.
  const atVictory = (await savedRun(page)).earnedBlessingPicks?.act1 || null;
  await tapMiddle(page);
  const recruit = page.getByRole('dialog', { name: 'Boss recruit', exact: true });
  while (!(await recruit.isVisible())) await dismiss(page);
  await recruit.getByRole('button', { name: 'Skip recruit', exact: true }).tap();

  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible({ timeout: 30_000 });
  const pick = page.getByRole('dialog', { name: PICK, exact: true });
  // Not before the reward is claimed.
  await expect(pick).toHaveCount(0);
  const gold = rewards.locator('.reward-card').last(); // "Take N gold instead"
  await expect(async () => {
    await gold.tap();
    await expect(gold).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await rewards.getByRole('button', { name: 'Take gold', exact: true }).tap();
  await expect(pick).toBeVisible({ timeout: 30_000 });
  return { pick, atVictory };
}

/** Close the game and come back through the slot to the route map. */
export async function reloadToRouteMap(page) {
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  const slots = page.getByRole('button', { name: 'Save Slots', exact: true });
  await expect(slots).toBeEnabled();
  await slots.tap();
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  if (await skip.isVisible()) await skip.tap();
  // Ready: the map is drawn (an owed pick opens over it and hides it, so readiness is the state).
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('NodeMap')?.isSceneReady === true,
      ),
    )
    .toBe(true);
}

/** Tap away the act card and its lines until the route map is the scene. */
export async function playOnToRouteMap(page) {
  await expect(async () => {
    if ((await page.evaluate(() => window.__sceneState?.activeScene)) !== 'NodeMap')
      await dismiss(page);
    expect(await page.evaluate(() => window.__sceneState?.activeScene)).toBe('NodeMap');
  }).toPass({ timeout: 60_000 });
}

/** The pause list's held blessings, as the route map shows them. */
export async function pauseBlessingNames(page) {
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').showPauseMenu());
  const list = page.getByRole('list', { name: 'Blessings', exact: true });
  await expect(list).toBeVisible();
  return list.locator('li > strong').allTextContents();
}
