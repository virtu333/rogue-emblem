// Enemy-phase dead air (docs/specs/large-maps/02-encounters-and-pacing.md §2.5): an
// enemy whose turn resolves nothing (a garrison holder) adds no fixed pause, no tween
// and no checkpoint to the real enemy phase. Times a seeded phase at Instant with one
// holder and with eleven: each extra holder must add under 50 ms.
// And a walk that clips the party's vision by a single tile (hidden, seen, hidden) is
// drawn there: the renderer's own frames show the sprite on that tile, never in the fog.
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

/**
 * Walk an enemy hidden → seen → hidden at `speed` on the real scene, sampling what each
 * rendered frame shows (Phaser's postrender: after the renderer drew the frame).
 */
async function clipVisionWalk(page, speed) {
  await playerIdle(page);
  return page.evaluate(async (speed) => {
    const game = window.__emblemRogueGame;
    const scene = game.scene.getScene('Battle');
    scene.registry.get('settings').setBattleSpeed(speed);
    const units = [...scene.playerUnits, ...scene.enemyUnits, ...scene.npcUnits];
    const taken = new Set(units.map((u) => `${u.col},${u.row}`));
    const free = (col, row) =>
      col >= 0 &&
      row >= 0 &&
      col < scene.grid.cols &&
      row < scene.grid.rows &&
      !taken.has(`${col},${row}`) &&
      scene.grid.getTerrainAt(col, row)?.name === 'Plain';
    let enemy = null;
    let path = null;
    for (const candidate of scene.enemyUnits) {
      if (candidate.moveType !== 'Infantry' && candidate.moveType !== 'Armored') continue;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const a = { col: candidate.col + dc, row: candidate.row + dr };
        const b = { col: candidate.col + 2 * dc, row: candidate.row + 2 * dr };
        if (free(a.col, a.row) && free(b.col, b.row)) {
          enemy = candidate;
          path = [{ col: candidate.col, row: candidate.row }, a, b];
          break;
        }
      }
      if (enemy) break;
    }
    if (!enemy) return { error: 'no straight three-tile walk' };
    // The party sees the middle tile only.
    const mid = path[1];
    scene.grid.fogEnabled = true;
    scene.grid.visibleSet = new Set([`${mid.col},${mid.row}`]);
    scene.updateEnemyVisibility();
    const pixel = (t) => scene.grid.gridToPixel(t.col, t.row);
    const tileOf = (x, y) => {
      for (const t of path) {
        const p = pixel(t);
        if (Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5) return `${t.col},${t.row}`;
      }
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };
    const frames = [];
    const onRender = () => {
      const g = enemy.graphic;
      frames.push({ tile: tileOf(g.x, g.y), shown: g.visible === true && g.alpha > 0 });
    };
    scene.turnManager.currentPhase = 'enemy';
    scene.battleState = 'ENEMY_PHASE';
    game.events.on('postrender', onRender);
    const started = performance.now();
    let result;
    try {
      result = await scene.animateEnemyMove(enemy, path);
      // Two more frames after the walk: the sprite rests hidden on its fogged end tile.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    } finally {
      game.events.off('postrender', onRender);
    }
    return {
      ms: performance.now() - started,
      seen: result?.seen,
      tiles: path.map((t) => `${t.col},${t.row}`),
      frames,
      end: `${enemy.col},${enemy.row}`,
      endShown: enemy.graphic.visible,
    };
  }, speed);
}

for (const speed of ['normal', 'instant']) {
  test(`a walk clipping one seen tile is drawn on it at ${speed}`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await waitForScene(page, 'Battle');
    const walk = await clipVisionWalk(page, speed);
    expect(walk.error).toBeUndefined();
    const [start, mid, end] = walk.tiles;
    expect(walk.seen).toBe(true);
    // At least one rendered frame shows the enemy on the seen tile...
    const onMid = walk.frames.filter((f) => f.shown && f.tile === mid);
    expect(onMid.length, JSON.stringify(walk.frames)).toBeGreaterThanOrEqual(1);
    // ...and none shows it anywhere the party cannot see.
    expect(walk.frames.filter((f) => f.shown && f.tile !== mid)).toEqual([]);
    expect(walk.frames.some((f) => f.tile === start || f.tile === end)).toBe(true);
    expect(walk.end).toBe(end);
    expect(walk.endShown).toBe(false);
    expect(errors).toEqual([]);
  });
}
