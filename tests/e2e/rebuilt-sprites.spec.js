import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
});
test('rebuilt sprites load with tile anchors and remain aligned after rewind', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits?.length > 0,
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
  await page.evaluate(async () => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = b.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    b.registry.set('activeSlot', 1);
    setActiveSlot(1);
    b.runManager.visionChargesRemaining = 3;
    b._captureSuspendCheckpoint();
    if (!b.runManager.battleInProgress) throw new Error('Missing battle checkpoint');
    b.selectUnit(b.playerUnits[0]);
    b.moveUnit(b.playerUnits[0], 7, 2);
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
  );
  const moved = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle'),
      u = b.playerUnits[0];
    return { col: u.col, x: u.graphic.x, expected: b.grid.gridToPixel(7, 2).x };
  });
  expect(moved.col).toBe(7);
  expect(moved.x).toBe(moved.expected);
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').executeVisionRewind(),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].col),
  ).toBe(6);
  const result = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return [...b.playerUnits, ...b.enemyUnits].map((u) => ({
      name: u.name,
      className: u.className,
      key: u.graphic.texture.key,
      width: u.graphic.displayWidth,
      x: u.graphic.x,
      y: u.graphic.y,
      pos: b.grid.gridToPixel(u.col, u.row),
    }));
  });
  for (const u of result) {
    expect(u.key, JSON.stringify(u)).toMatch(/^contrast-rebuilt-/);
    expect(u.width).toBe(64);
    expect(u.x).toBe(u.pos.x);
    expect(u.y).toBe(u.pos.y);
  }
});
test('classic comparison does not load rebuilt textures', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1&spriteArt=classic');
  await waitForScene(page, 'Battle');
  expect(
    await page.evaluate(() =>
      Object.keys(window.__emblemRogueGame.textures.list).filter(
        (k) => k.startsWith('rebuilt-') && !k.startsWith('rebuilt-portrait-'),
      ),
    ),
  ).toEqual([]);
});

test('flyers and mages share visible size and foot anchors across factions', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  const result = await page.evaluate(async () => {
    const { contrastSpriteKey } = await import('/src/ui/BattleContrast.js');
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const probes = [
      ['Enemy wyvern', 'Wyvern Rider', 'enemy'],
      ['Enemy wyvern lord', 'Wyvern Lord', 'enemy'],
      ['Enemy pegasus', 'Pegasus Knight', 'enemy'],
      ['Enemy falcon', 'Falcon Knight', 'enemy'],
      ['Astrid', 'Sky Lancer', 'player', true],
      ['Astrid', 'Seraph Knight', 'player', true, 'promoted'],
      ['Player wyvern', 'Wyvern Rider', 'player'],
      ['Player pegasus', 'Pegasus Knight', 'player'],
      ['Enemy mage', 'Mage', 'enemy'],
      ['Player mage', 'Mage', 'player'],
      ['Player fighter', 'Fighter', 'player'],
      ['Enemy knight', 'Knight', 'enemy'],
      ['Sera', 'Light Sage', 'player', true],
    ];
    const sheet = document.createElement('div');
    sheet.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#10212b;color:white;display:grid;grid-template-columns:repeat(5,1fr);font:14px sans-serif;gap:4px;padding:12px';
    document.body.append(sheet);
    return probes.map(([name, className, faction, isLord, tier]) => {
      const key = b.getSpriteKey({ name, className, faction, isLord, tier });
      const source = b.textures.get(contrastSpriteKey(b, key)).getSourceImage();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, 64, 64).data;
      let left = 64,
        top = 64,
        right = 0,
        bottom = 0;
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          if (!pixels[(y * 64 + x) * 4 + 3]) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      const cell = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = name + (tier ? ' promoted' : '');
      // Original 32px tile in the center of each 64px tile-anchored texture.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#697665';
      ctx.fillRect(16, 16, 32, 32);
      ctx.strokeStyle = '#a9b39c';
      ctx.strokeRect(16.5, 16.5, 31, 31);
      canvas.style.cssText = 'width:128px;height:128px;image-rendering:pixelated';
      cell.append(title, canvas);
      sheet.append(cell);
      return { name, key, width: right - left + 1, height: bottom - top + 1, bottom };
    });
  });
  for (const unit of result) {
    expect(unit.key).toMatch(/^rebuilt-/);
    expect(unit.bottom, JSON.stringify(unit)).toBeGreaterThanOrEqual(43);
    expect(unit.bottom, JSON.stringify(unit)).toBeLessThanOrEqual(44);
    expect(unit.height, JSON.stringify(unit)).toBeLessThanOrEqual(
      unit.name === 'Enemy knight' ? 38 : unit.name.includes('mage') ? 32 : 36,
    );
    expect(unit.width, JSON.stringify(unit)).toBeLessThanOrEqual(42);
  }
  await page.screenshot({ path: '/tmp/sprite-size-comparison.png' });
});
