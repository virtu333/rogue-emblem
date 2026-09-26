import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

// Portrait battles (beta): an upright phone draws the board turned a quarter with the
// player's side at the bottom; taps, commands and the rotate prompt follow.
test.use({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });

async function bootBattle(page, query = '&portrait=1') {
  await page.goto(`/?devScene=battle&preset=battle_smoke&seed=42${query}`);
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    if (battle.battleState !== 'DEPLOY_SELECTION') return;
    battle.children.list
      .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
      .at(-1)
      ?.emit('pointerdown');
  });
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  await attachSlot(page);
}

// An orientation switch re-opens only from a save that reached storage, so the battle
// needs a real slot (the dev route has none). This test profile is isolated.
async function attachSlot(page) {
  await page.evaluate(async () => {
    const game = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    game.registry.set('activeSlot', 1);
    setActiveSlot(1);
  });
}

// The battle checkpoint as written to the slot's run save.
function savedCheckpoint(page) {
  return page.evaluate(async () => {
    const { getRunKey } = await import('/src/engine/SlotManager.js');
    const run = JSON.parse(localStorage.getItem(getRunKey(1)) || 'null');
    const checkpoint = run?.battleInProgress?.checkpoint;
    return checkpoint
      ? {
          rng: checkpoint.rngState,
          units: [...checkpoint.playerUnits, ...checkpoint.enemyUnits].map((u) => [
            u.name,
            u.col,
            u.row,
            u.currentHP,
            Boolean(u.hasActed),
          ]),
        }
      : null;
  });
}

// CSS point at the center of a grid tile, through the live camera and canvas scale.
function tileCss(page, col, row) {
  return page.evaluate(
    ([col, row]) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const world = b.grid.gridToPixel(col, row);
      const screen = b._worldToScreen(world.x, world.y);
      const rect = b.game.canvas.getBoundingClientRect();
      return {
        x: rect.left + (screen.x * rect.width) / b.scale.width,
        y: rect.top + (screen.y * rect.height) / b.scale.height,
      };
    },
    [col, row],
  );
}

function battleSnapshot(page) {
  return page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      rotation: b.grid.board.rotation,
      state: b.battleState,
      units: [...b.playerUnits, ...b.enemyUnits].map((u) => [
        u.name,
        u.col,
        u.row,
        u.currentHP,
        Boolean(u.hasActed),
      ]),
      rng: b._battleRng?.getState?.(),
    };
  });
}

test('upright phone plays on a turned board with thumb-reach commands', async ({ page }) => {
  await bootBattle(page);
  const info = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const player = b.playerUnits.map((u) => b.grid.gridToPixel(u.col, u.row).y);
    const enemy = b.enemyUnits.map((u) => b.grid.gridToPixel(u.col, u.row).y);
    return {
      rotation: b.grid.board.rotation,
      canvas: [b.scale.width, b.scale.height],
      playerBelowEnemies: Math.min(...player) > Math.max(...enemy),
      prompt: getComputedStyle(document.getElementById('rotate-prompt')).display,
      classes: document.documentElement.className,
    };
  });
  expect(info.rotation).toBe('ccw');
  expect(info.canvas[1]).toBeGreaterThan(info.canvas[0]);
  expect(info.playerBelowEnemies).toBe(true);
  expect(info.prompt).toBe('none');
  expect(info.classes).toContain('portrait-battle');

  // The rail sits under the map and every main command is on screen.
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  const endTurn = hud.getByRole('button', { name: 'End turn…', exact: true });
  await expect(endTurn).toBeInViewport({ ratio: 1 });
  const canvasBox = await page.locator('#game-container canvas').boundingBox();
  const hudBox = await hud.boundingBox();
  expect(hudBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height - 1);
  for (const name of ['Overview', 'Recenter', 'Back', 'Menu'])
    await expect(hud.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });

  // Real taps on the turned board select the unit and move it to the tapped tile.
  const unit = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits.find((x) => x.currentHP > 0 && !x.hasActed);
    const occupied = new Set([...b.playerUnits, ...b.enemyUnits].map((x) => `${x.col},${x.row}`));
    let dest = null;
    for (const key of b.grid.getMovementRange(u.col, u.row, u.stats.MOV, u.moveType).keys()) {
      if (occupied.has(key)) continue;
      const [col, row] = key.split(',').map(Number);
      if (!dest || col > dest.col) dest = { col, row };
    }
    return { name: u.name, col: u.col, row: u.row, dest };
  });
  let point = await tileCss(page, unit.col, unit.row);
  await page.touchscreen.tap(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name),
    )
    .toBe(unit.name);
  point = await tileCss(page, unit.dest.col, unit.dest.row);
  await page.touchscreen.tap(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate((name) => {
        const u = window.__emblemRogueGame.scene
          .getScene('Battle')
          .playerUnits.find((x) => x.name === name);
        return [u.col, u.row];
      }, unit.name),
    )
    .toEqual([unit.dest.col, unit.dest.row]);
  await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: 'test-results/portrait-battle-actions.png' });
});

// The bottom edge of the upright rail: the dock (Danger, plus the pinned Wait in a unit's
// action menu) beside the four tools. Each control's box, whether anything covers its
// centre, and whether any word of its label is broken across lines or spills out.
function bottomRow(page) {
  return page.evaluate(() => {
    const hud = document.querySelector('.mobile-battle-hud');
    const rail = hud.getBoundingClientRect();
    const buttons = [...hud.querySelectorAll('.mb-dock > button, .bl-tools > button')];
    return buttons.map((button) => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const brokenWords = [];
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest('[hidden]')) continue;
        if (getComputedStyle(node.parentElement).display === 'none') continue;
        for (const match of node.textContent.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rects = [...range.getClientRects()].filter((q) => q.width > 0);
          const inside = rects.every(
            (q) =>
              q.left >= r.left - 0.5 &&
              q.right <= r.right + 0.5 &&
              q.top >= r.top - 0.5 &&
              q.bottom <= r.bottom + 0.5,
          );
          if (rects.length !== 1 || !inside) brokenWords.push(match[0]);
        }
      }
      return {
        name: button.getAttribute('aria-label') || button.innerText.replace(/\s+/g, ' ').trim(),
        left: r.left,
        right: r.right,
        top: r.top,
        width: r.width,
        height: r.height,
        onScreen: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
        inRail: r.top >= rail.top - 0.5 && r.bottom <= rail.bottom + 0.5,
        onTop: Boolean(hit && button.contains(hit)),
        brokenWords,
      };
    });
  });
}

function expectWholeRow(row, names) {
  expect(row.map((c) => c.name)).toEqual(names);
  for (const [i, c] of row.entries()) {
    expect(c, c.name).toMatchObject({ onScreen: true, inRail: true, onTop: true, brokenWords: [] });
    expect(c.width, `${c.name} width`).toBeGreaterThanOrEqual(44);
    expect(c.height, `${c.name} height`).toBeGreaterThanOrEqual(44);
    expect(Math.abs(c.top - row[0].top), `${c.name} shares the row`).toBeLessThan(1);
    if (i > 0)
      expect(c.left, `${c.name} clear of ${row[i - 1].name}`).toBeGreaterThan(row[i - 1].right);
  }
}

// Playtest 4 pinned Wait in the dock beside a compact Danger. On the upright rail the dock
// shares the bottom edge with Overview, Recenter, Back and Menu: six controls on one row,
// each whole, labelled, unbroken and tappable, from a small phone to a large one.
for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`upright rail keeps Wait, Danger and the tools whole at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: true, guidance: 'full' }),
      ),
    );
    await page.goto('/?devScene=battle&preset=combat_actions&seed=42&portrait=1');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
    expect((await battleSnapshot(page)).rotation).toBe('ccw');
    const tools = ['Overview', 'Recenter', 'Back', 'Menu'];
    // Idle: Danger alone in the dock.
    await expect.poll(async () => (await bottomRow(page)).length).toBe(5);
    expectWholeRow(await bottomRow(page), ['Danger', ...tools]);

    // Support's six-command menu (Guidance Full keeps a greyed Attack): Wait is pinned.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((p) => p.name === 'Support');
      s.selectUnit(u);
      s.showActionMenu(u);
    });
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await expect(hud.locator('.mb-dock .mb-pinned-command')).toHaveText('Wait');
    expectWholeRow(await bottomRow(page), ['Wait', 'Danger', ...tools]);
    const [wait, danger] = await bottomRow(page);
    expect(wait.width).toBeGreaterThan(danger.width);

    // Danger works from the pinned row and keeps its place; pinned, it says so by name.
    await hud.getByRole('button', { name: 'Danger', exact: true }).tap();
    await expect(hud.getByRole('button', { name: 'Danger', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expectWholeRow(await bottomRow(page), ['Wait', 'Danger', ...tools]);
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').togglePersistentDanger(),
    );
    await expect(hud.getByRole('button', { name: 'Danger · pinned', exact: true })).toBeVisible();
    expectWholeRow(await bottomRow(page), ['Wait', 'Danger · pinned', ...tools]);

    // A real tap on the pinned Wait ends Support's action.
    await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          return [s.battleState, s.playerUnits.find((p) => p.name === 'Support').hasActed];
        }),
      )
      .toEqual(['PLAYER_IDLE', true]);
    expectWholeRow(await bottomRow(page), ['Danger · pinned', ...tools]);
  });
}

test('turning the phone re-opens the battle exactly as it stood', async ({ page }) => {
  await bootBattle(page);
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits.find((x) => !x.hasActed);
    b.selectUnit(u);
    b.showActionMenu(u);
  });
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  const before = await battleSnapshot(page);
  expect(before.rotation).toBe('ccw');

  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe('none');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  const landscape = await battleSnapshot(page);
  expect(landscape.units).toEqual(before.units);
  expect(landscape.rng).toEqual(before.rng);
  // The switch re-opened from a durable save: a refresh restores the same battle.
  expect(await savedCheckpoint(page)).toEqual({ rng: before.rng, units: before.units });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe('ccw');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  const upright = await battleSnapshot(page);
  expect(upright.units).toEqual(before.units);
  expect(upright.rng).toEqual(before.rng);
});

test('a turn mid-action waits for the next safe moment', async ({ page }) => {
  await bootBattle(page);
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits.find((x) => !x.hasActed);
    b.selectUnit(u);
    b.showActionMenu(u);
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.portrait-battle-notice')).toContainText('when your turn is ready');
  expect((await battleSnapshot(page)).rotation).toBe('ccw');
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Back', exact: true })
    .tap();
  await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe('none');
});

test('without the opt-in an upright phone still asks for landscape', async ({ page }) => {
  await bootBattle(page, '&portrait=0');
  const info = await page.evaluate(() => ({
    rotation: window.__emblemRogueGame.scene.getScene('Battle').grid.board.rotation,
    prompt: getComputedStyle(document.getElementById('rotate-prompt')).display,
  }));
  expect(info).toEqual({ rotation: 'none', prompt: 'flex' });
});

// Full domain state of the battle (units with equipment and conditions, fog knowledge,
// RNG, convoy, gold, Vision charges) through the production checkpoint adapter.
function domainState(page) {
  return page.evaluate(async () => {
    const { captureBattleState } = await import('/src/ui/BattleCheckpointAdapter.js');
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const state = captureBattleState(b);
    if (state.fog) {
      state.fog.visible.sort();
      state.fog.everSeen.sort();
    }
    delete state.checkpointIndex; // counts saves, including the orientation switches
    return {
      state,
      turn: b.turnManager?.turnNumber,
      visionCharges: b.runManager?.visionChargesRemaining ?? null,
    };
  });
}

// Ends the player turn through the rail and waits for the next player turn,
// dismissing level-up popups the enemy phase raises.
async function endTurn(page) {
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  const turn = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').turnManager.turnNumber,
  );
  await hud.getByRole('button', { name: /^End turn/ }).tap();
  const confirm = hud.getByRole('button', { name: 'End turn now', exact: true });
  if (await confirm.isVisible().catch(() => false)) await confirm.tap();
  for (let i = 0; i < 240; i++) {
    const done = await page.evaluate((t) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return b.turnManager.turnNumber > t && b.battleState === 'PLAYER_IDLE';
    }, turn);
    if (done) return;
    const next = page.getByRole('button', { name: /^(Continue|Reveal gains)$/ }).first();
    if (await next.isVisible().catch(() => false)) await next.tap();
    await page.waitForTimeout(250);
  }
  throw new Error('the next player turn never began');
}

async function turnPhone(page, size, rotation) {
  await page.setViewportSize(size);
  await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe(rotation);
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
}

// Title -> Save Slots -> Slot 1 -> Resume Battle: the shipping recovery path.
async function resumeBattle(page) {
  await page.goto('/');
  await waitForScene(page, 'Title');
  await page.waitForTimeout(1300); // boot-to-title router cooldown
  await page.getByRole('button', { name: /^Save Slots/ }).tap();
  await waitForScene(page, 'SlotPicker');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
}

test('turning the phone mid-battle does not change how the battle plays out', async ({ page }) => {
  test.setTimeout(300_000);
  const landscape = { width: 844, height: 390 };
  const upright = { width: 390, height: 844 };
  await bootBattle(page);
  // Bring an enemy next to the army so the first enemy phase fights, then save.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits[0];
    const enemy = s.enemyUnits[0];
    const tile = [
      [u.col + 1, u.row],
      [u.col - 1, u.row],
      [u.col, u.row + 1],
      [u.col, u.row - 1],
    ].find(
      ([c, r]) => c >= 0 && r >= 0 && c < s.grid.cols && r < s.grid.rows && !s.getUnitAt(c, r),
    );
    [enemy.col, enemy.row] = tile;
    s.grid.setTerrainAt(enemy.col, enemy.row, 0);
    s.updateUnitPosition(enemy);
    // First-use tips are per-save UI state; keep them out of the runs being compared.
    s.registry.get('settings').setHints(false);
    if (!s._captureSuspendCheckpoint()) throw new Error('setup save failed');
  });
  const saved = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  const restore = async () => {
    // Leave the game first so nothing it saves on exit overwrites the fixture.
    await page.goto('/data/terrain.json');
    await page.evaluate((entries) => {
      localStorage.clear();
      for (const [key, value] of JSON.parse(entries)) localStorage.setItem(key, value);
    }, saved);
  };

  // Both runs resume the same save in landscape and play the same turns; one first
  // turns the phone upright and back (two presentation switches).
  await page.setViewportSize(landscape);
  const play = async (turnPhoneFirst) => {
    await restore();
    await resumeBattle(page);
    const resumed = await domainState(page);
    if (turnPhoneFirst) {
      await turnPhone(page, upright, 'ccw');
      await turnPhone(page, landscape, 'none');
    }
    const states = [await domainState(page)];
    for (let i = 0; i < 3; i++) {
      await endTurn(page);
      states.push(await domainState(page));
    }
    return { resumed, states };
  };
  const control = await play(false);
  const turned = await play(true);

  // The enemy phase resolved real attacks with rolls: the comparison is not vacuous.
  const hp = (s) => [...s.state.playerUnits, ...s.state.enemyUnits].map((u) => u.currentHP);
  expect(hp(control.states.at(-1))).not.toEqual(hp(control.states[0]));
  expect(turned.resumed).toEqual(control.resumed);
  for (let i = 0; i < control.states.length; i++)
    expect(turned.states[i], `after ${i} enemy phases`).toEqual(control.states[i]);
});
