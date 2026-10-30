// Darkest Before Dawn (docs/specs/survivors-mode.md): Home Base's web-only entry, the lord
// picker, a night on an upright phone (the stick moves the lord, a level-up stops the clock
// and its card is chosen by a tap), pause, the end of a night, and the trip back to Home Base.
import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'] });

const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }, testInfo) => {
  await page.screenshot({ path: testInfo.outputPath('final.png') });
  expect(pageErrors.get(page)).toEqual([]);
});

async function openNight(page, query = '&seed=7&lord=Edric') {
  await page.goto(`/?devScene=survivors${query}`);
  await waitForGame(page);
  await waitForScene(page, 'Survivors');
}

function nightState(page) {
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Survivors');
    const w = s?.world;
    return {
      mode: s?.mode,
      status: w?.status,
      t: w?.t ?? 0,
      x: w?.player.x,
      y: w?.player.y,
      level: w?.player.level,
      weapons: w?.player.weapons.length,
      passives: w?.player.passives.length,
    };
  });
}

/** Lay an XP shard under the lord: the next step collects it, as any shard is collected. */
async function dropXpOnLord(page, value) {
  await page.evaluate((value) => {
    const w = window.__emblemRogueGame.scene.getScene('Survivors').world;
    const pl = w.player;
    w.pickups.push({ id: w.nextId++, kind: 'xp', x: pl.x, y: pl.y, value, pulled: false });
  }, value);
}

/** Drag the floating stick from the screen's middle by (dx, dy) and hold it there. */
async function holdStick(page, dx, dy) {
  const root = page.getByTestId('survivors-root');
  const box = await root.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.6;
  const fire = (type, cx, cy) =>
    root.dispatchEvent(type, {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
    });
  await fire('pointerdown', x, y);
  await fire('pointermove', x + dx, y + dy);
  return () => fire('pointerup', x + dx, y + dy);
}

test('Home Base offers the night on the web, and the picker begins it', async ({ page }) => {
  await page.goto('/?devScene=homebase');
  await waitForGame(page);
  await waitForScene(page, 'HomeBase');
  const entry = page.getByRole('button', { name: 'Darkest Before Dawn', exact: true });
  await expect(entry).toBeVisible();
  await entry.tap();
  await waitForScene(page, 'Survivors');

  // a review route meets every lord; Home Base's own trip shows the picker first
  await expect(page.locator('.dbd-lord[data-lord="Edric"]')).toBeVisible();
  await page.locator('.dbd-lord[data-lord="Sera"]').tap();
  await expect(page.locator('.dbd-lord[data-lord="Sera"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('survivors-begin').tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors')?.mode === 'playing',
  );
  expect((await nightState(page)).status).toBe('playing');
  await expect(page.locator('.dbd-hud')).toBeVisible();
  // the clock runs down from ten minutes
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors').world.t > 0.5,
  );
  await expect(page.locator('.dbd-clock')).toHaveText(/^9:5\d$/);
});

test('the stick walks the lord, and a level-up stops the night for its card', async ({ page }) => {
  await openNight(page);
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors')?.mode === 'playing',
  );
  const start = await nightState(page);

  const release = await holdStick(page, 40, 0);
  await page.waitForFunction(
    (x0) => window.__emblemRogueGame.scene.getScene('Survivors').world.player.x > x0 + 20,
    start.x,
  );
  await release();
  const walked = await nightState(page);
  expect(walked.x).toBeGreaterThan(start.x + 20);
  expect(Math.abs(walked.y - start.y)).toBeLessThan(20);

  await dropXpOnLord(page, 6);
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors').mode === 'choosing',
  );
  const choosing = await nightState(page);
  expect(choosing.status).toBe('choosing');
  expect(choosing.level).toBe(2);
  await expect(page.locator('.dbd-panel h1')).toHaveText('Level 2');
  const card = page.getByTestId('survivors-choice-0');
  await expect(card).toBeVisible();

  // the clock holds while the card is up
  const heldAt = choosing.t;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  expect((await nightState(page)).t).toBe(heldAt);

  const offered = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Survivors').world.offer.choices[0],
  );
  await card.tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors').mode === 'playing',
  );
  const chosen = await nightState(page);
  expect(chosen.status).toBe('playing');
  // the tapped card is the one taken: its weapon or skill is held at the level it offered
  const held = await page.evaluate(({ kind, id }) => {
    const pl = window.__emblemRogueGame.scene.getScene('Survivors').world.player;
    const list = kind === 'weapon' ? pl.weapons : pl.passives;
    return list.find((entry) => entry.id === id)?.level ?? null;
  }, offered);
  if (offered.kind !== 'rest') expect(held).toBe(offered.level);
  await expect(page.locator('.dbd-panel')).toBeHidden();
});

test('pause holds the night; giving up ends it; Home Base takes the lord home', async ({
  page,
}) => {
  await openNight(page);
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors')?.mode === 'playing',
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors').mode === 'paused',
  );
  const pausedAt = (await nightState(page)).t;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  expect((await nightState(page)).t).toBe(pausedAt);

  await page.getByRole('button', { name: 'Resume', exact: true }).tap();
  await page.waitForFunction(
    (t) => window.__emblemRogueGame.scene.getScene('Survivors').world.t > t,
    pausedAt,
  );

  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await page.getByRole('button', { name: 'Give up the night', exact: true }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors').mode === 'over',
  );
  await expect(page.locator('.dbd-panel h1')).toHaveText('The night takes you');
  await expect(page.getByTestId('survivors-again')).toBeVisible();
  // the best night is kept on the device, per lord
  const { best, t } = await page.evaluate(() => ({
    best: JSON.parse(localStorage.getItem('emblem_rogue_survivors_best') || '{}'),
    t: window.__emblemRogueGame.scene.getScene('Survivors').world.t,
  }));
  expect(best.Edric).toBe(Math.floor(t));

  await page.getByRole('button', { name: 'Home Base', exact: true }).tap();
  await waitForScene(page, 'HomeBase');
  await expect(page.getByTestId('survivors-root')).toHaveCount(0);
  // the game's canvas is its own size again
  const size = await page.evaluate(() => {
    const g = window.__emblemRogueGame;
    return { w: g.scale.gameSize.width, h: g.scale.gameSize.height };
  });
  expect(size.w).toBeGreaterThan(0);
  expect(size.h).toBeGreaterThan(0);
});

test('Escape pauses on a keyboard, and the arrow keys move the lord', async ({ page }) => {
  await openNight(page);
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors')?.mode === 'playing',
  );
  const start = await nightState(page);
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(
    (y0) => window.__emblemRogueGame.scene.getScene('Survivors').world.player.y > y0 + 20,
    start.y,
  );
  await page.keyboard.up('ArrowDown');
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors').mode === 'paused',
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Survivors').mode === 'playing',
  );
});
