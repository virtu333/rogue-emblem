import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';
test.use({
  ...devices['iPhone SE'],
  viewport: { width: 667, height: 375 },
  baseURL: 'http://127.0.0.1:3000',
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
  return errors;
}
async function tapTitle(page, label) {
  const p = await page.evaluate((label) => {
    const s = window.__emblemRogueGame.scene.getScene('Title');
    const walk = (nodes) =>
      nodes.flatMap((o) => [o, ...(Array.isArray(o.list) ? walk(o.list) : [])]);
    const o = walk(s.children.list).find((o) => o.text === label && o.visible);
    const b = o.getBounds(),
      r = s.game.canvas.getBoundingClientRect();
    return {
      x: r.x + (b.centerX * r.width) / s.scale.width,
      y: r.y + (b.centerY * r.height) / s.scale.height,
    };
  }, label);
  await page.touchscreen.tap(p.x, p.y);
}
test('New Game explains the free slot and preserves the existing run when cancelled', async ({
  page,
}, info) => {
  const errors = await fixture(page);
  const before = await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_run'));
  await tapTitle(page, 'NEW GAME');
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
  await tapTitle(page, 'CONTINUE');
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
  await tapTitle(page, 'CONTINUE');
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
