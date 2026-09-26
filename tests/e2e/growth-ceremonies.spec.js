// Growth ceremonies through real flows (docs/art-direction/growth/): the
// promotion rite via the battle Master Seal (two paths, chooser), via the
// roster seal and via the church; a refresh mid-rite in battle and at the
// church; and the level-up card at each battle speed. Each check asserts the
// gains are committed exactly once and the game stays playable.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test.setTimeout(120000);
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(12000);
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
});

function collect(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function settings(page, speed = 'normal') {
  await page.addInitScript((speed) => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: speed }),
    );
  }, speed);
}

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

async function resumeSavedRun(page, battle = false) {
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  await page.waitForTimeout(1300);
  const slots = page.getByRole('button', { name: 'Save Slots', exact: true });
  await expect(slots).toBeEnabled();
  await slots.tap();
  await waitForScene(page, 'SlotPicker');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  if (battle) await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
  await waitForScene(page, battle ? 'Battle' : 'NodeMap');
}

const idle = (page) =>
  page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    null,
    { timeout: 30000 },
  );

async function battle(page, speed = 'normal') {
  await settings(page, speed);
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  await idle(page);
}

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

// Two presses: the first completes the reveal, the second continues.
async function dismissRite(page, rite) {
  await page.waitForTimeout(250);
  await rite.getByRole('button', { name: /^(Skip|Continue)$/ }).tap();
  const cont = rite.getByRole('button', { name: 'Continue', exact: true });
  await expect(cont).toBeVisible();
  await cont.tap();
  await expect(page.getByRole('dialog', { name: 'Promotion', exact: true })).toHaveCount(0);
}

test('battle Master Seal: path chooser, then the rite over the map; gains once', async ({
  page,
}, info) => {
  const errors = collect(page);
  await battle(page);
  const name = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === 'Sera');
    // A Myrmidon with two paths (Swordmaster, Duelist) and a Master Seal.
    Object.assign(u, {
      name: 'Ilse',
      isLord: false,
      className: 'Myrmidon',
      tier: 'base',
      level: 10,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
    });
    const sword = s.gameData.weapons.find((w) => w.name === 'Iron Sword');
    u.inventory = [structuredClone(sword)];
    u.weapon = u.inventory[0];
    u.consumables = [structuredClone(s.gameData.consumables.find((i) => i.effect === 'promote'))];
    s.removeUnitGraphic(u);
    s.addUnitGraphic(u);
    return u.name;
  });
  await tapUnit(page, name);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Item', exact: true }).tap();
  await hud.getByRole('button', { name: /^Master Seal/ }).tap();
  const chooser = page.getByRole('dialog', { name: 'Choose promotion', exact: true });
  await expect(chooser).toBeVisible();
  const paths = chooser.locator('.gr-path');
  await expect(paths).toHaveCount(2);
  for (const path of await paths.all()) {
    await expect(path.locator('.re-crest')).toHaveCount(1);
    await expect(path.locator('.gr-chips--stats .gr-chip').first()).toBeVisible();
    await expect(path.locator('.gr-rank.is-up')).toContainText('Sword P→M');
    // Every path card fits its column at 667×375.
    expect(await path.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  }
  await expect(chooser.locator('[data-path="Duelist"] .gr-rank.is-new')).toContainText('Lance');
  await page.screenshot({ path: info.outputPath('chooser.png') });
  await chooser.getByRole('button', { name: 'Select Duelist', exact: true }).tap();
  await chooser.getByRole('button', { name: 'Confirm promotion', exact: true }).tap();
  const rite = page.getByRole('dialog', { name: 'Promotion', exact: true });
  await expect(rite).toBeVisible();
  // Committed before the rite: class, seal and the resolved action.
  const during = await page.evaluate((name) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === name);
    return {
      className: u.className,
      seals: u.consumables.length,
      pending: s._pendingActionCompletion?.unitName,
      railInert: document.querySelector('.mobile-battle-hud')?.inert,
      locked: s.isStoryInputLocked(),
    };
  }, name);
  expect(during).toEqual({
    className: 'Duelist',
    seals: 0,
    pending: name,
    railInert: true,
    locked: true,
  });
  await expect(rite.locator('.gr-name--to')).toHaveText('Duelist');
  await expect(rite.locator('.gr-seal')).not.toHaveCount(0);
  // The rite covers the map only: the rail stays in view to its right.
  const riteBox = await rite.boundingBox();
  const railBox = await page.locator('.mobile-battle-hud').boundingBox();
  expect(riteBox.x + riteBox.width).toBeLessThanOrEqual(railBox.x + 1);
  await page.screenshot({ path: info.outputPath('rite.png') });
  await dismissRite(page, rite);
  await idle(page);
  const after = await page.evaluate((name) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === name);
    return { className: u.className, level: u.level, acted: u.hasActed, seals: u.consumables.length }; // prettier-ignore
  }, name);
  expect(after).toEqual({ className: 'Duelist', level: 1, acted: true, seals: 0 });
  expect(errors).toEqual([]);
});

test('path chooser at 667×375: class names in full, a tall card scrolls instead of squashing', async ({
  page,
}) => {
  const errors = collect(page);
  await battle(page);
  // A Knight's paths (General, Great Knight): the fullest real cards (seven
  // bonuses, up to three ranks, two skills, a growth/move/grant note) on the
  // narrowest frame, with a deed's Oath (Giantslayer · Lethality) on each.
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === 'Sera');
    Object.assign(u, { name: 'Benedetta', isLord: false, className: 'Knight', tier: 'base' });
    Object.assign(u, { level: 10, proficiencies: [{ type: 'Lance', rank: 'Prof' }], skills: [] });
    const deeds = await import('/src/engine/DeedSystem.js');
    u._battleDeeds = { v: 1, maxKillLevelGap: 6 };
    deeds.commitBattleDeeds([u], s.gameData.deeds, { battleKey: 'chooser' });
    const targets = s.gameData.classes.filter((c) => c.promotesFrom === 'Knight');
    const { PromotionChoicePanel } = await import('/src/ui/PromotionChoicePanel.js');
    s.battleState = 'COMBAT_RESOLVING';
    window.__choice = new PromotionChoicePanel(s, u, targets, s.gameData.skills).show();
  });
  const chooser = page.getByRole('dialog', { name: 'Choose promotion', exact: true });
  await expect(chooser.locator('.gr-path')).toHaveCount(2);
  const cards = await chooser.locator('.gr-path').evaluateAll((all) =>
    all.map((card) => {
      const name = card.querySelector('.gr-path-title strong');
      const oath = card.querySelector('.gr-path-oath');
      return {
        path: card.dataset.path,
        name: name.textContent,
        nameFits: name.scrollWidth <= name.clientWidth + 1,
        oathInFull: Boolean(oath) && oath.scrollHeight <= oath.clientHeight + 1,
        // The whole card is laid out (a squashed card centres its content,
        // pushing the class name above the scroll area's reach).
        squashed: card.scrollHeight > card.clientHeight + 1,
      };
    }),
  );
  const fits = { nameFits: true, oathInFull: true, squashed: false };
  expect(cards).toEqual([
    { path: 'General', name: 'General', ...fits },
    { path: 'Great Knight', name: 'Great Knight', ...fits },
  ]);
  // Scrolled to the end, the last card's footnote is reachable too.
  const last = chooser.locator('.gr-path').last().locator('.gr-path-note');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await chooser.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(chooser).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('refresh mid-rite (battle seal): promotion and seal kept exactly once, rite not replayed', async ({
  page,
}) => {
  const errors = collect(page);
  await battle(page);
  await attachSlot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits[0];
    u.level = 10;
    u.skills = [];
    u.consumables = [structuredClone(s.gameData.consumables.find((i) => i.effect === 'promote'))];
    s._captureSuspendCheckpoint();
  });
  await tapUnit(page, 'Edric');
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Item', exact: true }).tap();
  await hud.getByRole('button', { name: /^Master Seal/ }).tap();
  const rite = page.getByRole('dialog', { name: 'Promotion', exact: true });
  await expect(rite).toBeVisible({ timeout: 20000 });
  const stored = await page.evaluate(() => {
    const cp = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')).battleInProgress
      .checkpoint;
    const u = cp.playerUnits.find((x) => x.name === 'Edric');
    return { className: u.className, seals: u.consumables.length, pending: cp.pendingActionCompletion?.unitName }; // prettier-ignore
  });
  expect(stored).toEqual({ className: 'Great Lord', seals: 0, pending: 'Edric' });
  await resumeSavedRun(page, true);
  await idle(page);
  await expect(page.getByRole('dialog', { name: 'Promotion', exact: true })).toHaveCount(0);
  const after = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === 'Edric');
    return { className: u.className, level: u.level, seals: u.consumables.length, acted: u.hasActed }; // prettier-ignore
  });
  expect(after).toEqual({ className: 'Great Lord', level: 1, seals: 0, acted: true });
  expect(errors).toEqual([]);
});

test('church: chooser shows the path; the rite plays after gold, promotion and save; refresh keeps them once', async ({
  page,
}, info) => {
  const errors = collect(page);
  await settings(page);
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await attachSlot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.runManager.gold = 10000;
    s.runManager.roster[0].level = 10;
    s.handleChurch(s.runManager.getAvailableNodes()[0]);
  });
  const church = page.getByRole('dialog', { name: 'Church', exact: true });
  await church.getByRole('button', { name: /Edric.*Lord/ }).tap();
  const chooser = page.getByRole('dialog', { name: 'Promote Edric', exact: true });
  await expect(chooser.locator('.gr-path .re-crest')).toHaveCount(1);
  await expect(chooser.locator('.gr-chooser-lead')).toContainText('3500 G');
  await page.screenshot({ path: info.outputPath('church-chooser.png') });
  await chooser.getByRole('button', { name: /^Promote to Great Lord · 3500 G$/ }).tap();
  const rite = page.getByRole('dialog', { name: 'Promotion', exact: true });
  await expect(rite).toBeVisible();
  // Over a menu the rite owns the whole screen.
  const box = await rite.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(666);
  const saved = await page.evaluate(() => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
    return { gold: run.gold, className: run.roster.find((u) => u.name === 'Edric').className };
  });
  expect(saved).toEqual({ gold: 6500, className: 'Great Lord' });
  await page.screenshot({ path: info.outputPath('church-rite.png') });
  await resumeSavedRun(page);
  await expect(page.getByRole('dialog', { name: 'Promotion', exact: true })).toHaveCount(0);
  const after = await page.evaluate(() => {
    const run = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    return { gold: run.gold, className: run.roster.find((u) => u.name === 'Edric').className };
  });
  expect(after).toEqual({ gold: 6500, className: 'Great Lord' });
  expect(errors).toEqual([]);
});

test('roster Master Seal between battles: chooser, save, rite over the roster', async ({
  page,
}) => {
  const errors = collect(page);
  await settings(page, 'fast');
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await attachSlot(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { createUnit } = await import('/src/engine/UnitManager.js');
    const u = createUnit(
      s.gameData.classes.find((c) => c.name === 'Myrmidon'),
      12,
      s.gameData.weapons,
      { name: 'Seal Bearer' },
    );
    u.consumables = [structuredClone(s.gameData.consumables.find((i) => i.effect === 'promote'))];
    s.runManager.roster.unshift(u);
  });
  await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.locator('.mr-sheet');
  await expect(roster.locator('.mr-summary .mr-crest')).toHaveCount(1);
  await roster.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await roster.getByRole('button', { name: 'Promote', exact: true }).tap();
  const chooser = page.getByRole('dialog', { name: 'Promote Seal Bearer', exact: true });
  await chooser.getByRole('button', { name: 'Select Swordmaster', exact: true }).tap();
  await chooser.getByRole('button', { name: 'Confirm promotion', exact: true }).tap();
  const rite = page.getByRole('dialog', { name: 'Promotion', exact: true });
  await expect(rite).toBeVisible();
  const saved = await page.evaluate(() => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
    const u = run.roster.find((x) => x.name === 'Seal Bearer');
    return { className: u.className, seals: u.consumables.length };
  });
  expect(saved).toEqual({ className: 'Swordmaster', seals: 0 });
  await dismissRite(page, rite);
  await expect(roster.getByRole('status')).toContainText('Seal Bearer is now Swordmaster');
  await expect(roster.locator('.mr-summary .mr-crest')).toHaveAttribute('data-crest', 'Swordmaster'); // prettier-ignore
  expect(errors).toEqual([]);
});

for (const speed of ['normal', 'fast', 'instant'])
  test(`level-up card through a real kill at ${speed} speed`, async ({ page }, info) => {
    const errors = collect(page);
    await battle(page, speed);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits[0];
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
      window.__levelBefore = { level: u.level, stats: JSON.stringify(u.stats) };
    });
    await tapUnit(page, 'Edric');
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    // Target first: Attack goes straight to target selection.
    await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
    await tapUnit(page, 'Growth Target', 'enemyUnits');
    await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
    const card = page.getByRole('dialog', { name: 'Level up', exact: true });
    await expect(card).toBeVisible({ timeout: 25000 });
    const layer = page.locator('.gr-level-layer');
    if (speed === 'instant') {
      // Instant: the end state at once — no waiting on the reveal.
      await expect(layer).toHaveClass(/is-static/);
      await expect(layer).toHaveClass(/is-done/);
    } else {
      await expect(layer).not.toHaveClass(/is-static/);
      await expect(layer).toHaveClass(/is-done/, { timeout: speed === 'fast' ? 1500 : 2500 });
    }
    await expect(card.locator('.gr-level-row.is-gain')).not.toHaveCount(0);
    const stats = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return { level: s.playerUnits[0].level, stats: s.playerUnits[0].stats };
    });
    expect(stats.level).toBe((await page.evaluate(() => window.__levelBefore.level)) + 1);
    await page.screenshot({ path: info.outputPath(`level-${speed}.png`) });
    await page.waitForTimeout(250);
    await card.getByRole('button', { name: 'Continue', exact: true }).tap();
    await expect(card).toHaveCount(0);
    await idle(page);
    // Presentation only: the stats shown are the stats kept.
    expect(
      await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].stats), // prettier-ignore
    ).toEqual(stats.stats);
    expect(errors).toEqual([]);
  });
