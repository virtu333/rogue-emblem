import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

// Dev-only review switch ?spriteArt=traced (tools/art/sprite-trace): traced textures load,
// sit on the same tile anchors as the rebuilt ones, idle-animate, and survive a rewind.
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
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1&spriteArt=traced');
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

test('without the flag no traced textures are created', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  expect(
    await page.evaluate(() =>
      Object.keys(window.__emblemRogueGame.textures.list).filter((k) => k.startsWith('traced-')),
    ),
  ).toEqual([]);
});
