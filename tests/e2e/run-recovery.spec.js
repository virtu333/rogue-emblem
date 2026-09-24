import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  return errors;
}
async function result(page, dialogue = false) {
  await page.evaluate(async (dialogue) => {
    const g = window.__emblemRogueGame,
      s = g.scene.getScene('Battle');
    const data = { ...s.gameData, dialogue: { ...s.gameData.dialogue } };
    if (!dialogue) data.dialogue.runComplete = null;
    // The scene chunk is only preloaded opportunistically by Battle; starting
    // an unregistered key is a silent no-op, so wait for it as the game does.
    const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
    await ensureSceneLoaded(s, 'RunComplete');
    s.scene.start('RunComplete', { gameData: data, runManager: s.runManager, result: 'defeat' });
  }, dialogue);
  await waitForScene(page, 'RunComplete');
}
test('run result is readable, rotates, and exits without destroyed-text repaint', async ({
  page,
}) => {
  const errors = await boot(page);
  // Actual Phaser reproduction (not a stub) for the reported crash.
  expect(
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { MenuFocusController } = await import('/src/ui/MenuFocusController.js');
      const c = new MenuFocusController(s),
        text = s.add.text(1, 1, 'Focus lifetime');
      c.setItems([{ button: text }]);
      text.destroy();
      c.clear();
      c.destroy();
      return true;
    }),
  ).toBe(true);
  await result(page);
  const dialog = page.getByRole('dialog', { name: 'Game over', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Battles won');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/build7-results-se.png' });
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await dialog.getByRole('button', { name: 'Home Base', exact: true }).last().tap();
  await waitForScene(page, 'HomeBase');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('stopping results during dialogue never recreates menu or input scope', async ({ page }) => {
  const errors = await boot(page);
  await result(page, true);
  await expect(page.getByRole('button', { name: 'Skip conversation', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const g = window.__emblemRogueGame,
      s = g.scene.getScene('RunComplete');
    const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
    await ensureSceneLoaded(s, 'Title');
    s.scene.start('Title', { gameData: s.gameData });
  });
  await waitForScene(page, 'Title');
  await expect(page.getByRole('dialog', { name: 'Game over', exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('RunComplete');
      return {
        children: s.children.list.length,
        focus: !!s._menuFocus?.isActive,
        native: !!s.runResultMenu,
      };
    }),
  ).toEqual({ children: 0, focus: false, native: false });
  expect(errors).toEqual([]);
});
test('save delete cancel restores keyboard focus and selection reaches Home Base', async ({
  page,
}) => {
  const errors = await boot(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { MetaProgressionManager } = await import('/src/engine/MetaProgressionManager.js');
    const { getMetaKey } = await import('/src/engine/SlotManager.js');
    const m = new MetaProgressionManager(s.gameData.metaUpgrades, getMetaKey(1));
    m.incrementRunsStarted();
    const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
    await ensureSceneLoaded(s, 'SlotPicker');
    s.scene.start('SlotPicker', { gameData: s.gameData });
  });
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Delete Slot 1', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Delete Slot 1?', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Delete Slot 1', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await waitForScene(page, 'HomeBase');
  expect(errors).toEqual([]);
});
test('staff action re-equips tome before committing the action', async ({ page }) => {
  const errors = await boot(page);
  const outcome = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const healer = s.playerUnits.find((u) => u.name === 'Sera'),
      ally = s.playerUnits.find((u) => u !== healer);
    const tome = healer.weapon;
    const staff = healer.inventory.find((w) => w.type === 'Staff');
    ally.currentHP = Math.max(1, ally.stats.HP - 8);
    s.selectedUnit = healer;
    s.startHealTargetSelection(healer, [ally], staff);
    await s.executeHeal(healer, ally);
    return {
      weapon: healer.weapon.name,
      prior: tome.name,
      spent: staff._usesSpent,
      acted: healer.hasActed,
    };
  });
  expect(outcome.weapon).toBe(outcome.prior);
  expect(outcome.spent).toBe(1);
  expect(outcome.acted).toBe(true);
  expect(errors).toEqual([]);
});

test('foreground gesture resumes Web Audio without replacing music or volume', async ({ page }) => {
  const errors = await boot(page);
  await page.locator('#game-container canvas').tap({ position: { x: 10, y: 10 } });
  await page.waitForFunction(() => window.__emblemRogueGame.sound.context.state === 'running');
  await page.evaluate(async () => {
    const g = window.__emblemRogueGame,
      audio = g.registry.get('audio');
    window.audioBefore = { track: audio.currentMusic, volume: audio.musicVolume };
    await g.sound.context.suspend();
  });
  await page.locator('#game-container canvas').tap({ position: { x: 10, y: 10 } });
  await page.waitForFunction(() => window.__emblemRogueGame.sound.context.state === 'running');
  expect(
    await page.evaluate(() => {
      const audio = window.__emblemRogueGame.registry.get('audio');
      return {
        sameTrack: audio.currentMusic === window.audioBefore.track,
        sameVolume: audio.musicVolume === window.audioBefore.volume,
      };
    }),
  ).toEqual({ sameTrack: true, sameVolume: true });
  expect(errors).toEqual([]);
});
