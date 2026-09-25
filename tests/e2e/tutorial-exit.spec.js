// The tutorial always has a way out: the coach's Leave, the pause menu's Leave Tutorial
// (phone and desktop) and, for a player with no saves yet, Start First Run.
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

async function openTutorial(browser, { phone }) {
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
  const tutorial = page.getByRole('button', { name: /^Tutorial/ });
  if (phone) await tutorial.tap();
  else await tutorial.click();
  await waitForScene(page, 'Battle');
  const coach = page.getByRole('region', { name: 'Tutorial guide', exact: true });
  await expect(coach).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  return { context, page, errors, coach };
}

test('phone: the coach Leave confirms, then returns to the title with nothing saved', async ({
  browser,
}) => {
  const { context, page, errors, coach } = await openTutorial(browser, { phone: true });
  const leave = coach.getByRole('button', { name: 'Leave tutorial', exact: true });
  const box = await leave.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await leave.tap();
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toContainText('Leave the tutorial?');
  // Cancel is the safe default and backs out to the battle.
  await expect(pause.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await pause.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(pause.getByRole('button', { name: 'Leave Tutorial', exact: true })).toBeVisible();
  await expect(pause).toContainText('practice battle');
  await pause.getByRole('button', { name: 'Leave Tutorial', exact: true }).tap();
  await pause.getByRole('button', { name: 'Leave tutorial', exact: true }).tap();
  await waitForScene(page, 'Title');
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => /^emblem_rogue_slot_\d_(meta|run)$/.test(k)),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

test('phone: a fresh player can start the first run straight from the tutorial pause', async ({
  browser,
}) => {
  const { context, page, errors } = await openTutorial(browser, { phone: true });
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

test('desktop: Esc pauses the tutorial and Leave Tutorial returns to the title', async ({
  browser,
}) => {
  const { context, page, errors, coach } = await openTutorial(browser, { phone: false });
  await expect(coach.getByRole('button', { name: 'Leave tutorial', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Start First Run', exact: true })).toBeVisible();
  await pause.getByRole('button', { name: 'Leave Tutorial', exact: true }).click();
  await pause.getByRole('button', { name: 'Leave tutorial', exact: true }).click();
  await waitForScene(page, 'Title');
  expect(errors).toEqual([]);
  await context.close();
});
