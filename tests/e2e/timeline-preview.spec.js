// Playtest 2026-09-25 (Alex, desktop): the Battle timeline fell back to the
// "lo fi" text sketch. After several turns (enemy phases included), a rewind
// branch with more actions after it, and a reload, every history row must
// still draw the real battlefield, on desktop 1280×800 and 1440×900 @2x.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.setTimeout(180_000);

const SHOTS = 'docs/art-direction/gameplay/playtest-fixes';

async function idle(page) {
  for (let i = 0; i < 240; i++) {
    const ok = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return s?.turnManager?.currentPhase === 'player' && s.battleState === 'PLAYER_IDLE';
    });
    if (ok) return;
    const cont = page.getByRole('button', { name: 'Continue', exact: true });
    if (await cont.count())
      await cont
        .first()
        .click()
        .catch(() => {});
    await page.waitForTimeout(250);
  }
  throw new Error('battle never returned to an idle player phase');
}

async function boot(page, query = '') {
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: 'instant' }),
    ),
  );
  await page.goto(`/?devScene=battle&preset=battle_smoke&seed=42${query}`);
  await waitForScene(page, 'Battle');
  await idle(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = s.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    s.registry.set('activeSlot', 1);
    setActiveSlot(1);
    s.runManager.visionChargesRemaining = 3;
    for (const u of s.playerUnits) {
      u.stats.HP = 99;
      u.currentHP = 99;
    }
    s._captureSuspendCheckpoint();
  });
}

/** Everyone waits in place, then End Turn: an enemy phase follows. */
async function playTurn(page) {
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    for (const u of [...s.playerUnits]) {
      if (u.hasActed) continue;
      s.selectUnit(u);
      s.finishUnitAction(u, { skipCanto: true });
      await new Promise((r) => setTimeout(r, 60));
    }
    s.forceEndTurn();
  });
  await idle(page);
}

/** Many recorded board changes inside one turn (long frame-delta chains). */
async function shuffle(page, times) {
  await page.evaluate(async (times) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits[0];
    const home = { col: u.col, row: u.row };
    const free = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dc, dr]) => ({ col: home.col + dc, row: home.row + dr }))
      .find(
        (p) =>
          p.col >= 0 &&
          p.row >= 0 &&
          p.col < s.grid.cols &&
          p.row < s.grid.rows &&
          !s.getUnitAt(p.col, p.row),
      );
    for (let i = 0; i < times; i++) {
      const at = i % 2 ? home : free || home;
      u.col = at.col;
      u.row = at.row;
      u.currentHP = 99 - (i % 7);
      s.updateUnitPosition?.(u);
      s._captureSuspendCheckpoint();
      await new Promise((r) => setTimeout(r, 5));
    }
  }, times);
}

async function reloadBattle(page) {
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Save Slots', exact: true }).click();
  await waitForScene(page, 'SlotPicker');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).click();
  await page.getByRole('button', { name: 'Resume Battle', exact: true }).click();
  await waitForScene(page, 'Battle');
  await idle(page);
}

async function openHistory(page) {
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle')._visionController.openTimeline(),
  );
  const view = page.getByRole('dialog', { name: 'Battle timeline', exact: true });
  await expect(view).toBeVisible();
  return view;
}

async function expectRealBoard(page, view) {
  await expect(view).toHaveClass(/bt-battlefield/);
  const preview = view.locator('.bt-preview');
  await expect(preview.locator('h3')).toContainText('Viewing history');
  await expect(preview).not.toHaveClass(/bt-legacy-preview/);
  await expect(preview.locator('.bt-board')).toHaveCount(0);
  await expect(preview).not.toContainText('map sketch');
  // The battlefield scene drew the recorded board.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const history = window.__emblemRogueGame.scene
          .getScenes(true)
          .find((scene) => scene.sys.settings.key.startsWith('BattleHistory-'));
        return history ? history.children.list.length : 0;
      }),
    )
    .toBeGreaterThan(10);
}

async function selectRows(page, view, predicate) {
  const rows = view.locator('.bt-entry');
  const count = await rows.count();
  let checked = 0;
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const label = (await row.textContent()) || '';
    if (!predicate(label, i, count)) continue;
    if (!(await row.isVisible())) {
      const toggle = view.getByRole('button', { name: 'History', exact: true });
      if (await toggle.count()) await toggle.click();
    }
    await row.click();
    await expectRealBoard(page, view);
    checked++;
  }
  return checked;
}

for (const viewport of [
  { name: 'desktop-1280x800', width: 1280, height: 800, scale: 1 },
  { name: 'desktop-1440x900-2x', width: 1440, height: 900, scale: 2 },
]) {
  test.describe(viewport.name, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.scale,
    });

    test('history draws the real battlefield after turns, a rewind branch and a reload', async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await boot(page);
      await playTurn(page);
      await shuffle(page, 12);
      await playTurn(page);
      await shuffle(page, 20);
      // Rewind to an early point of this turn, then keep playing past it.
      await page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle').requestVisionRewind(),
      );
      const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
      await expect(picker).toBeVisible();
      const rows = picker.locator('.vr-row:not(.vr-row--unavailable)');
      await rows.nth(Math.max(0, (await rows.count()) - 3)).click();
      await picker.getByRole('button', { name: /^Rewind here/ }).click();
      await expect(picker).toHaveCount(0);
      await idle(page);
      await shuffle(page, 40);
      await playTurn(page);

      let view = await openHistory(page);
      expect(await selectRows(page, view, (_l, i, n) => i === n - 1)).toBe(1);
      await page.keyboard.press('Escape');
      await expect(view).toHaveCount(0);

      // Reload and resume the suspended battle.
      await reloadBattle(page);

      view = await openHistory(page);
      // Every enemy-phase row, the newest rows and the oldest retained row.
      const checked = await selectRows(
        page,
        view,
        (label, i, n) => /enemy/i.test(label) || i >= n - 4 || i === 0,
      );
      expect(checked).toBeGreaterThanOrEqual(4);
      const enemyRow = view.locator('.bt-entry', { hasText: /enemy/i }).first();
      await enemyRow.click();
      await expectRealBoard(page, view);
      await page.screenshot({ path: `${SHOTS}/timeline-${viewport.name}.png`, scale: 'css' });
      expect(errors).toEqual([]);
    });

    test('rows whose frames were lost still draw the battlefield, never the text sketch', async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // Traced sprites give affixed enemies `~corrupt` texture keys, which the
      // frame validator used to reject — dropping the whole frame archive.
      await boot(page, '&spriteArt=traced');
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        for (const enemy of s.enemyUnits) {
          enemy.affixes = ['shielded'];
          s.removeUnitGraphic(enemy);
          s.addUnitGraphic(enemy);
        }
        s._captureSuspendCheckpoint();
      });
      await playTurn(page);
      await shuffle(page, 6);
      await playTurn(page);
      const archive = await page.evaluate(
        () =>
          window.__emblemRogueGame.scene.getScene('Battle')._battleTimeline.presentation?.records
            ?.length || 0,
      );
      expect(archive).toBeGreaterThan(10);
      // A save whose archive cannot be verified (an older build's, or one cut
      // by the byte budget): the reload discards it.
      await page.evaluate(() => {
        const key = 'emblem_rogue_slot_1_run';
        const run = JSON.parse(localStorage.getItem(key));
        run.battleInProgress.timeline.presentation = null;
        localStorage.setItem(key, JSON.stringify(run));
      });
      await reloadBattle(page);
      const view = await openHistory(page);
      const checked = await selectRows(page, view, () => true);
      expect(checked).toBeGreaterThanOrEqual(8);
      const enemyRow = view.locator('.bt-entry', { hasText: /enemy|Fighter/i }).first();
      await enemyRow.click();
      await expectRealBoard(page, view);
      // The rebuilt board keeps the recorded terrain (not all hatched).
      const known = await page.evaluate(() => {
        const history = window.__emblemRogueGame.scene
          .getScenes(true)
          .find((scene) => scene.sys.settings.key.startsWith('BattleHistory-'));
        return history?.children.list.length || 0;
      });
      expect(known).toBeGreaterThan(50);
      await page.screenshot({
        path: `${SHOTS}/timeline-rebuilt-${viewport.name}.png`,
        scale: 'css',
      });
      expect(errors).toEqual([]);
    });
  });
}
