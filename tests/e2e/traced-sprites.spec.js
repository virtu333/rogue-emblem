import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

// Traced map sprites are the battlefield default (tools/art/sprite-trace): textures load,
// sit on the tile anchors, idle-animate, survive a rewind, share one atlas page, and
// the dev comparison ?spriteArt=rebuilt creates none of them.
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
});

async function toPlayerPhase(page) {
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
}

test('traced sprites use tile anchors, animate and stay aligned after rewind', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits?.length > 0,
  );
  await toPlayerPhase(page);
  const units = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return [...b.playerUnits, ...b.enemyUnits].map((u) => ({
      key: u.graphic.texture.key,
      width: u.graphic.displayWidth,
      height: u.graphic.displayHeight,
      x: u.graphic.x,
      y: u.graphic.y,
      pos: b.grid.gridToPixel(u.col, u.row),
    }));
  });
  for (const u of units) {
    expect(u.key, JSON.stringify(u)).toMatch(/^traced-/);
    expect(u.width).toBe(64);
    expect(u.height).toBe(64);
    expect(u.x).toBe(u.pos.x);
    expect(u.y).toBe(u.pos.y);
  }
  // idle frames advance at map tempo
  const frames = new Set();
  for (let i = 0; i < 6; i++) {
    frames.add(
      await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].graphic.frame.name,
      ),
    );
    await page.waitForTimeout(150);
  }
  expect(frames.size).toBeGreaterThan(1);
  // move, rewind: anchors hold and the acted tint still applies to traced textures
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
    b.selectUnit(b.playerUnits[0]);
    b.moveUnit(b.playerUnits[0], 7, 2);
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
  );
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').executeVisionRewind(),
    ),
  ).toBe(true);
  const after = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits[0];
    b.dimUnit(u);
    return {
      key: u.graphic.texture.key,
      x: u.graphic.x,
      pos: b.grid.gridToPixel(u.col, u.row),
      tinted: u.graphic.isTinted,
    };
  });
  expect(after.key).toMatch(/^traced-/);
  expect(after.x).toBe(after.pos.x);
  expect(after.tinted).toBe(true);
});

test('?spriteArt=rebuilt creates no traced textures and loads no atlas page', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1&spriteArt=rebuilt');
  await waitForScene(page, 'Battle');
  const keys = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      traced: Object.keys(window.__emblemRogueGame.textures.list).filter((k) =>
        k.startsWith('traced-'),
      ),
      units: [...b.playerUnits, ...b.enemyUnits].map((u) => u.graphic.texture.key),
    };
  });
  expect(keys.traced).toEqual([]);
  expect(keys.units.some((k) => k.startsWith('contrast-rebuilt-'))).toBe(true);
});

test('every class, faction, lord and boss resolves to a traced texture on the shared pages', async ({
  page,
}) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  const result = await page.evaluate(() => {
    const game = window.__emblemRogueGame;
    const b = game.scene.getScene('Battle');
    const { classes, lords, enemies } = b.gameData;
    const lordClasses = new Set(lords.flatMap((l) => [l.class, l.promotedClass]));
    const probes = [];
    for (const c of classes) {
      if (lordClasses.has(c.name)) continue;
      if (c.tier === 'boss') {
        probes.push({ name: 'x', className: c.name, faction: 'enemy' });
        continue;
      }
      probes.push({ name: 'Aldo', className: c.name, faction: 'player' });
      probes.push({ name: 'x', className: c.name, faction: 'enemy' });
      probes.push({ name: 'x', className: c.name, faction: 'enemy', affixes: ['vampiric'] });
    }
    for (const l of lords) {
      probes.push({ name: l.name, className: l.class, faction: 'player', isLord: true });
      probes.push({
        name: l.name,
        className: l.promotedClass,
        faction: 'player',
        isLord: true,
        tier: 'promoted',
      });
    }
    for (const boss of Object.values(enemies.bosses).flat())
      probes.push({ name: boss.name, className: boss.className, faction: 'enemy', isBoss: true });
    const sources = new Set();
    const bad = [];
    for (const p of probes) {
      const key = b.getSpriteKey(p);
      const t = game.textures.get(key);
      const f = t?.get('idle0');
      if (!key.startsWith('traced-') || !f || t.getFrameNames().length !== 6) bad.push([p, key]);
      else {
        sources.add(t.source[0]);
        // trimmed frame, logical square texture (96 px, the Entity 192)
        if (![96, 192].includes(f.realWidth) || f.realHeight !== f.realWidth) bad.push([p, key]);
      }
    }
    return {
      probes: probes.length,
      bad,
      sources: sources.size,
      pages: Object.keys(game.textures.list).filter((k) => k.startsWith('traced-page-')).length,
    };
  });
  expect(result.probes).toBeGreaterThan(120);
  expect(result.bad).toEqual([]);
  // no per-sprite canvases: every traced texture borrows one of the few atlas pages
  expect(result.pages).toBeGreaterThan(0);
  expect(result.pages).toBeLessThanOrEqual(3);
  expect(result.sources).toBeLessThanOrEqual(result.pages);
});
