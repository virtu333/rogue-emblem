import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test('Act 2 cleric heals once through the real enemy phase and updates the map', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  const initial = await page.evaluate(() => {
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    scene.battleParams.act = 'act2';
    for (const enemy of scene.enemyUnits) scene.removeUnitGraphic(enemy);
    scene.enemyUnits = [];
    const cleric = scene.addEnemyFromSpawn({
      className: 'Cleric',
      level: 8,
      col: 6,
      row: 3,
      aiMode: 'heal',
    });
    const ally = scene.addEnemyFromSpawn({ className: 'Fighter', level: 8, col: 7, row: 3 });
    ally.currentHP = 1;
    ally.hasActed = true;
    scene.updateHPBar(ally);
    cleric.mov = cleric.stats.MOV = 0;
    window.enemyHealFixture = { cleric, ally };
    const initial = { hp: ally.currentHP, uses: cleric.weapon._usesSpent || 0 };
    window.enemyHealDone = false;
    scene.turnManager.currentPhase = 'enemy';
    scene.battleState = 'ENEMY_PHASE';
    scene.startEnemyPhase().then(() => {
      window.enemyHealDone = true;
    });
    return initial;
  });
  await page.waitForFunction(() => window.enemyHealDone);
  const result = await page.evaluate(() => {
    const { cleric, ally } = window.enemyHealFixture;
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      hp: ally.currentHP,
      maxHP: ally.stats.HP,
      uses: cleric.weapon._usesSpent,
      reason: cleric._lastAiDecision.reason,
      state: scene.battleState,
    };
  });
  expect(result.hp).toBeGreaterThan(initial.hp);
  expect(result.hp).toBeLessThanOrEqual(result.maxHP);
  expect(result.uses).toBe(initial.uses + 1);
  expect(result.reason).toBe('heal_ally');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.screenshot({ path: info.outputPath('cleric-healed-ally.png') });
  expect(errors).toEqual([]);
});
