// Enemy-phase dead air (docs/specs/large-maps/02-encounters-and-pacing.md §2.5): an
// enemy whose turn resolves nothing (a garrison holder) adds no fixed pause, no tween
// and no checkpoint to the real enemy phase. Times a seeded phase at Instant with one
// holder and with eleven: each extra holder must add under 50 ms.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });

const url = '/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1';
const PER_HOLDER_BUDGET_MS = 50;

async function playerIdle(page) {
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
}

/** Replace the enemies with `count` holders and time one real enemy phase. */
async function timeHolderPhase(page, count) {
  await playerIdle(page);
  return page.evaluate(async (count) => {
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    scene.registry.get('settings').setBattleSpeed('instant');
    for (const enemy of scene.enemyUnits) scene.removeUnitGraphic(enemy);
    scene.enemyUnits = [];
    const taken = new Set(
      [...scene.playerUnits, ...scene.npcUnits].map((u) => `${u.col},${u.row}`),
    );
    const tiles = [];
    for (let row = scene.grid.rows - 1; row >= 0 && tiles.length < count; row--)
      for (let col = scene.grid.cols - 1; col >= 0 && tiles.length < count; col--) {
        const terrain = scene.grid.getTerrainAt(col, row);
        if (terrain?.name !== 'Plain') continue;
        if (taken.has(`${col},${row}`)) continue;
        taken.add(`${col},${row}`);
        tiles.push({ col, row });
      }
    const turn = scene.turnManager.turnNumber;
    const holders = tiles.map(({ col, row }, index) => {
      const unit = scene.addEnemyFromSpawn({
        className: 'Fighter',
        level: 3,
        col,
        row,
        aiMode: 'hold',
        holdPack: index,
        holdPackSize: 1,
      });
      // This turn's wake check already ran: the holders keep their posts.
      unit.holdCheckedTurn = turn;
      return unit;
    });
    scene.turnManager.currentPhase = 'enemy';
    scene.battleState = 'ENEMY_PHASE';
    const started = performance.now();
    await scene.startEnemyPhase();
    const ms = performance.now() - started;
    return {
      ms,
      count: holders.length,
      reasons: holders.map((u) => u._lastAiDecision?.reason),
      acted: holders.every((u) => u.hasActed === true),
      positions: holders.map((u) => `${u.col},${u.row}`),
      posts: tiles.map((t) => `${t.col},${t.row}`),
    };
  }, count);
}

test('idle holders add no dead air to a real enemy phase at Instant', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await waitForScene(page, 'Battle');
  // Warm up once (first-phase code paths and assets), then time 1 and 11 holders.
  await timeHolderPhase(page, 1);
  const one = await timeHolderPhase(page, 1);
  const eleven = await timeHolderPhase(page, 11);
  for (const run of [one, eleven]) {
    expect(run.reasons.every((reason) => reason === 'hold')).toBe(true);
    expect(run.acted).toBe(true);
    expect(run.positions).toEqual(run.posts);
  }
  expect(eleven.count).toBe(11);
  const perHolder = (eleven.ms - one.ms) / (eleven.count - one.count);
  info.annotations.push({
    type: 'enemy-phase-ms',
    description: `1 holder ${one.ms.toFixed(0)} ms, 11 holders ${eleven.ms.toFixed(0)} ms, ${perHolder.toFixed(1)} ms per holder`,
  });
  console.log(
    `[enemy-phase-pacing] 1 holder ${one.ms.toFixed(0)} ms; 11 holders ${eleven.ms.toFixed(0)} ms; ${perHolder.toFixed(1)} ms per holder`,
  );
  expect(perHolder).toBeLessThan(PER_HOLDER_BUDGET_MS);
  await playerIdle(page);
  expect(errors).toEqual([]);
});
