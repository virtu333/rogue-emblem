// The prologue always has a way out: the coach's Leave, the pause menu's Leave Prologue
// (phone and desktop) and, for a player with no saves yet, Start First Run. A fallen
// commander never ends anything: the chapter restarts from its start.
import { test, expect } from '@playwright/test';
import { waitForScene as waitForSceneQuick } from './helpers.js';

test.setTimeout(150000);

// Asset loading can be slow on a busy machine: allow a full minute per scene.
async function waitForScene(page, key) {
  try {
    await waitForSceneQuick(page, key);
  } catch {
    await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, {
      timeout: 60000,
    });
  }
}

async function openPrologue(browser, { phone }) {
  const context = await browser.newContext(
    phone
      ? {
          viewport: { width: 844, height: 390 },
          hasTouch: true,
          isMobile: true,
          deviceScaleFactor: 2,
        }
      : { viewport: { width: 1280, height: 800 } },
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, reduceMotion: true }),
    ),
  );
  await page.goto(phone ? '/?mobilePreview=1&battleLab=1' : '/');
  await waitForScene(page, 'Title');
  const prologue = page.getByRole('button', { name: /^Prologue/ });
  if (phone) await prologue.tap();
  else await prologue.click();
  await waitForScene(page, 'Battle');
  const coach = page.getByRole('region', { name: 'Prologue guide', exact: true });
  await expect(coach).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.battleState === 'PLAYER_IDLE' && s._prologue?.gate?.kind === 'select';
  });
  return { context, page, errors, coach };
}

test('phone: the coach Leave confirms, then returns to the title with nothing saved', async ({
  browser,
}) => {
  const { context, page, errors, coach } = await openPrologue(browser, { phone: true });
  const leave = coach.getByRole('button', { name: 'Leave prologue', exact: true });
  const box = await leave.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await leave.tap();
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toContainText('Leave the prologue?');
  // Cancel is the safe default and backs out to the battle.
  await expect(pause.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await pause.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(pause.getByRole('button', { name: 'Leave Prologue', exact: true })).toBeVisible();
  await expect(pause).toContainText('Banner at Dawn');
  await expect(pause).toContainText('nothing here is saved');
  await pause.getByRole('button', { name: 'Leave Prologue', exact: true }).tap();
  await pause.getByRole('button', { name: 'Leave prologue', exact: true }).tap();
  await waitForScene(page, 'Title');
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => /^emblem_rogue_slot_\d_(meta|run)$/.test(k)),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

test('phone: a fresh player can start the first run straight from the prologue pause', async ({
  browser,
}) => {
  const { context, page, errors } = await openPrologue(browser, { phone: true });
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Menu', exact: true })
    .tap();
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await pause.getByRole('button', { name: 'Start First Run', exact: true }).tap();
  await expect(pause).toContainText('Start your first run now?');
  await pause.getByRole('button', { name: 'Start run', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_meta') !== null)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await context.close();
});

test('desktop: Esc pauses the prologue and Leave Prologue returns to the title', async ({
  browser,
}) => {
  const { context, page, errors, coach } = await openPrologue(browser, { phone: false });
  await expect(coach.getByRole('button', { name: 'Leave prologue', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Start First Run', exact: true })).toBeVisible();
  await pause.getByRole('button', { name: 'Leave Prologue', exact: true }).click();
  await pause.getByRole('button', { name: 'Leave prologue', exact: true }).click();
  await waitForScene(page, 'Title');
  expect(errors).toEqual([]);
  await context.close();
});

test("desktop: the commander's fall plays the unnamed line and restarts the chapter, never a defeat", async ({
  browser,
}) => {
  const { context, page, errors, coach } = await openPrologue(browser, { phone: false });
  const before = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits[0];
    return { hp: edric.currentHP, col: edric.col, row: edric.row, grid: Boolean(s.grid) };
  });
  await page.evaluate(() => {
    window.__battleGridMark = window.__emblemRogueGame.scene.getScene('Battle').grid;
  });
  // Edric falls to the near Fighter (the real death funnel, then the battle-end check).
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits[0];
    edric.currentHP = 0;
    await s.removeUnit(edric, { killer: s.enemyUnits[0] });
    s.checkBattleEnd();
  });
  const line = page.getByRole('dialog', { name: '???', exact: true });
  await expect(line).toContainText('Not this thread.');
  // Still the same battle scene, and never a defeat screen, prompt or run end.
  expect(await page.evaluate(() => window.__sceneState?.activeScene)).toBe('Battle');
  await line.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(line).toContainText('Stand again where the morning found you.');
  await line.getByRole('button', { name: 'Continue', exact: true }).click();
  // The chapter restarts from its start: a fresh Edric on his spawn, the first step gated.
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return (
      window.__sceneState?.activeScene === 'Battle' &&
      s.grid !== window.__battleGridMark &&
      s.battleState === 'PLAYER_IDLE' &&
      s._prologue?.gate?.kind === 'select' &&
      s.playerUnits.length === 1
    );
  });
  const after = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits[0];
    return {
      hp: edric.currentHP,
      col: edric.col,
      row: edric.row,
      enemies: s.enemyUnits.length,
      transitions: (window.__sceneState?.transitionAudits || []).map((a) => a.to),
    };
  });
  expect(before.grid).toBe(true);
  expect(after).toMatchObject({ hp: before.hp, col: before.col, row: before.row, enemies: 2 });
  expect(after.transitions).not.toContain('RunComplete');
  await expect(coach.locator('.re-coach-goal')).toHaveText('Select Edric');
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => /^emblem_rogue_slot_\d_(meta|run)$/.test(k)),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

test('desktop: Leave from a field note opens the pause confirmation', async ({ browser }) => {
  const { context, page, errors } = await openPrologue(browser, { phone: false });
  await page.evaluate(() => {
    void window.__emblemRogueGame.scene.getScene('Battle')._prologue.fieldNote('A note.');
  });
  const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
  await expect(note).toContainText('A note.');
  await note.getByRole('button', { name: 'Leave prologue', exact: true }).click();
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toContainText('Leave the prologue?');
  await pause.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(pause.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
