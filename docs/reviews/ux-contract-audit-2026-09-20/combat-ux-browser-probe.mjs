import {
  chromium,
  devices,
} from '/Users/davechen/Documents/rogue-emblem/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ headless: false });
const results = {};
try {
  const context = await browser.newContext({
    ...devices['iPhone SE'],
    viewport: { width: 667, height: 375 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const boot = async () => {
    await page.goto(
      'http://127.0.0.1:3000/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1',
    );
    await page.waitForFunction(
      () => window.__emblemRogueGame?.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
      { timeout: 20000 },
    );
  };
  const tile = async (col, row) => {
    const p = await page.evaluate(
      ({ col, row }) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle'),
          w = s.grid.gridToPixel(col, row),
          p = s._worldToScreen(w.x, w.y),
          r = s.game.canvas.getBoundingClientRect();
        return {
          x: r.x + (p.x * r.width) / s.scale.width,
          y: r.y + (p.y * r.height) / s.scale.height,
        };
      },
      { col, row },
    );
    await page.touchscreen.tap(p.x, p.y);
  };
  const state = async () =>
    page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        state: s.battleState,
        turn: s.turnManager.turnNumber,
        village: s._villageState,
        checkpointCalls: window.probeCheckpointCalls,
        checkpoint: s.runManager?.battleInProgress?.checkpoint?.checkpointIndex,
        units: s.playerUnits.map((u) => ({
          name: u.name,
          hp: u.currentHP,
          acted: u.hasActed,
          col: u.col,
          row: u.row,
        })),
        charges: s.getVisionChargesRemaining?.(),
      };
    });
  await boot();
  results.cantoSetup = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      u = s.playerUnits.find((u) => u.name === 'Edric');
    u.skills.push('canto');
    u.currentHP = Math.max(1, u.currentHP - 10);
    u.consumables = [structuredClone(s.gameData.consumables.find((i) => i.name === 'Vulnerary'))];
    s.updateHPBar(u);
    s.battleConfig.villageTile = { col: u.col, row: u.row };
    s._villageState = { col: u.col, row: u.row, status: 'intact' };
    s.grid.setTerrainAt(
      u.col,
      u.row,
      s.gameData.terrain.findIndex((t) => t.name === 'Village'),
    );
    s._villageController._renderMarker();
    window.probeCheckpointCalls = 0;
    const original = s._captureSuspendCheckpoint.bind(s);
    s._captureSuspendCheckpoint = (...args) => {
      window.probeCheckpointCalls++;
      return original(...args);
    };
    return {
      unit: u.name,
      col: u.col,
      row: u.row,
      hasBattleInProgress: !!s.runManager?.battleInProgress,
    };
  });
  await tile(3, 3);
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Item', exact: true })
    .tap();
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: /^Vulnerary/ })
    .tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'CANTO_MOVING',
  );
  results.cantoBeforeSkip = await state();
  await page.screenshot({ path: '/tmp/combat-ux-canto-before.png' });
  await page
    .getByRole('navigation', { name: 'Battle utilities' })
    .getByRole('button', { name: 'Back', exact: true })
    .tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  results.cantoAfterSkip = await state();
  await page.screenshot({ path: '/tmp/combat-ux-canto-after.png' });
  await boot();
  results.renewalSetup = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      u = s.playerUnits.find((u) => u.name === 'Sera');
    u.skills.push('renewal');
    u.stats.HP = 50;
    u.currentHP = 10;
    s.updateHPBar(u);
    for (const [i, e] of s.enemyUnits.entries()) {
      e.col = 9;
      e.row = 5 + i;
      e.mov = 0;
      e.stats.MOV = 0;
      s.updateUnitPosition(e);
    }
    return { hp: u.currentHP, maxHP: u.stats.HP, skills: u.skills };
  });
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
  await hud.getByRole('button', { name: 'End turn now', exact: true }).tap();
  await page.waitForFunction(
    () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return s.turnManager.turnNumber === 2 && s.battleState === 'PLAYER_IDLE';
    },
    null,
    { timeout: 30000 },
  );
  results.renewalAfterTurnStart = await state();
  await page.screenshot({ path: '/tmp/combat-ux-renewal-healed.png' });
  await tile(3, 3);
  await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await hud.getByRole('button', { name: 'Rewind', exact: true }).tap();
  await page.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  results.renewalAfterRewind = await state();
  await page.screenshot({ path: '/tmp/combat-ux-renewal-rewound.png' });
  results.errors = errors;
  await context.close();
} catch (error) {
  results.failure = { message: error.message, stack: error.stack };
} finally {
  await browser.close();
  await fs.writeFile('/tmp/combat-ux-browser-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
