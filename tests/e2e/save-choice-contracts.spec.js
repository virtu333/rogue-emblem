import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';
test.use({
  ...devices['iPhone SE'],
  viewport: { width: 667, height: 375 },
});
test.setTimeout(60000);
async function fixture(page, conflict = false) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.evaluate(async (conflict) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, getRunKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = s.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    setActiveSlot(1);
    s.registry.set('activeSlot', 1);
    const run = s.runManager.toJSON();
    run.savedAt = Date.now();
    run.gold = 213;
    run.battleInProgress = null; // Resume this fixture at its node map.
    localStorage.setItem(getRunKey(1), JSON.stringify(run));
    if (conflict) {
      const { preserveCloudConflict } = await import('/src/engine/CloudSaveConflict.js');
      const cloud = { ...run, savedAt: run.savedAt + 1000, gold: 987 };
      preserveCloudConflict(1, run, cloud);
      localStorage.setItem(getRunKey(1), JSON.stringify(cloud));
    }
    const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
    await ensureSceneLoaded(s, 'Title');
    s.scene.start('Title', { gameData: s.gameData });
  }, conflict);
  await waitForScene(page, 'Title');
  await page.waitForTimeout(1300);
  // DOM title: Save Slots sits directly under New Game in the run column and no two
  // title controls overlap.
  const layout = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.re-title button')].filter(
      (b) => b.offsetParent,
    );
    const rect = (name) =>
      buttons
        .find((b) => b.querySelector('.re-title-label')?.textContent === name)
        .getBoundingClientRect();
    const newGame = rect('New Game');
    const slots = rect('Save Slots');
    const boxes = buttons.map((b) => b.getBoundingClientRect());
    return {
      sameColumn: Math.abs(slots.left - newGame.left) < 1,
      gap: Math.round(slots.top - newGame.bottom),
      overlap: boxes.some((a, i) =>
        boxes
          .slice(i + 1)
          .some(
            (b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
          ),
      ),
    };
  });
  expect(layout).toEqual({ sameColumn: true, gap: 6, overlap: false });
  return errors;
}
async function tapTitle(page, label) {
  await page.getByRole('button', { name: label, exact: true }).tap();
}
test('New Game explains the free slot and preserves the existing run when cancelled', async ({
  page,
}, info) => {
  const errors = await fixture(page);
  const before = await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_run'));
  await tapTitle(page, 'New Game');
  const dialog = page.getByRole('dialog', { name: 'Start another run?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Slot 2');
  await expect(
    dialog.getByRole('button', { name: 'Keep playing my saves', exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: info.outputPath('new-game-slot-warning.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_run'))).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_2_meta'))).toBeNull();
  await tapTitle(page, 'Save Slots');
  await waitForScene(page, 'SlotPicker');
  const menu = page.getByRole('dialog', { name: 'Select save', exact: true });
  await expect(menu).toContainText('Edric');
  await expect(menu).toContainText('Saved');
  expect(errors).toEqual([]);
});
test('cloud conflict keeps both versions until an explicit choice, then resumes the chosen device run', async ({
  page,
}, info) => {
  const errors = await fixture(page, true);
  await tapTitle(page, 'Save Slots');
  await waitForScene(page, 'SlotPicker');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Choose save version', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('213 gold');
  await expect(dialog).toContainText('987 gold');
  await page.screenshot({ path: info.outputPath('cloud-save-choice.png') });
  await dialog.getByRole('button', { name: 'Decide later', exact: true }).tap();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_cloud_conflict')).localRun.gold,
    ),
  ).toBe(213);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await dialog.getByRole('button', { name: 'Use this device save', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.gold),
  ).toBe(213);
  expect(
    await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_cloud_conflict')),
  ).toBeNull();
  expect(errors).toEqual([]);
});

test('single-run Resume preserves the cloud conflict choice instead of bypassing it', async ({
  page,
}) => {
  const errors = await fixture(page, true);
  const label = await page.locator('.re-title-run button .re-title-label').first().textContent();
  expect(label).toMatch(/^Resume · Act /);
  await page.screenshot({ path: 'test-results/title-resume.png' });
  await tapTitle(page, label);
  await expect(
    page.getByRole('dialog', { name: 'Choose save version', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Decide later', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Choose save version', exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});
