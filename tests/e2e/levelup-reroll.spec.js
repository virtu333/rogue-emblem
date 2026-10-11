// Branching Threads on a level-up card: a real kill in the smoke battle levels Edric, the
// card's Reroll is tapped once the gains are revealed, and a refresh with the card still up
// resumes the battle with the rerolled stats and the charge spent (never a free reroll).
// The second test checks the card and its button fit an upright phone (375×667).
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.setTimeout(180000);
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(20000);
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
  await page.addInitScript(() => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: 'fast' }),
    );
  });
});

function collect(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const idle = (page) =>
  page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
    null,
    { timeout: 30000 },
  );

/** The smoke battle on slot 1, its run granted `rerolls`, Edric one XP from a level. */
async function battleWithRerolls(page, url, rerolls) {
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await idle(page);
  await page.evaluate(async (n) => {
    const game = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    game.registry.set('activeSlot', 1);
    setActiveSlot(1);
    const s = game.scene.getScene('Battle');
    // As a run started with Branching Threads has it (meta effects snapshotted at start).
    s.runManager.metaEffects = { ...(s.runManager.metaEffects || {}), rewardRerolls: n };
    const u = s.playerUnits.find((x) => x.name === 'Edric');
    u.xp = 99;
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
    enemy.name = 'Growth Target';
    enemy.currentHP = 1;
    enemy.skills = [];
    s.grid.setTerrainAt(enemy.col, enemy.row, 0);
    s.updateUnitPosition(enemy);
    s.updateHPBar(enemy);
    s._captureSuspendCheckpoint({ session: s._battleSession });
  }, rerolls);
}

async function tapUnit(page, name, group = 'playerUnits') {
  const p = await page.evaluate(
    ({ name, group }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s[group].find((x) => x.name === name);
      const w = s.grid.gridToPixel(u.col, u.row),
        q = s._worldToScreen(w.x, w.y);
      const r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (q.x * r.width) / s.scale.width,
        y: r.y + (q.y * r.height) / s.scale.height,
      };
    },
    { name, group },
  );
  await page.touchscreen.tap(p.x, p.y);
}

const edric = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === 'Edric');
    return { level: u.level, stats: { ...u.stats }, hp: u.currentHP };
  });
const savedRun = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')));
const savedEdric = (run) => {
  const u = run.battleInProgress.checkpoint.playerUnits.find((x) => x.name === 'Edric');
  return { level: u.level, stats: { ...u.stats }, hp: u.currentHP };
};

// eslint-disable-next-line no-unused-vars
const { defaultBrowserType, ...phone } = devices['iPhone SE'];

test.describe('landscape phone', () => {
  test.use({ ...phone, viewport: { width: 667, height: 375 } });

  test('tap Reroll on a real level-up card, refresh, resume: rerolled stats, charge spent', async ({
    page,
  }) => {
    const errors = collect(page);
    await battleWithRerolls(page, '/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1', 2); // prettier-ignore
    const pre = await edric(page);
    // The stats a level raised, read from the unit, and the "+1" rows the card shows.
    const raised = (now) =>
      Object.keys(now.stats)
        .filter((stat) => now.stats[stat] > pre.stats[stat])
        .sort();
    const shown = async () =>
      (await card.locator('.gr-level-row.is-gain dt').allTextContents()).sort();
    const card = page.getByRole('dialog', { name: 'Level up', exact: true });
    await tapUnit(page, 'Edric');
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
    await tapUnit(page, 'Growth Target', 'enemyUnits');
    await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
    await expect(card).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.gr-level-layer')).toHaveClass(/is-done/, { timeout: 5000 });
    const before = await edric(page);
    expect(before.level).toBe(pre.level + 1);
    expect(await shown()).toEqual(raised(before));
    const reroll = card.getByRole('button', { name: 'Reroll (2)', exact: true });
    await expect(reroll).toBeVisible();
    await expect(reroll).toBeInViewport();
    expect((await savedRun(page)).rewardRerollsSpent ?? 0).toBe(0);

    await reroll.tap();
    // The reveal replays, then the count reads one less.
    await expect(card.getByRole('button', { name: 'Reroll (1)', exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(card).toBeVisible(); // the tap rerolled; it did not continue
    await expect(page.locator('.gr-level-layer')).toHaveClass(/is-done/);
    const after = await edric(page);
    expect(after.level).toBe(before.level);
    // What the card shows is what the unit now holds: the new level replaced the old.
    expect(await shown()).toEqual(raised(after));
    // Saved at once, over the same checkpoint: the rerolled stats and the spent charge.
    let saved = await savedRun(page);
    expect(saved.rewardRerollsSpent).toBe(1);
    expect(saved.battleInProgress.checkpoint.runBattleState.rewardRerollsSpent).toBe(1);
    expect(savedEdric(saved)).toEqual(after);

    // Refresh with the card still up, then Resume Battle.
    await page.evaluate(() => history.replaceState(null, '', '/'));
    await page.reload();
    await waitForScene(page, 'Title');
    await page.getByRole('button', { name: 'Save Slots', exact: true }).tap();
    await waitForScene(page, 'SlotPicker');
    await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
    await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
    await waitForScene(page, 'Battle');
    await idle(page);
    expect(await edric(page)).toEqual(after);
    const left = await page.evaluate(async () => {
      const { rerollsLeft } = await import('/src/engine/RerollPool.js');
      return rerollsLeft(window.__emblemRogueGame.scene.getScene('Battle').runManager);
    });
    expect(left).toBe(1);
    saved = await savedRun(page);
    expect(saved.rewardRerollsSpent).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('portrait phone', () => {
  test.use({ ...phone, viewport: { width: 375, height: 667 } });

  test('the card and its Reroll fit an upright phone; No rerolls left once spent', async ({
    page,
  }) => {
    const errors = collect(page);
    await battleWithRerolls(page, '/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1', 1); // prettier-ignore
    // The card through the production queue (XP applied, then presented at a boundary).
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { presentQueuedProgress } = await import('/src/ui/BattlePresentationCheckpoint.js');
      const u = s.playerUnits.find((x) => x.name === 'Edric');
      s.awardScaledXP(u, 20);
      void presentQueuedProgress(
        s,
        { kind: 'finish', unitName: u.name, unitId: u.battleEntityId, skipCanto: true },
        { session: s._battleSession },
      );
    });
    const card = page.getByRole('dialog', { name: 'Level up', exact: true });
    await expect(card).toBeVisible();
    await expect(page.locator('.gr-level-layer')).toHaveClass(/is-done/, { timeout: 5000 });
    const reroll = card.getByRole('button', { name: 'Reroll (1)', exact: true });
    const go = card.getByRole('button', { name: 'Continue', exact: true });
    await expect(reroll).toBeInViewport({ ratio: 1 });
    await expect(go).toBeInViewport({ ratio: 1 });
    const fits = await page.evaluate(() => {
      const c = document.querySelector('.gr-level').getBoundingClientRect();
      const b = document.querySelector('.gr-reroll').getBoundingClientRect();
      const g = document.querySelector('.gr-level-foot .gr-continue').getBoundingClientRect();
      const overlap = !(b.right <= g.left || g.right <= b.left || b.bottom <= g.top || g.bottom <= b.top); // prettier-ignore
      return {
        inCard: b.left >= c.left && b.right <= c.right + 0.5 && g.right <= c.right + 0.5,
        overlap,
        noScroll: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(fits).toEqual({ inCard: true, overlap: false, noScroll: true });
    await reroll.tap();
    await expect(card.getByRole('button', { name: 'No rerolls left', exact: true })).toBeDisabled({
      timeout: 5000,
    });
    await go.tap();
    await expect(card).toHaveCount(0);
    expect((await savedRun(page)).rewardRerollsSpent).toBe(1);
    expect(errors).toEqual([]);
  });
});
