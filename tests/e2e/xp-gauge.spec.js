// The battle's EXP gauge through real kills (docs/specs/exp-bars.md §2, §4): the gilt
// bar beside the unit that gained, filling from its old XP to its new XP, wrapping into
// the level-up card. Failure modes each check is written to catch:
//   1. no gauge after a kill, or one whose count ends somewhere other than the XP the
//      battle saved (the gauge drawing its own idea of the gain);
//   2. the fill skipped at Normal speed, or played at Instant (a stale timing table);
//   3. a wrap that opens the level card over the gauge, or before it closes;
//   4. a tap that does not skip, or that takes the level card down with the gauge;
//   5. Fast ignored (the planned fill and hold not halved, or the gauge outliving them);
//   6. the gauge outside the map frame, over the rail or away from the unit.
// A MutationObserver records the gauge as it opens, counts and closes, so every check
// reads what was on screen without racing its timers.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test.setTimeout(120_000);
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15_000);
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
});

function collect(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function battle(page, { speed = 'normal', reduceMotion = false } = {}) {
  await page.addInitScript(
    (extra) =>
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, ...extra }),
      ),
    { battleSpeed: speed, reduceMotion },
  );
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  await idle(page);
  // A slot, so the battle's checkpoints reach storage (the saved XP the gauge must match).
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

const idle = (page) =>
  page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
    null,
    { timeout: 30_000 },
  );

/**
 * Edric beside a 1 HP foe he cannot miss, `levels` above him (70 XP for a kill six
 * levels up: 25 + 6 × 5 + 15), with `xp` held. Returns Edric's XP and level before.
 */
async function stageKill(page, { xp, levels = 6 }) {
  return page.evaluate(
    ({ xp, levels }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((p) => p.name === 'Edric');
      u.xp = xp;
      u.stats.STR = 999;
      u.weapon.hit = 999;
      const enemy = s.enemyUnits[0];
      const tile = [
        [u.col + 1, u.row],
        [u.col - 1, u.row],
        [u.col, u.row + 1],
        [u.col, u.row - 1],
      ].find(
        ([col, row]) =>
          col >= 0 && row >= 0 && col < s.grid.cols && row < s.grid.rows && !s.getUnitAt(col, row),
      );
      [enemy.col, enemy.row] = tile;
      enemy.name = 'Gauge Target';
      enemy.level = u.level + levels;
      enemy.tier = 'base';
      enemy.currentHP = 1;
      enemy.skills = [];
      enemy.affixes = [];
      s.grid.setTerrainAt(enemy.col, enemy.row, 0);
      s.updateUnitPosition(enemy);
      s.updateHPBar(enemy);
      return { xp: u.xp, level: u.level };
    },
    { xp, levels },
  );
}

/** Record every gauge (open: geometry and plan; each count; close) and level card. */
async function watchGauge(page) {
  await page.evaluate(() => {
    const events = [];
    window.__xg = events;
    const rect = (node) => {
      const r = node?.getBoundingClientRect?.();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    };
    const tileOf = (name) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((p) => p.name === name);
      if (!u) return null;
      const c = s.grid.gridToPixel(u.col, u.row);
      const r = s.game.canvas.getBoundingClientRect();
      const a = s._worldToScreen(c.x - 16, c.y - 16);
      const b = s._worldToScreen(c.x + 16, c.y + 16);
      const y = (p) => r.top + (p.y * r.height) / s.scale.height;
      return { top: Math.min(y(a), y(b)), bottom: Math.max(y(a), y(b)) };
    };
    // Every click, seen before anything can swallow it (window, capture phase).
    window.addEventListener('click', () => events.push({ type: 'click', t: performance.now() }), true); // prettier-ignore
    new MutationObserver((records) => {
      const t = performance.now();
      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.target.classList?.contains('xg-track'))
            events.push({ type: 'value', t, v: Number(record.target.getAttribute('aria-valuenow')) }); // prettier-ignore
          continue;
        }
        for (const node of record.addedNodes) {
          if (!node.classList) continue;
          if (node.classList.contains('xg-layer')) {
            const track = node.querySelector('.xg-track');
            events.push({
              type: 'open',
              t,
              v: Number(track.getAttribute('aria-valuenow')),
              plus: node.querySelector('.xg-plus').textContent,
              fillMs: Number(node.dataset.fillMs),
              holdMs: Number(node.dataset.holdMs),
              isStatic: node.classList.contains('is-static'),
              side: node.querySelector('.xg-gauge').dataset.side,
              gauge: rect(node.querySelector('.xg-gauge')),
              frame: rect(node),
              rail: rect(document.querySelector('.mobile-battle-hud')),
              tile: tileOf('Edric'),
              depth: Number(node.style.zIndex),
            });
          }
          if (node.classList.contains('gr-level-layer')) events.push({ type: 'card', t });
        }
        for (const node of record.removedNodes) {
          if (!node.classList?.contains('xg-layer')) continue;
          const track = node.querySelector('.xg-track');
          events.push({ type: 'close', t, v: Number(track.getAttribute('aria-valuenow')) });
        }
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-valuenow'],
    });
  });
}

const events = (page) => page.evaluate(() => window.__xg);
const closed = (page) =>
  page.waitForFunction(() => window.__xg?.some((e) => e.type === 'close'), null, {
    timeout: 30_000,
  });

async function tapUnit(page, name, group = 'playerUnits') {
  const p = await page.evaluate(
    ({ name, group }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s[group].find((u) => u.name === name);
      const w = s.grid.gridToPixel(u.col, u.row),
        p = s._worldToScreen(w.x, w.y);
      const r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { name, group },
  );
  await page.touchscreen.tap(p.x, p.y);
}

async function attack(page) {
  await tapUnit(page, 'Edric');
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
  await tapUnit(page, 'Gauge Target', 'enemyUnits');
  await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
}

/** Edric's XP now, and as the battle's last checkpoint saved it. */
const savedXp = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null');
    const saved = run?.battleInProgress?.checkpoint?.playerUnits?.find((u) => u.name === 'Edric');
    return { live: s.playerUnits.find((p) => p.name === 'Edric').xp, saved: saved?.xp ?? null };
  });

test('a real kill fills the gauge beside the unit; its count ends at the saved XP', async ({
  page,
}) => {
  const errors = collect(page);
  await battle(page);
  const before = await stageKill(page, { xp: 0 });
  await watchGauge(page);
  await attack(page);
  await closed(page);
  await idle(page);
  const log = await events(page);
  const open = log.find((e) => e.type === 'open');
  const close = log.find((e) => e.type === 'close');
  const xp = await savedXp(page);
  expect(xp.saved).toBe(xp.live);
  const gained = xp.live - before.xp;
  expect(gained).toBeGreaterThan(30);
  // Opens at the XP held, counts up in steps (Normal speed fills), ends at the saved XP.
  expect(open).toMatchObject({ v: 0, plus: `+${gained}`, isStatic: false, holdMs: 350 });
  expect(open.fillMs).toBe(Math.round(gained * 9));
  const counts = log.filter((e) => e.type === 'value').map((e) => e.v);
  expect(new Set(counts).size).toBeGreaterThan(3);
  expect(counts).toEqual([...counts].sort((a, b) => a - b));
  expect(counts.at(-1)).toBe(xp.saved);
  expect(close.v).toBe(xp.saved);
  // The fill and hold both played (the gauge never closes early on its own).
  expect(close.t - open.t).toBeGreaterThanOrEqual(open.fillMs + open.holdMs - 50);
  // Over the map, under the menus; inside the frame, beside Edric's tile, off the rail.
  expect(open.depth).toBe(960);
  expect(open.gauge.left).toBeGreaterThanOrEqual(open.frame.left - 1);
  expect(open.gauge.right).toBeLessThanOrEqual(open.frame.right + 1);
  expect(open.gauge.top).toBeGreaterThanOrEqual(open.frame.top - 1);
  expect(open.gauge.bottom).toBeLessThanOrEqual(open.frame.bottom + 1);
  if (open.rail) expect(open.gauge.right).toBeLessThanOrEqual(open.rail.left + 1);
  if (open.side === 'below') expect(open.gauge.top).toBeGreaterThanOrEqual(open.tile.bottom - 1);
  else expect(open.gauge.bottom).toBeLessThanOrEqual(open.tile.top + 1);
  // No card: the gain did not wrap.
  expect(log.some((e) => e.type === 'card')).toBe(false);
  expect(errors).toEqual([]);
});

test('a wrap fills to 100 and hands off to the level card once the gauge closes', async ({
  page,
}) => {
  const errors = collect(page);
  await battle(page);
  const before = await stageKill(page, { xp: 99, levels: 0 });
  await watchGauge(page);
  await attack(page);
  const card = page.getByRole('dialog', { name: 'Level up', exact: true });
  await expect(card).toBeVisible({ timeout: 25_000 });
  const log = await events(page);
  const order = log.filter((e) => ['open', 'close', 'card'].includes(e.type)).map((e) => e.type);
  expect(order).toEqual(['open', 'close', 'card']);
  // The count reached 100 (the wrap) before it ran on at the new level.
  const counts = log.filter((e) => e.type === 'value').map((e) => e.v);
  expect(counts).toContain(100);
  const level = await page.evaluate(
    () =>
      window.__emblemRogueGame.scene.getScene('Battle').playerUnits.find((p) => p.name === 'Edric')
        .level,
  );
  expect(level).toBe(before.level + 1);
  expect(log.find((e) => e.type === 'close').v).toBe((await savedXp(page)).live);
  await card
    .getByRole('button', { name: /^(Continue|Reveal gains)$/ })
    .first()
    .tap();
  if (await card.count()) await card.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(card).toHaveCount(0);
  await idle(page);
  expect(errors).toEqual([]);
});

test('a tap skips the gauge to its end and hands off to the level card', async ({ page }) => {
  const errors = collect(page);
  await battle(page);
  // 50 + 70: a wrap and 20 more, about 1.3 s of gauge at Normal speed.
  await stageKill(page, { xp: 50 });
  await watchGauge(page);
  await attack(page);
  await page.locator('.xg-layer').waitFor({ state: 'attached', timeout: 25_000 });
  const frame = await page.locator('.xg-layer').boundingBox();
  const tappedAt = await page.evaluate(() => performance.now());
  await page.touchscreen.tap(frame.x + frame.width / 2, frame.y + 12);
  await closed(page);
  const card = page.getByRole('dialog', { name: 'Level up', exact: true });
  await expect(card).toBeVisible();
  const log = await events(page);
  const open = log.find((e) => e.type === 'open');
  const close = log.find((e) => e.type === 'close');
  // Skipped: closed before its fill and hold could end, at the end state.
  expect(close.t - open.t).toBeLessThan(open.fillMs + open.holdMs);
  expect(close.v).toBe((await savedXp(page)).live);
  // The card the skip handed off to is still up after the tap's lift (and its click,
  // when the browser makes one: the gesture's events have all been delivered by the
  // time tap() returns): the tap skipped the gauge only.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(card).toBeVisible();
  const clicks = (await events(page)).filter((e) => e.type === 'click' && e.t > tappedAt);
  expect(clicks.length).toBeLessThanOrEqual(1);
  await card
    .getByRole('button', { name: /^(Continue|Reveal gains)$/ })
    .first()
    .tap();
  if (await card.count()) await card.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(card).toHaveCount(0);
  await idle(page);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit),
  ).toBeFalsy();
  expect(errors).toEqual([]);
});

test('Instant shows the end state at once and holds it', async ({ page }) => {
  const errors = collect(page);
  await battle(page, { speed: 'instant' });
  const before = await stageKill(page, { xp: 0 });
  await watchGauge(page);
  await attack(page);
  await closed(page);
  await idle(page);
  const log = await events(page);
  const open = log.find((e) => e.type === 'open');
  const close = log.find((e) => e.type === 'close');
  const xp = (await savedXp(page)).live;
  expect(open).toMatchObject({ isStatic: true, fillMs: 0, holdMs: 400, v: xp });
  expect(open.plus).toBe(`+${xp - before.xp}`);
  // No count between open and close: nothing filled.
  expect(log.filter((e) => e.type === 'value' && e.t > open.t && e.t < close.t)).toEqual([]);
  expect(close.t - open.t).toBeGreaterThanOrEqual(350);
  expect(errors).toEqual([]);
});

test('Fast halves the fill and hold and closes within them', async ({ page }) => {
  const errors = collect(page);
  await battle(page, { speed: 'fast' });
  const before = await stageKill(page, { xp: 0 });
  await watchGauge(page);
  await attack(page);
  await closed(page);
  await idle(page);
  const log = await events(page);
  const open = log.find((e) => e.type === 'open');
  const close = log.find((e) => e.type === 'close');
  const gained = (await savedXp(page)).live - before.xp;
  // 100 XP per 450 ms, a 175 ms hold.
  expect(open).toMatchObject({ isStatic: false, holdMs: 175 });
  expect(open.fillMs).toBe(Math.round(gained * 4.5));
  const elapsed = close.t - open.t;
  expect(elapsed).toBeGreaterThanOrEqual(open.fillMs + open.holdMs - 50);
  // Well inside what Normal would take (gained × 9 + 350 ms), with room for a slow frame.
  expect(elapsed).toBeLessThan(gained * 9 + 350 + 1000);
  expect(errors).toEqual([]);
});
