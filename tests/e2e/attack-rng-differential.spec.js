// The same saved battle plus the same commands must play out the same, however
// the attacks are presented or read (compression plan step 3). Every run
// resumes one save through the shipping recovery path (Title → Save Slots →
// Resume Battle), makes the same two player attacks (procs, a level-up, a
// Teleporter warp) and ends the turn. Runs differ only in battle speed, reduced
// motion, how often the forecast is opened, cycled and cancelled, and whether
// the battle history is viewed. Domain state and the RNG cursor must match.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });

async function battleIdle(page) {
  // Level-ups from an attack's XP (and the enemy phase) pause on their popup.
  for (let i = 0; i < 240; i++) {
    const idle = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
    );
    if (idle) return;
    const next = page.getByRole('button', { name: /^(Continue|Reveal gains)$/ }).first();
    if (await next.isVisible().catch(() => false)) await next.tap();
    await page.waitForTimeout(250);
  }
  throw new Error('battle never returned to PLAYER_IDLE');
}

async function tapUnit(page, name, group) {
  const p = await page.evaluate(
    ({ name, group }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s[group].find((x) => x.name === name);
      const w = s.grid.gridToPixel(u.col, u.row);
      const p = s._worldToScreen(w.x, w.y);
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

async function setupSave(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  await battleIdle(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = s.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    s.registry.set('activeSlot', 1);
    setActiveSlot(1);
    // First-use tips are per-save UI state; keep them out of the runs compared.
    s.registry.get('settings').setHints(false);
    s.runManager.visionChargesRemaining = 3; // the History view sits behind Rewind

    const [edric, sera] = s.playerUnits;
    const [a, b] = s.enemyUnits;
    const free = (u) =>
      [
        [u.col, u.row - 1],
        [u.col + 1, u.row],
        [u.col - 1, u.row],
        [u.col, u.row + 1],
      ].find(
        ([c, r]) => c >= 0 && r >= 0 && c < s.grid.cols && r < s.grid.rows && !s.getUnitAt(c, r),
      );
    // Edric: procs, Gambler's Coin, one XP short of a level.
    edric.skills = [...edric.skills, 'sol', 'luna', 'adept'];
    edric.stats.SKL = 24;
    edric.xp = 99;
    const coin = s.gameData.accessories.find((x) => x.name === "Gambler's Coin");
    edric.accessory = { ...structuredClone(coin), uid: 'itm_diff_coin' };
    sera.stats.SKL = 30; // her hit lands, so Target B warps
    // Target A counters with Pavise; Target B warps away when hit.
    Object.assign(a, { name: 'Target A', skills: ['pavise'], affixes: [] });
    Object.assign(b, { name: 'Target B', skills: [], affixes: ['teleporter'] });
    b.stats.MOV = 0; // stays where it warps to, through the enemy phase
    b.mov = 0;
    for (const [enemy, ally] of [
      [a, edric],
      [b, sera],
    ]) {
      enemy.stats.HP = 60;
      enemy.currentHP = 60;
      [enemy.col, enemy.row] = free(ally);
      s.grid.setTerrainAt(enemy.col, enemy.row, 0);
      s.updateUnitPosition(enemy);
      s.updateHPBar(enemy);
    }
    if (!s._captureSuspendCheckpoint()) throw new Error('setup save failed');
  });
  return page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
}

// Title → Save Slots → Slot 1 → Resume Battle: the shipping recovery path.
async function resumeFrom(page, saved) {
  // Leave the game first so nothing it saves on exit overwrites the fixture.
  await page.goto('/data/terrain.json');
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of JSON.parse(entries)) localStorage.setItem(key, value);
  }, saved);
  await page.goto('/?mobilePreview=1');
  await waitForScene(page, 'Title');
  await page.getByRole('button', { name: 'Save Slots', exact: true }).tap();
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
  await waitForScene(page, 'Battle');
  await battleIdle(page);
}

// Full domain state through the production checkpoint adapter: units with
// equipment, XP and conditions, fog, gold, both RNG cursors.
function domainState(page) {
  return page.evaluate(async () => {
    const { captureBattleState } = await import('/src/ui/BattleCheckpointAdapter.js');
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const state = captureBattleState(s);
    if (state.fog) {
      state.fog.visible.sort();
      state.fog.everSeen.sort();
    }
    delete state.checkpointIndex; // counts saves, not outcomes
    return {
      state,
      turn: s.turnManager.turnNumber,
      visionCharges: s.runManager.visionChargesRemaining,
    };
  });
}

async function openHistory(page) {
  await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
  await page
    .getByRole('dialog', { name: 'Rewind', exact: true })
    .getByRole('button', { name: 'History', exact: true })
    .tap();
  await page.waitForFunction(() => {
    const v = window.__emblemRogueGame.scene.getScene('Battle').visionDialog?.surface;
    return v?.session?.scene?.renderer?.frame && !v.busy;
  });
  const view = page.getByRole('dialog', { name: 'Battle timeline', exact: true });
  const previous = view.getByRole('button', { name: 'Previous action', exact: true });
  if (await previous.isEnabled().catch(() => false)) await previous.tap();
  await view.getByRole('button', { name: 'Back to rewind', exact: true }).tap();
  await page
    .getByRole('dialog', { name: 'Rewind', exact: true })
    .getByRole('button', { name: 'Back', exact: true })
    .tap();
  await battleIdle(page);
}

async function attack(page, unit, target, { reopen = false } = {}) {
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
  await tapUnit(page, unit, 'playerUnits');
  await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
  await tapUnit(page, target, 'enemyUnits');
  await expect(dialog).toBeVisible();
  if (reopen) {
    // Read the forecast with every carried weapon, back out, and open it again.
    for (let i = 0; i < 3; i++) {
      const next = dialog.getByRole('button', { name: 'Next weapon', exact: true });
      if (await next.isVisible().catch(() => false)) await next.tap();
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(dialog).toBeHidden();
    await tapUnit(page, target, 'enemyUnits');
    await expect(dialog).toBeVisible();
  }
  // The command is the same in every run: attack with the equipped weapon.
  for (let i = 0; i < 4; i++) {
    const planned = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return (s._forecastWeapon || s.selectedUnit.weapon) === s.selectedUnit.weapon;
    });
    if (planned) break;
    await dialog.getByRole('button', { name: 'Next weapon', exact: true }).tap();
  }
  await dialog.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
  await battleIdle(page);
}

async function endTurn(page) {
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  const turn = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').turnManager.turnNumber,
  );
  await hud.getByRole('button', { name: /^End turn/ }).tap();
  const confirm = hud.getByRole('button', { name: 'End turn now', exact: true });
  if (await confirm.isVisible().catch(() => false)) await confirm.tap();
  await expect
    .poll(
      async () => {
        const next = page.getByRole('button', { name: /^(Continue|Reveal gains)$/ }).first();
        if (await next.isVisible().catch(() => false)) await next.tap();
        return page.evaluate((t) => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          return s.turnManager.turnNumber > t && s.battleState === 'PLAYER_IDLE';
        }, turn);
      },
      { timeout: 120_000 },
    )
    .toBe(true);
}

const VARIANTS = {
  control: { speed: 'normal', reduceMotion: false },
  'reduced motion, instant battles': { speed: 'instant', reduceMotion: true },
  'fast battles; forecasts cycled, cancelled and reopened': { speed: 'fast', reopen: true },
  'battle history viewed between commands': { speed: 'normal', history: true },
};

test('presentation and reading do not change how a player attack plays out', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const saved = await setupSave(page);

  const runs = {};
  for (const [label, v] of Object.entries(VARIANTS)) {
    await resumeFrom(page, saved);
    await page.evaluate(({ speed, reduceMotion }) => {
      const settings = window.__emblemRogueGame.registry.get('settings');
      settings.setBattleSpeed(speed);
      settings.setReduceMotion(Boolean(reduceMotion));
    }, v);
    const states = [await domainState(page)];
    if (v.history) await openHistory(page);
    await attack(page, 'Edric', 'Target A', v);
    states.push(await domainState(page));
    if (v.history) await openHistory(page);
    await attack(page, 'Sera', 'Target B', v);
    states.push(await domainState(page));
    if (v.history) await openHistory(page);
    await endTurn(page);
    states.push(await domainState(page));
    runs[label] = states;
  }

  // Not vacuous: the attacks rolled, landed, levelled Edric up and warped Target B.
  const control = runs.control;
  const unit = (s, group, name) => s.state[group].find((u) => u.name === name);
  expect(control[1].state.rngState).not.toEqual(control[0].state.rngState);
  expect(unit(control[1], 'enemyUnits', 'Target A').currentHP).toBeLessThan(60);
  expect(unit(control[1], 'playerUnits', 'Edric').level).toBeGreaterThan(
    unit(control[0], 'playerUnits', 'Edric').level,
  );
  const [b0, b2] = [
    unit(control[0], 'enemyUnits', 'Target B'),
    unit(control[2], 'enemyUnits', 'Target B'),
  ];
  expect([b2.col, b2.row]).not.toEqual([b0.col, b0.row]);
  // Both units acting ends the turn: the enemy phase ran after the second attack.
  expect(control[2].turn).toBe(control[0].turn + 1);
  expect(control[3].turn).toBe(control[0].turn + 2);

  for (const [label, states] of Object.entries(runs)) {
    for (let i = 0; i < control.length; i++)
      expect(states[i], `${label}, after ${i} commands`).toEqual(control[i]);
  }
  expect(errors).toEqual([]);
});
