import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
const url = '/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1';
async function boot(page) {
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
}
test('enemy combat pauses for its level-up and has a durable enemy checkpoint', async ({
  page,
}, info) => {
  await boot(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { RunManager } = await import('/src/engine/RunManager.js');
    s.runManager = new RunManager(s.gameData);
    s.runManager.startRun();
    s.runManager.battleInProgress = { nodeId: 'test', checkpoint: null };
    s.registry.set('activeSlot', 1);
    const settings = s.registry.get('settings');
    settings.setBattleSpeed('instant');
    settings.setReduceMotion(true);
    const unit = s.playerUnits[0];
    unit.level = 1;
    unit.xp = 99;
    unit.currentHP = unit.stats.HP = 100;
    unit.skills = [];
    unit.stats.STR = 30;
    unit.stats.SKL = 100;
    unit.weapon = { ...unit.weapon, type: 'Sword', hit: 100, crit: 0 };
    s.enemyUnits.splice(2);
    for (const enemy of s.enemyUnits) {
      enemy.currentHP = enemy.stats.HP = 100;
      enemy.stats.STR = 0;
      enemy.stats.MAG = 0;
      enemy.col = unit.col + 1;
      enemy.row = unit.row;
      enemy.skills = [];
      enemy.stats.DEF = 0;
      enemy.stats.SPD = 0;
      // SKL 100 gives the counter a ~50% crit; a crit kill would drop this enemy.
      enemy.stats.LCK = 200;
      enemy.weapon = { ...enemy.weapon, type: 'Sword', range: '1', might: 0, hit: 0, crit: 0 };
      enemy.hasActed = false;
    }
    s.aiController._decideAction = () => ({ target: unit });
    s.turnManager.currentPhase = 'enemy';
    s.battleState = 'ENEMY_PHASE';
    window.enemyPhaseDone = false;
    s.startEnemyPhase().then(() => {
      window.enemyPhaseDone = true;
    });
  });
  const popup = page.getByRole('dialog', { name: 'Level up', exact: true });
  await expect(popup).toBeVisible();
  const state = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const cp = s.runManager.battleInProgress.checkpoint;
    return {
      phase: s.turnManager.currentPhase,
      checkpointPhase: cp?.phase,
      acted: cp?.enemyUnits.map((u) => u.hasActed),
      done: window.enemyPhaseDone,
    };
  });
  expect(state).toEqual({
    phase: 'enemy',
    checkpointPhase: 'enemy',
    acted: [true, false],
    done: false,
  });
  await page.screenshot({ path: info.outputPath('enemy-level-up.png') });
  await popup.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(popup).toHaveCount(0);
});
test('records show persisted roster detail without navigating away from the title', async ({
  page,
}, info) => {
  await boot(page);
  await page.evaluate(async () => {
    const { getMetaKey } = await import('/src/engine/SlotManager.js');
    localStorage.setItem(
      getMetaKey(1),
      JSON.stringify({
        runRecords: [
          {
            id: 'win',
            endedAt: Date.now(),
            difficulty: 'normal',
            actsCleared: 4,
            totalTurns: 70,
            seed: 42,
            roster: [{ name: 'Sera', className: 'Light Priestess', level: 15, isLord: true }],
          },
        ],
      }),
    );
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
    await ensureSceneLoaded(s, 'Title');
    s.scene.start('Title', { gameData: s.gameData });
  });
  await waitForScene(page, 'Title');
  await page.waitForTimeout(1300);
  await page.evaluate(() =>
    window.__emblemRogueGame.scene
      .getScene('Title')
      ._menuButtons.find((b) => b.list.some((t) => t.text === 'RECORDS'))
      ._hitZone.emit('pointerdown'),
  );
  const dialog = page.getByRole('dialog', { name: 'Victory records' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Slot 1/ }).tap();
  await expect(
    dialog.getByText('Sera · Light Priestess · Lv 15 · Lord', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('victory-record.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
});

test('hold speed survives HP refreshes and releases without changing the saved preference', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.get('settings').setBattleSpeed('normal');
    s._combatSpeedSnapshot = 'normal';
    s.battleState = 'COMBAT_RESOLVING';
    s._mobileBattleHud.sync();
  });
  const control = page.getByRole('button', { name: 'Hold to speed up' });
  await expect(control).toBeVisible();
  const bounds = await control.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.selectedUnit = s.playerUnits[0];
    s.selectedUnit.currentHP--;
    s._mobileBattleHud.sync();
  });
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { battleSpeed } = await import('/src/utils/combatTiming.js');
      return [battleSpeed(s), s.registry.get('settings').getBattleSpeed()];
    }),
  ).toEqual(['fast', 'normal']);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.turnManager.currentPhase = 'enemy';
    delete s._combatSpeedSnapshot;
    s.battleState = 'ENEMY_PHASE';
    s._mobileBattleHud.sync();
  });
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s._combatSpeedSnapshot = 'normal';
    s.battleState = 'COMBAT_RESOLVING';
    s._mobileBattleHud.sync();
  });
  expect(
    await page.evaluate(async () => {
      const { battleSpeed } = await import('/src/utils/combatTiming.js');
      return battleSpeed(window.__emblemRogueGame.scene.getScene('Battle'));
    }),
  ).toBe('fast');
  await page.mouse.up();
  await expect(control).toHaveAttribute('aria-pressed', 'false');
});

test('battlefield place text and merchant sprite are readable on a small phone', async ({
  page,
}, info) => {
  await boot(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.battleParams.act = 'act2';
    s.battleConfig.templateId = 'act3_dark_champion_keep';
    s._mobileBattleHud.lastSnapshot = '';
    s._mobileBattleHud.sync();
    const unit = s.playerUnits[0];
    unit.isCaravan = true;
    unit.graphic.setTexture(s.getSpriteKey(unit)).setDisplaySize(30, 30);
    s.showPhaseBanner('player', 1);
  });
  await page.locator('.mb-battle-info summary').click();
  await expect(
    page.locator('.mb-more-content').getByText(/Old Kingdom Roads — Dark Champion Keep/),
  ).toBeVisible();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')._phaseBanner?.alpha === 1,
  );
  await page.screenshot({ path: info.outputPath('place-and-merchant.png') });
  expect(errors).toEqual([]);
});
