import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
async function boot(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  return errors;
}
test('level result owns input, scrolls on rotation, and settles once through controller confirm', async ({
  page,
}) => {
  const errors = await boot(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { LevelUpPopup } = await import('/src/ui/LevelUpPopup.js');
    s.battleState = 'COMBAT_RESOLVING';
    window.settled = 0;
    window.popup = new LevelUpPopup(
      s,
      s.playerUnits[0],
      { newLevel: 2, gains: { STR: 1, HP: 1 } },
      false,
      ['A very long learned skill name for checking small-phone layout'],
    );
    window.popup.show().then(() => window.settled++);
  });
  const dialog = page.getByRole('dialog', { name: 'Level up', exact: true });
  await expect(dialog).toBeVisible();
  expect(await page.locator('.mobile-battle-hud').evaluate((el) => el.inert)).toBe(true);
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 667, height: 375 });
  const reveal = dialog.getByRole('button', { name: 'Reveal gains', exact: true });
  if (await reveal.count()) await reveal.tap();
  await page.screenshot({ path: 'test-results/new-level-up.png' });
  await page.evaluate(async () => {
    const { dispatchInputAction } = await import('/src/utils/inputFocus.js');
    dispatchInputAction('input:confirm');
  });
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => window.popup.destroy());
  expect(await page.evaluate(() => window.settled)).toBe(1);
  expect(errors).toEqual([]);
});
test('promotion choices cancel, confirm selected class, and settle on shutdown', async ({
  page,
}) => {
  const errors = await boot(page);
  const open = () =>
    page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { PromotionChoicePanel } = await import('/src/ui/PromotionChoicePanel.js');
      window.result = 'pending';
      const targets = ['Hero', 'Swordmaster'].map((name) =>
        s.gameData.classes.find((c) => c.name === name),
      );
      window.choice = new PromotionChoicePanel(s, s.playerUnits[0], targets, s.gameData.skills);
      window.choice.show().then((c) => (window.result = c?.name || null));
    });
  await open();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.result)).toBeNull();
  await open();
  await page.getByRole('button', { name: 'Select Swordmaster', exact: true }).tap();
  await page.getByRole('button', { name: 'Confirm promotion', exact: true }).tap();
  expect(await page.evaluate(() => window.result)).toBe('Swordmaster');
  await open();
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle').events.emit('shutdown'),
  );
  expect(await page.evaluate(() => window.result)).toBeNull();
  await expect(page.getByRole('dialog', { name: 'Choose promotion', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('rewards expose tier icons and return from roster/settings without losing choice', async ({
  page,
}) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      menu = s._lootController.mobileRewards;
    menu.choices[0] = {
      type: 'weapon',
      item: { ...s.runManager.roster[0].inventory[0], name: 'Legend test sword', tier: 'Legend' },
    };
    menu.selected = 0;
    menu.render();
  });
  // The tier icon: the item's socketed icon, its rim the tier (item art).
  await expect(rewards.locator('.reward-legend .ia-icon[data-rim="Legend"]')).toHaveCount(1);
  await expect(rewards.locator('.reward-legend')).toContainText('Legend · Weapon');
  await rewards.getByRole('button', { name: 'Roster', exact: true }).tap();
  // Rewards open the run's roster for management (equip between battles).
  await expect(page.getByRole('dialog', { name: 'Manage roster', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rewards.locator('.reward-legend')).toHaveAttribute('aria-pressed', 'true');
  await rewards.getByRole('button', { name: 'Menu', exact: true }).tap();
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Resume', exact: true }).tap();
  await expect(rewards.getByRole('button', { name: 'Choose reward', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/reward-flair-live.png' });
  expect(errors).toEqual([]);
});
test('battle trade transfers once and commits movement; rewind confirmation is native', async ({
  page,
}) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const [a, b] = s.playerUnits;
    b.consumables = [];
    a.consumables = [
      { name: 'Test Vulnerary', type: 'Consumable', effect: 'heal', uses: 3, value: 10 },
    ];
    s.selectUnit(a);
    s.showBattleTradeUI(a, b);
  });
  const trade = page.getByRole('dialog', { name: 'Trade items', exact: true });
  await trade.getByRole('button', { name: /Test Vulnerary.*Give to/ }).tap();
  await trade.getByRole('button', { name: /^Give Test Vulnerary/ }).tap();
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return [
        s.playerUnits[0].consumables.length,
        s.playerUnits[1].consumables.length,
        s.tradeMutatedThisSession,
      ];
    }),
  ).toEqual([0, 1, true]);
  await page.keyboard.press('Escape');
  await expect(trade).toHaveCount(0);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    window.rewindChoice = 'pending';
    s.showVisionDialog({
      title: 'Rewind test',
      body: 'Return to the start of the turn?',
      confirmLabel: 'Rewind',
      cancelLabel: 'Keep turn',
      onConfirm: () => (window.rewindChoice = 'confirm'),
      onCancel: () => (window.rewindChoice = 'cancel'),
    });
  });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.rewindChoice)).toBe('cancel');
  expect(errors).toEqual([]);
});
test('colosseum keyboard can enter Arena and return without spending gold', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
    window.arena = new ColosseumOverlay(s, s.runManager, s.gameData);
    window.arena.show({ id: 'test' }, () => {});
    window.goldBefore = s.runManager.gold;
  });
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Arena · Choose fighter', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Colosseum', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').runManager.gold),
  ).toBe(await page.evaluate(() => window.goldBefore));
  expect(errors).toEqual([]);
});

test('turn-start banner and healing reject early input until effects finish', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = s.playerUnits[0];
    unit.currentHP = 1;
    unit.skills = ['renewal'];
    window.expectedRenewalHP = 1 + Math.max(1, Math.floor(unit.stats.HP / 10));
    const animateHeal = s.animateHeal.bind(s);
    s.animateHeal = () =>
      new Promise((resolve) => {
        window.finishTurnHeal = () => {
          s.animateHeal = animateHeal;
          resolve();
        };
      });
    s.turnManager.turnNumber = 2;
    s.onPhaseChange('player', 2);
    s.forceEndTurn();
    s.selectUnit(unit);
  });
  const hud = page.locator('.mobile-battle-hud');
  await expect(hud).toContainText('Applying turn-start effects');
  expect(await hud.evaluate((el) => el.inert)).toBe(true);
  await page.keyboard.press('e');
  await page.waitForFunction(() => typeof window.finishTurnHeal === 'function');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.forceEndTurn();
    s.selectUnit(s.playerUnits[0]);
  });
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        state: s.battleState,
        phase: s.turnManager.currentPhase,
        selected: s.selectedUnit?.name || null,
      };
    }),
  ).toEqual({ state: 'TURN_START_RESOLVING', phase: 'player', selected: null });
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].currentHP,
    ),
  ).toBe(await page.evaluate(() => window.expectedRenewalHP));
  await page.evaluate(() => window.finishTurnHeal());
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await expect(hud.getByRole('button', { name: 'End turn…', exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].currentHP,
    ),
  ).toBeGreaterThanOrEqual(await page.evaluate(() => window.expectedRenewalHP));
  expect(await hud.evaluate((el) => el.inert)).toBe(false);
  expect(errors).toEqual([]);
});
