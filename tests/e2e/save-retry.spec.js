import { test, expect, devices } from '@playwright/test';
import { openDevBattle, quietSettings } from './portraitHelpers.js';

async function fixture(page) {
  await quietSettings(page);
  await openDevBattle(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s._captureSuspendCheckpoint({ session: s._battleSession });
    window.__retryOldSave = localStorage.getItem('emblem_rogue_slot_1_run');
    window.__retryWrite = Storage.prototype.setItem;
    window.__retryFail = true;
    Storage.prototype.setItem = function (key, value) {
      if (window.__retryFail && /^emblem_rogue_slot_\d+_run/.test(key))
        throw new DOMException('Injected quota', 'QuotaExceededError');
      return window.__retryWrite.call(this, key, value);
    };
    s.playerUnits[0].currentHP = 9;
    s._captureSuspendCheckpoint({ session: s._battleSession });
  });
  await expect(page.locator('[data-save-retry="action"]')).toBeVisible();
}
async function withinViewport(page, selector) {
  const bounds = await page.locator(selector).evaluate((node) => {
    const r = node.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: innerWidth,
      height: innerHeight,
    };
  });
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
}

test('640x480 Retry is modal, keyboard navigable and writes the frozen checkpoint', async ({
  page,
}) => {
  await fixture(page);
  await withinViewport(page, '[data-save-retry="action"]');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-save-retry="action"]')).toBeVisible();
  const retry = page.locator('[data-save-retry-action="retry"]');
  await expect(retry).toBeFocused();
  await page.evaluate(async () => {
    const { dispatchInputAction } = await import('/src/utils/inputFocus.js');
    const { InputAction } = await import('/src/utils/InputActions.js');
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
  });
  await expect(page.locator('[data-save-retry-action="keep"]')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Still not saved. Tries: 1', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => localStorage.getItem('emblem_rogue_slot_1_run') === window.__retryOldSave,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    window.__retryFail = false;
  });
  await page.locator('[data-save-retry-action="retry"]').click();
  await expect(page.locator('[data-save-retry="action"]')).toHaveCount(0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')),
  );
  expect(saved.battleInProgress.checkpoint.playerUnits[0].currentHP).toBe(9);
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').isStoryInputLocked(),
    ),
  ).toBe(false);
});

test('Save & Exit flushes then offers Stay or an explicit unsaved exit', async ({ page }) => {
  await fixture(page);
  await page.locator('[data-save-retry-action="keep"]').click();
  await expect(page.locator('.battle-save-status')).toHaveText('Not saved');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.showPauseMenu();
    s.pauseOverlay.hideForTransition();
    window.__retryExit = s.pauseOverlay.onSaveAndExit();
  });
  await expect(page.locator('[data-save-retry="exit"]')).toBeVisible();
  await page.locator('[data-save-retry-action="stay"]').click();
  await page.evaluate(() => window.__retryExit);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').battleState),
  ).toBe('PLAYER_IDLE');
  await expect(page.locator('.battle-save-status')).toHaveText('Not saved');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.showPauseMenu();
    s.pauseOverlay.hideForTransition();
    window.__retryExit = s.pauseOverlay.onSaveAndExit();
  });
  await expect(page.locator('[data-save-retry="exit"]')).toBeVisible();
  await page.locator('[data-save-retry-action="exit"]').click();
  await page.evaluate(() => window.__retryExit);
  await expect(page.locator('.re-title')).toBeVisible();
  expect(
    await page.evaluate(
      () => localStorage.getItem('emblem_rogue_slot_1_run') === window.__retryOldSave,
    ),
  ).toBe(true);
});

for (const viewport of [
  { width: 844, height: 390 },
  { width: 390, height: 844 },
]) {
  test(`phone ${viewport.width}x${viewport.height} dialog and pill fit and hide the HUD`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport });
    const page = await context.newPage();
    await fixture(page);
    await withinViewport(page, '[data-save-retry="action"]');
    await expect(page.locator('.mobile-battle-hud')).toBeHidden();
    await page.locator('[data-save-retry-action="keep"]').click();
    await expect(page.locator('.battle-save-status')).toHaveText('Not saved');
    await withinViewport(page, '.battle-save-status');
    await page.evaluate(() => {
      window.__retryFail = false;
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s._captureSuspendCheckpoint({ session: s._battleSession });
    });
    await expect(page.locator('.battle-save-status')).toHaveText('Battle saved.');
    await context.close();
  });
}

test('enemy phase remains at its saved boundary until Keep playing, then recovers', async ({
  page,
}) => {
  await fixture(page);
  await page.locator('[data-save-retry-action="keep"]').click();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    window.__retryFail = false;
    s._captureSuspendCheckpoint({ session: s._battleSession });
    window.__retryFail = true;
    s.forceEndTurn();
    window.__retryHeld = JSON.stringify({
      units: [...s.playerUnits, ...s.enemyUnits].map((u) => [u.col, u.row, u.currentHP]),
      rng: s._battleRng.getState(),
    });
  });
  await expect(page.locator('[data-save-retry="action"]')).toBeVisible();
  await page.waitForTimeout(1800); // The real enemy-banner delay has elapsed.
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return (
        JSON.stringify({
          units: [...s.playerUnits, ...s.enemyUnits].map((u) => [u.col, u.row, u.currentHP]),
          rng: s._battleRng.getState(),
        }) === window.__retryHeld
      );
    }),
  ).toBe(true);
  await page.locator('[data-save-retry-action="keep"]').click();
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.turnManager.turnNumber === 2 && s.battleState === 'PLAYER_IDLE';
  });
  await expect(page.locator('.battle-save-status')).toHaveText('Not saved');
  await page.evaluate(() => {
    window.__retryFail = false;
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s._captureSuspendCheckpoint({ session: s._battleSession });
  });
  await expect(page.locator('.battle-save-status')).toHaveText('Battle saved.');
});

test('refresh while the dialog is open resumes the last durable checkpoint', async ({ page }) => {
  await fixture(page);
  const oldHP = await page.evaluate(
    () => JSON.parse(window.__retryOldSave).battleInProgress.checkpoint.playerUnits[0].currentHP,
  );
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await expect(page.locator('.re-title')).toBeVisible();
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Save Slots', exact: true }).click();
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).click();
  await page.getByRole('button', { name: 'Resume Battle', exact: true }).click();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
  );
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].currentHP,
    ),
  ).toBe(oldHP);
  await expect(page.locator('[data-save-retry]')).toHaveCount(0);
});

test('a rejected exit Retry returns to the battle, and an absent candidate has no Retry button', async ({
  page,
}) => {
  await fixture(page);
  await page.locator('[data-save-retry-action="keep"]').click();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.showPauseMenu();
    s.pauseOverlay.hideForTransition();
    window.__retryExit = s.pauseOverlay.onSaveAndExit();
  });
  await expect(page.locator('[data-save-retry="exit"]')).toBeVisible();
  await page.evaluate(() => {
    window.__emblemRogueGame.scene.getScene('Battle')._battleSuspendController.dropRetryCandidate();
  });
  await page.locator('[data-save-retry-action="retry"]').click();
  await page.evaluate(() => window.__retryExit);
  await expect(page.locator('[data-save-retry="exit"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').battleState),
  ).toBe('PLAYER_IDLE');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.showPauseMenu();
    s.pauseOverlay.hideForTransition();
    window.__retryExit = s.pauseOverlay.onSaveAndExit();
  });
  await expect(page.locator('[data-save-retry="exit"]')).toBeVisible();
  await expect(page.locator('[data-save-retry-action="retry"]')).toHaveCount(0);
  await page.locator('[data-save-retry-action="stay"]').click();
  await page.evaluate(() => window.__retryExit);
});

test('a real consumable action survives quota, Retry and Save & Exit without repeating its heal or cost', async ({
  page,
}) => {
  await quietSettings(page);
  await openDevBattle(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const actor = s.playerUnits[0];
    const item = { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3 };
    actor.currentHP = 1;
    actor.consumables = [item];
    actor.skills = []; // Ordinary completion, with no extra Canto choice.
    s.updateHPBar(actor);
    s._captureSuspendCheckpoint({ session: s._battleSession });
    window.__retryOldSave = localStorage.getItem('emblem_rogue_slot_1_run');
    window.__retryWrite = Storage.prototype.setItem;
    window.__retryFail = true;
    Storage.prototype.setItem = function (key, value) {
      if (window.__retryFail && /^emblem_rogue_slot_\d+_run/.test(key))
        throw new DOMException('Injected action quota', 'QuotaExceededError');
      return window.__retryWrite.call(this, key, value);
    };
    window.__retryAction = s.useConsumable(actor, item);
    window.__retryActionState = {
      hp: actor.currentHP,
      uses: item.uses,
      xp: actor.xp,
      rng: s._battleRng.getState(),
    };
  });
  await expect(page.locator('[data-save-retry="action"]')).toBeVisible();
  expect(await page.evaluate(() => window.__retryActionState)).toMatchObject({ hp: 11, uses: 2 });
  expect(
    await page.evaluate(
      () => localStorage.getItem('emblem_rogue_slot_1_run') === window.__retryOldSave,
    ),
  ).toBe(true);
  await page.locator('[data-save-retry-action="retry"]').click();
  await expect(page.getByText('Still not saved. Tries: 1', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__retryFail = false;
  });
  await page.locator('[data-save-retry-action="retry"]').click();
  await page.evaluate(() => window.__retryAction);
  const result = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const actor = s.playerUnits[0];
    return {
      hp: actor.currentHP,
      uses: actor.consumables[0].uses,
      xp: actor.xp,
      rng: s._battleRng.getState(),
      acted: actor.hasActed,
    };
  });
  expect(result).toEqual({
    ...(await page.evaluate(() => window.__retryActionState)),
    acted: true,
  });
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.showPauseMenu();
    s.pauseOverlay.hideForTransition();
    window.__retryExit = s.pauseOverlay.onSaveAndExit();
  });
  await page.evaluate(() => window.__retryExit);
  await expect(page.locator('.re-title')).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')),
  );
  expect(saved.battleInProgress.checkpoint.playerUnits[0]).toMatchObject({
    currentHP: 11,
    hasActed: true,
    consumables: [expect.objectContaining({ uses: 2 })],
  });
});
