// A confirmed attack is saved before its rolls are revealed. Refreshing (or
// the OS killing the app) mid-animation must resume into the same attack with
// the same outcome, never back to a fresh choice with the result already seen.
import { test, expect, devices } from '@playwright/test';
async function waitForScene(page, key) {
  await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, {
    timeout: 60000,
  });
}

test.use({
  ...devices['iPhone SE'],
  viewport: { width: 667, height: 375 },
});
test.setTimeout(300000);
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(40000);
});

// Fixtures attach only this test's isolated browser profile to a real slot.
// Outcomes are saved by the shipping roster-close/action-completion handlers.
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

async function resumeSavedRun(page, battle = false, alreadyReloaded = false) {
  if (!alreadyReloaded) {
    await page.evaluate(() => history.replaceState(null, '', '/'));
    await page.reload();
  }
  await waitForScene(page, 'Title');
  // The title menu is DOM (#67). Its transitions retry past the router's post-boot
  // cooldown, so the tap needs no settling delay.
  await page.getByRole('button', { name: 'Save Slots', exact: true }).tap();
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  if (battle) await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
  await waitForScene(page, battle ? 'Battle' : 'NodeMap');
}

async function battleIdle(page) {
  // A level-up from the attack's XP pauses on its popup; dismiss it.
  for (let i = 0; i < 60; i++) {
    const state = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle')?.battleState,
    );
    if (state === 'PLAYER_IDLE') return;
    const next = page.getByRole('button', { name: /^(Continue|Reveal gains)$/ });
    if (
      await next
        .first()
        .isVisible()
        .catch(() => false)
    )
      await next.first().tap();
    await page.waitForTimeout(250);
  }
  throw new Error('battle never returned to PLAYER_IDLE');
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

async function setup(page, { secondWeapon = false } = {}) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  await battleIdle(page);
  await attachSlot(page);
  return page.evaluate((secondWeapon) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      u = s.playerUnits[0];
    u.skills = [];
    // A second weapon of the same kind, carried behind the equipped one: the
    // forecast can switch to it (a non-default weapon).
    let spare = null;
    if (secondWeapon) {
      const base = s.gameData.weapons.find(
        (w) =>
          w.type === u.weapon.type &&
          w.name !== u.weapon.name &&
          w.tier === 'Steel' &&
          w.rankRequired === 'Prof' &&
          !w.special,
      );
      spare = { ...structuredClone(base), uid: 'refresh-spare' };
      u.inventory.push(spare);
    }
    const enemy = s.enemyUnits[0];
    const tile = [
      [u.col + 1, u.row],
      [u.col - 1, u.row],
      [u.col, u.row + 1],
      [u.col, u.row - 1],
    ].find(
      ([c, r]) => c >= 0 && r >= 0 && c < s.grid.cols && r < s.grid.rows && !s.getUnitAt(c, r),
    );
    [enemy.col, enemy.row] = tile;
    enemy.name = 'Reload Target';
    enemy.stats.HP = 80;
    enemy.currentHP = 80;
    enemy.skills = [];
    s.grid.setTerrainAt(enemy.col, enemy.row, 0);
    s.updateUnitPosition(enemy);
    s.updateHPBar(enemy);
    s._captureSuspendCheckpoint();
    return {
      name: u.name,
      attackerHP: u.currentHP,
      enemyHP: enemy.currentHP,
      equipped: u.weapon.name,
      spare: spare?.name ?? null,
    };
  }, secondWeapon);
}

async function attack(page, name, { switchTo = null } = {}) {
  await tapUnit(page, name);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  // Target first (#77): Attack goes straight to target selection with the equipped
  // weapon; the forecast is where a weapon could be switched.
  await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
  await tapUnit(page, 'Reload Target', 'enemyUnits');
  if (switchTo) {
    const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
    await dialog.getByRole('button', { name: 'Next weapon', exact: true }).tap();
    await expect(dialog.getByRole('group', { name: 'Weapon' })).toContainText(switchTo);
  }
  await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
}

function outcome(page, name) {
  return page.evaluate((name) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === name);
    const e = s.enemyUnits.find((x) => x.name === 'Reload Target');
    const saved = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')).battleInProgress;
    return {
      acted: u.hasActed,
      enemyHP: e?.currentHP ?? 0,
      facts: saved.timeline.entries.flatMap((entry) => entry.facts),
      storedIntent: saved.checkpoint.pendingCommittedAction,
    };
  }, name);
}

test('a refresh during the strike animation replays the same attack and outcome', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const init = await setup(page);
  await attack(page, init.name);
  // The rolls are revealed on screen and in the queued timeline facts while
  // the strike animates; refresh at that moment.
  const mid = await page.evaluate(async (name) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    while (s.battleState !== 'COMBAT_RESOLVING') await new Promise((r) => setTimeout(r, 10));
    while (!(s._timelineFacts || []).some((f) => f.includes('Reload Target')))
      await new Promise((r) => setTimeout(r, 10));
    const cp = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')).battleInProgress
      .checkpoint;
    const out = {
      state: s.battleState,
      revealed: s._timelineFacts.filter((f) => f.includes('Reload Target')),
      storedIntent: cp.pendingCommittedAction,
      storedEnemyHP: cp.enemyUnits.find((x) => x.name === 'Reload Target')?.currentHP,
      storedActed: cp.playerUnits.find((x) => x.name === name)?.hasActed,
    };
    history.replaceState(null, '', '/');
    location.reload();
    return out;
  }, init.name);
  expect(mid.state).toBe('COMBAT_RESOLVING');
  expect(mid.revealed.length).toBeGreaterThan(0);
  expect(mid.storedIntent).toMatchObject({ kind: 'attack', unitName: init.name });
  expect(mid.storedEnemyHP).toBe(init.enemyHP);
  expect(mid.storedActed).toBe(false);

  await page.waitForLoadState('load');
  await resumeSavedRun(page, true, true);
  await battleIdle(page);
  const after = await outcome(page, init.name);
  // The same attack resolved with the same rolls — not a fresh choice.
  expect(after.acted).toBe(true);
  expect(after.enemyHP).toBeLessThan(init.enemyHP);
  for (const fact of mid.revealed) expect(after.facts).toContain(fact);
  // It settled like any action: nothing is left to replay on a second refresh.
  expect(after.storedIntent).toBeNull();
  expect(errors).toEqual([]);
});

test('an attack confirmed with a switched weapon saves and replays with that weapon', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const init = await setup(page, { secondWeapon: true });
  expect(init.spare).toBeTruthy();
  await attack(page, init.name, { switchTo: init.spare });
  const mid = await page.evaluate(async (name) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    while (s.battleState !== 'COMBAT_RESOLVING') await new Promise((r) => setTimeout(r, 10));
    while (!(s._timelineFacts || []).some((f) => f.includes('Reload Target')))
      await new Promise((r) => setTimeout(r, 10));
    const cp = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')).battleInProgress
      .checkpoint;
    const stored = cp.playerUnits.find((x) => x.name === name);
    const out = {
      revealed: s._timelineFacts.filter((f) => f.includes('Reload Target')),
      storedIntent: cp.pendingCommittedAction,
      storedEquippedIndex: stored?.equippedInventoryIndex,
      storedBag: stored?.inventory.map((w) => w.name),
    };
    history.replaceState(null, '', '/');
    location.reload();
    return out;
  }, init.name);
  // The pre-roll checkpoint holds the confirmed weapon, equipped and first.
  expect(mid.storedIntent).toMatchObject({ kind: 'attack', unitName: init.name, weaponArt: null });
  expect(mid.storedEquippedIndex).toBe(0);
  expect(mid.storedBag[0]).toBe(init.spare);
  expect(mid.storedBag).toContain(init.equipped);

  await page.waitForLoadState('load');
  await resumeSavedRun(page, true, true);
  await battleIdle(page);
  const after = await outcome(page, init.name);
  expect(after.acted).toBe(true);
  expect(after.enemyHP).toBeLessThan(init.enemyHP);
  // The replay is the same attack: the same strikes, with the switched weapon.
  for (const fact of mid.revealed) expect(after.facts).toContain(fact);
  expect(after.storedIntent).toBeNull();
  const weapon = await page.evaluate((name) => {
    const u = window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.find((x) => x.name === name);
    return { equipped: u.weapon?.name, first: u.inventory[0] === u.weapon };
  }, init.name);
  expect(weapon).toEqual({ equipped: init.spare, first: true });
  expect(errors).toEqual([]);
});
