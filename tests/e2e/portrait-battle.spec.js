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
// each whole, labelled, unbroken and tappable, from a small phone to a large one. End turn
// takes Wait's place there while no unit menu is open: in the scrolling stack, a tile's
// terrain pushed it under the fold at 375x667 (playtest 2026-09-26).
for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`upright rail keeps End turn, Wait, Danger and the tools whole at ${viewport.width}x${viewport.height}`, async ({
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
    // Idle, with a tile's terrain in the rail: End turn beside Danger, and the commands
    // above stay whole inside the scrolling stack.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits[0];
      s._inputController.refreshTileInfo(u.col, u.row);
    });
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await expect(hud.locator('.mb-terrain-slot')).not.toBeEmpty();
    await expect.poll(async () => (await bottomRow(page)).length).toBe(6);
    expectWholeRow(await bottomRow(page), ['End turn…', 'Danger', ...tools]);
    const stack = await page.evaluate(() => {
      const body = document.querySelector('.mobile-battle-hud .mb-body').getBoundingClientRect();
      return [...document.querySelectorAll('.mobile-battle-hud .mb-body .mb-command-row > button')]
        .map((b) => b.getBoundingClientRect())
        .map((r) => r.top >= body.top - 0.5 && r.bottom <= body.bottom + 0.5);
    });
    expect(stack).toEqual([true, true, true]);
    await expect(hud.locator('.mb-body .mb-end-turn')).toHaveCount(0);
    // A real tap on the docked End turn asks to confirm; Keep playing returns to idle.
    await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
    await expect(hud.getByRole('button', { name: 'End turn now', exact: true })).toBeVisible();
    await hud.getByRole('button', { name: 'Keep playing', exact: true }).tap();
    await expect
      .poll(async () => (await bottomRow(page)).map((c) => c.name))
      .toEqual(['End turn…', 'Danger', ...tools]);

    // Support's six-command menu (Guidance Full keeps a greyed Attack): Wait is pinned.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((p) => p.name === 'Support');
      s.selectUnit(u);
      s.showActionMenu(u);
    });
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
    expectWholeRow(await bottomRow(page), ['End turn…', 'Danger · pinned', ...tools]);
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

test('portrait mode: the title and save slots show upright and follow the phone', async ({
  page,
}) => {
  await page.goto('/?portrait=1');
  await waitForScene(page, 'Title');
  const prompt = page.locator('#rotate-prompt');
  const slots = page
    .getByRole('button', { name: /^Save Slots|^New Game|^Start First Run/ })
    .first();
  await expect(page.locator('html')).toHaveClass(/(^|\s)portrait-ui(\s|$)/);
  await expect(prompt).toBeHidden();
  await expect(slots).toBeInViewport();
  // Turned to landscape the page is the landscape game; upright again, portrait mode.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)portrait-ui(\s|$)/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).toHaveClass(/(^|\s)portrait-ui(\s|$)/);
  await expect(prompt).toBeHidden();
  // Opting out brings the rotate prompt back at once.
  await page.evaluate(async () => {
    const { setPortraitBattlePreference } = await import('/src/utils/portraitBattle.js');
    setPortraitBattlePreference(false);
  });
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)portrait-ui(\s|$)/);
  await expect(prompt).toBeVisible();
});

test('without the opt-in an upright phone still asks for landscape', async ({ page }) => {
  // A landscape board under the rotate prompt resolves turn start slowly (~6s alone).
  test.setTimeout(90_000);
  await bootBattle(page, '&portrait=0');
  const info = await page.evaluate(() => ({
    rotation: window.__emblemRogueGame.scene.getScene('Battle').grid.board.rotation,
    prompt: getComputedStyle(document.getElementById('rotate-prompt')).display,
  }));
  expect(info).toEqual({ rotation: 'none', prompt: 'flex' });
});

// Where portrait mode is offered. A phone turns upright in the browser tab, the
// installed web app (the manifest asks for any orientation) and the iPhone app
// (Info.plist allows portrait on iPhone). The iPad app stays in landscape
// (UISupportedInterfaceOrientations~ipad), so there a stored "on" changes nothing: no
// Settings toggle, the board is not turned and the rotate prompt shows. Nothing clears
// the stored choice (the installed web app shares storage with the browser tab).
const capacitor = () => {
  window.Capacitor = {
    nativePromise: () => Promise.reject(new Error('no native bridge in this test')),
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    PluginHeaders: [],
  };
};
const SHELLS = {
  'browser tab': { offered: true, install: () => {} },
  'installed web app': {
    offered: true,
    install: () => {
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        /display-mode/.test(query)
          ? {
              matches: query === '(display-mode: standalone)',
              media: query,
              onchange: null,
              addEventListener() {},
              removeEventListener() {},
              addListener() {},
              removeListener() {},
            }
          : matchMedia(query);
    },
  },
  'iPhone app': { offered: true, install: capacitor },
  'iPad app': {
    offered: false,
    install: () => {
      // An iPad's screen (short side 820), whatever the test viewport.
      Object.defineProperty(window.screen, 'width', { get: () => 820 });
      Object.defineProperty(window.screen, 'height', { get: () => 1180 });
      window.Capacitor = {
        nativePromise: () => Promise.reject(new Error('no native bridge in this test')),
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        PluginHeaders: [],
      };
    },
  },
};
for (const [shell, { offered, install }] of Object.entries(SHELLS)) {
  test(`portrait mode in the ${shell}: toggle and stored choice`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(install);
    await page.addInitScript(() => localStorage.setItem('emblem_rogue_portrait_battles', 'on'));
    await bootBattle(page, '');
    const info = await page.evaluate(() => ({
      rotation: window.__emblemRogueGame.scene.getScene('Battle').grid.board.rotation,
      prompt: getComputedStyle(document.getElementById('rotate-prompt')).display,
      portraitUi: document.documentElement.classList.contains('portrait-ui'),
      capable: document.documentElement.classList.contains('portrait-battle-capable'),
      stored: localStorage.getItem('emblem_rogue_portrait_battles'),
    }));
    expect(info).toEqual({
      rotation: offered ? 'ccw' : 'none',
      prompt: offered ? 'none' : 'flex',
      portraitUi: offered,
      capable: offered,
      stored: 'on',
    });
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { SettingsMenu } = await import('/src/ui/SettingsMenu.js');
      window.shellSettings = new SettingsMenu(s, () => window.shellSettings.destroy());
    });
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settings.getByRole('button', { name: /^Reduce motion/ })).toHaveCount(1);
    await expect(settings.getByRole('button', { name: /^Portrait mode/ })).toHaveCount(
      offered ? 1 : 0,
    );
    await expect(settings.getByRole('button', { name: /beta/i })).toHaveCount(0);
  });
}

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

// A unit on an intact village: the upright rail's pinned Wait carries "Visits village"
// (playtest 2026-09-26: no Visit command, so only Waiting revealed the rule) and the
// bottom row stays six whole, unbroken controls.
async function edricOnVillage(page) {
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((p) => p.name === 'Edric');
    const pos = { col: u.col, row: u.row };
    s.battleConfig.villageTile = pos;
    s._villageState = { ...pos, status: 'intact' };
    s.grid.setTerrainAt(
      pos.col,
      pos.row,
      s.gameData.terrain.findIndex((t) => t.name === 'Village'),
    );
    s._villageController._renderMarker();
    s.updateObjectiveText();
    s.selectUnit(u);
    s.showActionMenu(u);
  });
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  test(`upright Wait notes the village visit at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto('/?devScene=battle&preset=combat_actions&seed=42&portrait=1');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
    await edricOnVillage(page);
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await expect(hud.locator('.mb-dock .mb-pinned-command .mb-item-note')).toHaveText(
      'Visits village',
    );
    await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toHaveCount(1);
    // The note sits inside Wait, unbroken; the row keeps all six controls whole.
    expectWholeRow(await bottomRow(page), [
      'Wait',
      'Danger',
      'Overview',
      'Recenter',
      'Back',
      'Menu',
    ]);
  });
}

// Battle details opens as a panel over the map. Landscape anchors it left of the side
// rail; upright, that anchor put it past the left screen edge and over the commands
// (playtest 2026-09-26, 390x844, Edric on a village). It must stay on screen, clear of
// the rail, with every rail control still reachable.
function detailsPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.mb-battle-info[open] > .mb-more-content');
    const rail = document.querySelector('.mobile-battle-hud').getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const covered = [...document.querySelectorAll('.mb-dock > button, .bl-tools > button')]
      .filter((button) => {
        const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(hit && button.contains(hit));
      })
      .map((button) => button.getAttribute('aria-label') || button.innerText.trim());
    return {
      onScreen:
        p.left >= -0.5 &&
        p.top >= -0.5 &&
        p.right <= innerWidth + 0.5 &&
        p.bottom <= innerHeight + 0.5,
      clearOfRail: p.bottom <= rail.top + 0.5,
      readable: p.width >= 200 && panel.scrollWidth <= panel.clientWidth + 1,
      covered,
    };
  });
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`upright Battle details stays on screen and clear of the rail at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto('/?devScene=battle&preset=combat_actions&seed=42&portrait=1');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
    const summary = page.locator('.mb-battle-info > summary');
    const panel = page.locator('.mb-more-content');
    const expected = { onScreen: true, clearOfRail: true, readable: true, covered: [] };

    // Idle rail.
    await summary.tap();
    await expect(panel).toBeVisible();
    await expect.poll(() => detailsPanel(page)).toEqual(expected);
    await summary.tap();
    await expect(panel).toBeHidden();

    // The playtest's state: Edric on an intact village, his action menu open.
    await edricOnVillage(page);
    await summary.tap();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Vision');
    await expect.poll(() => detailsPanel(page)).toEqual(expected);
    if (viewport.width === 390)
      await page.screenshot({ path: testInfo.outputPath('portrait-battle-details.png') });
  });
}
test('an upright battle stays upright through its rewards', async ({ page }) => {
  await bootBattle(page);
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible({ timeout: 15_000 });
  const info = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const html = document.documentElement.classList;
    return {
      rotation: b.grid.board.rotation,
      upright: html.contains('portrait-battle'),
      capable: html.contains('portrait-battle-capable'),
      tallCanvas: b.scale.height > b.scale.width,
      prompt: getComputedStyle(document.getElementById('rotate-prompt')).display,
    };
  });
  expect(info).toEqual({
    rotation: 'ccw',
    upright: true,
    capable: true,
    tallCanvas: true,
    prompt: 'none',
  });
});

test('rewind previews draw the board the way the upright battle does', async ({ page }) => {
  await bootBattle(page);
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    b.runManager.visionChargesRemaining = 3;
    const u = b.playerUnits.find((x) => !x.hasActed);
    b.selectUnit(u);
    b.showActionMenu(u);
  });
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  await hud.getByRole('button', { name: 'Rewind', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Rewind', exact: true })).toBeVisible();
  // The preview's history scene draws each unit at its turned display cell.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const game = window.__emblemRogueGame;
        const history = game.scene.scenes.find((s) =>
          s.sys.settings.key.startsWith('BattleHistory-'),
        );
        return history?.renderer?.units?.size || 0;
      }),
    )
    .toBeGreaterThan(0);
  const drawn = await page.evaluate(() => {
    const game = window.__emblemRogueGame;
    const b = game.scene.getScene('Battle');
    const history = game.scene.scenes.find((s) => s.sys.settings.key.startsWith('BattleHistory-'));
    return b.playerUnits.map((u) => {
      const d = b.grid.board.toDisplay(u.col, u.row);
      const group = history.renderer.units.get(u.battleEntityId);
      return {
        expected: [(d.col + 0.5) * 32, (d.row + 0.5) * 32],
        drawn: group ? [group.x, group.y] : null,
      };
    });
  });
  expect(drawn.length).toBeGreaterThan(0);
  for (const unit of drawn) expect(unit.drawn).toEqual(unit.expected);
});
