import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

// Desktop battlefield parity, act moods (Atmosphere setting) and the restyled HUD.
test.use({ viewport: { width: 960, height: 720 } });
// Several tests boot the battle more than once.
test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  // Seed quiet settings once per tab so reloads keep what the test changed.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('presentation-seeded')) return;
    sessionStorage.setItem('presentation-seeded', '1');
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    );
  });
});

async function boot(page, query = '') {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1' + query);
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    if (b.battleState === 'DEPLOY_SELECTION')
      b.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')._battlefieldTerrain?.painted === true,
  );
}

test('desktop presents the shared battlefield art without the phone layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, '&labMap=mire_crossing');
  const result = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const tiles = b.grid.tiles.flat();
    return {
      lab: Boolean(document.querySelector('.battlefield-lab')),
      mobileHud: Boolean(b._mobileBattleHud),
      painted: tiles.filter((t) => t.texture?.key === b._battlefieldTerrain.key).length,
      total: tiles.length,
      unpaintedNames: tiles
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.texture?.key !== b._battlefieldTerrain.key && !t.list)
        .map(({ i }) => b.grid.getTerrainAt(i % b.grid.cols, Math.floor(i / b.grid.cols))?.name),
      sprites: [...b.playerUnits, ...b.enemyUnits].map((u) => u.graphic.texture.key),
      rings: [...b.playerUnits, ...b.enemyUnits].map((u) => u.factionIndicator.ringStyle),
    };
  });
  expect(result.lab).toBe(false);
  expect(result.mobileHud).toBe(false);
  expect(result.unpaintedNames).toEqual([]);
  expect(result.painted).toBe(result.total);
  // Contrast treatment everywhere; rebuilt art wherever the manifest has it (as on phones).
  for (const key of result.sprites) expect(key).toMatch(/^contrast-/);
  expect(result.sprites.some((key) => key.startsWith('contrast-rebuilt-'))).toBe(true);
  expect(result.rings).toContain('player');
  expect(result.rings).toContain('enemy');
  expect(errors).toEqual([]);
});

test('temporary terrain repaints through the shared seam and restores', async ({ page }) => {
  await boot(page, '&labMap=chokepoint');
  const result = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const painting = b._battlefieldTerrain;
    const unit = b.playerUnits[0];
    const col = unit.col + 1;
    const row = unit.row;
    const before = b.grid.mapLayout[row][col];
    b.grid.setTemporaryTerrain(col, row, 'Wall', 1, unit);
    const during = b.grid.tiles[row][col].texture.key;
    b.grid.clearTemporaryTerrainAt(col, row);
    return {
      restored: b.grid.mapLayout[row][col] === before,
      during,
      after: b.grid.tiles[row][col].texture.key,
      key: painting.key,
      revision: b.grid.terrainRevision,
    };
  });
  expect(result.restored).toBe(true);
  expect(result.during).toBe(result.key);
  expect(result.after).toBe(result.key);
  expect(result.revision).toBeGreaterThanOrEqual(2);
});

test('act moods follow the map and the Atmosphere setting applies live', async ({ page }) => {
  await boot(page, '&labMap=caldera');
  const read = () =>
    page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const a = b._atmosphere;
      const main = b.cameras.main;
      return {
        ...a.state,
        pipeline: main.postPipelines.some((p) => p.name === 'AtmosphereFX'),
        light: Boolean(a.light?.dark),
        uiCamera: Boolean(a.uiCamera),
        hudOnUi:
          a.uiCamera && b.turnCounterText
            ? b.turnCounterText.willRender(a.uiCamera) && !b.turnCounterText.willRender(main)
            : null,
        tileOnMain: b.grid.tiles[0][0].willRender(main),
      };
    });
  let state = await read();
  expect(state).toMatchObject({
    supported: true,
    mode: 'full',
    gradeKey: 'act4',
    night: true,
    pipeline: true,
    light: true,
    uiCamera: true,
  });
  await page.waitForTimeout(100);
  state = await read();
  expect(state.hudOnUi).toBe(true);
  expect(state.tileOnMain).toBe(true);

  await page.evaluate(() =>
    window.__emblemRogueGame.registry.get('settings').setAtmosphere('reduced'),
  );
  state = await read();
  expect(state).toMatchObject({ mode: 'reduced', pipeline: true, light: true });

  await page.evaluate(() => window.__emblemRogueGame.registry.get('settings').setAtmosphere('off'));
  state = await read();
  expect(state).toMatchObject({ mode: 'off', pipeline: false, light: false, uiCamera: false });

  await page.reload();
  await boot(page, '&labMap=caldera');
  state = await read();
  expect(state.mode).toBe('off');
});

test('atmosphere never advances the battle RNG', async ({ page }) => {
  const stateFor = async (mode) => {
    await boot(page, `&labMap=frozen_pass&atmosphereMode=${mode}`);
    return page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return { rng: b._battleRng.getState(), grade: b._atmosphere.state };
    });
  };
  const off = await stateFor('off');
  const full = await stateFor('full');
  expect(off.grade.mode).toBe('off');
  expect(full.grade).toMatchObject({ mode: 'full', gradeKey: 'rime', night: true });
  expect(full.rng).toEqual(off.rng);
});

test('night light layer follows movement and rewind, then shuts down cleanly', async ({ page }) => {
  await boot(page, '&labMap=magma_flow&atmosphereMode=full');
  const first = await page.evaluate(async () => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = b.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    b.registry.set('activeSlot', 1);
    setActiveSlot(1);
    b.runManager.visionChargesRemaining = 3;
    b._captureSuspendCheckpoint();
    const layer = b._atmosphere.light;
    const before = { ...layer.stats };
    const unit = b.playerUnits[0];
    b.selectUnit(unit);
    const dest = [...b.movementRange.entries()]
      .filter(([, entry]) => entry.stoppable !== false)
      .map(([k]) => k.split(',').map(Number))
      .find(([c, r]) => (c !== unit.col || r !== unit.row) && !b.getUnitAt(c, r));
    b.moveUnit(unit, dest[0], dest[1]);
    return { before, depth: layer.dark.depth };
  });
  expect(first.depth).toBeLessThan(4);
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
  );
  const moved = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return { ...b._atmosphere.light.stats };
  });
  expect(moved.unitRedraws).toBeGreaterThan(first.before.unitRedraws);
  // Idle frames redraw nothing.
  await page.waitForTimeout(500);
  const idle = await page.evaluate(() => ({
    ...window.__emblemRogueGame.scene.getScene('Battle')._atmosphere.light.stats,
  }));
  await page.waitForTimeout(500);
  const idle2 = await page.evaluate(() => ({
    ...window.__emblemRogueGame.scene.getScene('Battle')._atmosphere.light.stats,
  }));
  expect(idle2).toEqual(idle);
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').executeVisionRewind(),
    ),
  ).toBe(true);
  // The rewound unit is rebuilt at its start tile; the layer follows it.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const layer = window.__emblemRogueGame.scene.getScene('Battle')._atmosphere.light;
        return layer?.dark ? layer.stats.unitRedraws : -1;
      }),
    )
    .toBeGreaterThan(idle2.unitRedraws);
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    window.__leakKeys = { staticKey: b._atmosphere.light.staticKey };
    b.scene.stop();
  });
  await page.waitForFunction(
    () => !window.__emblemRogueGame.scene.getScene('Battle').sys.isActive(),
  );
  const leaks = await page.evaluate(() => {
    const textures = window.__emblemRogueGame.textures;
    return {
      staticTexture: textures.exists(window.__leakKeys.staticKey),
      terrainTextures: Object.keys(textures.list).filter((k) =>
        k.startsWith('battlefield-terrain-'),
      ).length,
    };
  });
  expect(leaks).toEqual({ staticTexture: false, terrainTextures: 0 });
});

test('desktop HUD plates keep every piece of information inside the frame', async ({ page }) => {
  await boot(page, '&labMap=river_crossing');
  const layout = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const box = (t) => {
      const r = t.getBounds();
      return { x: r.x, y: r.y, w: r.width, h: r.height, text: t.text, visible: t.visible };
    };
    return {
      turn: box(b.turnCounterText),
      eye: box(b.visionHudText),
      objective: box(b.objectiveText),
      buttons: [b.dangerButton, b.rosterButton, b.endTurnButton, b.cancelButton].map(box),
      hint: box(b.instructionText2),
      width: b.cameras.main.width,
      height: b.cameras.main.height,
      plates: Boolean(b._desktopHud?.plates),
    };
  });
  expect(layout.plates).toBe(true);
  expect(layout.turn.text).toMatch(/^Turn: 1 \/ Par: \d+ \([SABC]\)/);
  expect(layout.eye.text).toMatch(/^Eye: \d+ left this run$/);
  expect(layout.objective.text).toMatch(/^Rout:/);
  const all = [layout.turn, layout.eye, layout.objective, ...layout.buttons, layout.hint];
  for (const r of all.filter((r) => r.visible)) {
    expect(r.x, r.text).toBeGreaterThanOrEqual(0);
    expect(r.y, r.text).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w, r.text).toBeLessThanOrEqual(layout.width);
    expect(r.y + r.h, r.text).toBeLessThanOrEqual(layout.height);
  }
  const overlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  expect(overlap(layout.turn, layout.objective)).toBe(false);
  const bottom = [...layout.buttons, layout.hint].filter((r) => r.visible);
  for (let i = 0; i < bottom.length; i++)
    for (let j = i + 1; j < bottom.length; j++)
      expect(overlap(bottom[i], bottom[j]), `${bottom[i].text} × ${bottom[j].text}`).toBe(false);
  // Buttons stay clickable.
  const clicked = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    b.dangerButton.emit('pointerdown', { button: 0 });
    return b.dangerZone.visible;
  });
  expect(clicked).toBe(true);
});

test('every terrain type paints on desktop, including rebuilt temporary cells', async ({
  page,
}) => {
  await boot(page, '&labMap=corridor_siege');
  const result = await page.evaluate(async () => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const key = b._battlefieldTerrain.key;
    const painted = (col, row) => {
      const t = b.grid.tiles[row][col];
      const target = t.setTexture ? t : t.list?.find((c) => c.setTexture);
      return target?.texture?.key === key;
    };
    const missing = [];
    const unit = b.playerUnits[0];
    const col = Math.max(0, unit.col - 1);
    const row = unit.row;
    const original = b.grid.mapLayout[row][col];
    for (const terrain of b.grid.terrainData) {
      b.grid.setTemporaryTerrain(col, row, terrain.name, 1, null);
      await Promise.resolve();
      if (!painted(col, row)) missing.push(terrain.name);
      b.grid.clearTemporaryTerrainAt(col, row);
    }
    await Promise.resolve();
    return {
      missing,
      restored: b.grid.mapLayout[row][col] === original && painted(col, row),
      total: b.grid.terrainData.length,
    };
  });
  expect(result.total).toBeGreaterThanOrEqual(19);
  expect(result.missing).toEqual([]);
  expect(result.restored).toBe(true);
});

test('all ten lab maps paint every cell on desktop', async ({ page }) => {
  test.setTimeout(400_000);
  const seen = new Set();
  for (const map of [
    'river_crossing',
    'forest_ambush',
    'chokepoint',
    'corridor_siege',
    'castle_ruins',
    'mire_crossing',
    'frozen_pass',
    'glacier_run',
    'caldera',
    'magma_flow',
  ]) {
    await boot(page, `&labMap=${map}`);
    const r = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const key = b._battlefieldTerrain.key;
      const names = new Set();
      let unpainted = 0;
      b.grid.tiles.forEach((row, r) =>
        row.forEach((t, c) => {
          names.add(b.grid.getTerrainAt(c, r).name);
          const target = t.setTexture ? t : t.list?.find((x) => x.setTexture);
          if (target?.texture?.key !== key) unpainted += 1;
        }),
      );
      return { unpainted, names: [...names] };
    });
    expect(r.unpainted, map).toBe(0);
    r.names.forEach((n) => seen.add(n));
  }
  expect(seen.size).toBeGreaterThanOrEqual(10);
});
