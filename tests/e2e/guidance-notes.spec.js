// Guidance: one-time, dismissible, non-blocking field notes for new players, gated
// by the Guidance setting (Full / Light / Off).
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13'];
test.use({ ...iphone, viewport: { width: 844, height: 390 } });

async function openBattle(page, guidance = 'full') {
  await page.addInitScript((level) => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: level !== 'off', guidance: level }),
    );
  }, guidance);
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.battleState === 'PLAYER_IDLE' && Boolean(s._playerTurnStartToken);
  });
  // A fresh save slot's lesson memory; clear any modal note the preset raised.
  await page.evaluate(async () => {
    const { HintManager } = await import('/src/engine/HintManager.js');
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const hints = new HintManager(1);
    hints.reset();
    // Leave the unrelated first-battle lessons read so they cannot interleave.
    for (const id of ['mobile_battle_camera', 'battle_danger_zone']) hints.markSeen(id);
    s.registry.set('hints', hints);
    s._guidance.note?.close(false);
    s._guidance._key = '';
  });
  const notes = page.getByRole('dialog', { name: 'Field notes' });
  for (let i = 0; i < 3 && (await notes.isVisible().catch(() => false)); i++) {
    await notes.getByRole('button', { name: 'Continue' }).tap();
    await page.waitForTimeout(200);
  }
}

const note = (page) => page.locator('.re-guide');
const seen = (page, id) =>
  page.evaluate(
    (key) => window.__emblemRogueGame.scene.getScene('Battle').registry.get('hints').hasSeen(key),
    id,
  );
const screenOf = (page, col, row) =>
  page.evaluate(
    ([c, r]) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(c, r);
      const p = s._worldToScreen(w.x, w.y);
      const rect = s.game.canvas.getBoundingClientRect();
      return {
        x: rect.x + (p.x * rect.width) / s.scale.width,
        y: rect.y + (p.y * rect.height) / s.scale.height,
      };
    },
    [col, row],
  );

test('first-turn note shows once, is dismissible and never blocks the map', async ({ page }) => {
  await openBattle(page, 'full');
  await expect(note(page)).toBeVisible();
  await expect(note(page)).toHaveAttribute('data-guide', 'guide_first_turn');
  await expect(note(page)).toContainText('red eye');
  // Non-blocking: the battle still takes a tap on a unit while the note is up.
  const sera = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((p) => p.name === 'Sera');
    return [u.col, u.row];
  });
  const p = await screenOf(page, ...sera);
  await page.touchscreen.tap(p.x, p.y);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name),
    )
    .toBe('Sera');
  await page.screenshot({ path: test.info().outputPath('guidance-first-turn.png') });
  const firstTurn = page.locator('.re-guide[data-guide="guide_first_turn"]');
  await firstTurn.getByRole('button', { name: 'Got it' }).tap();
  await expect(firstTurn).toHaveCount(0);
  expect(await seen(page, 'guide_first_turn')).toBe(true);
  // Once: going back to idle on turn 1 does not bring it back.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.deselectUnit();
    s._guidance._key = '';
  });
  await page.waitForTimeout(400);
  await expect(firstTurn).toHaveCount(0);
});

test('Sera moved into reach gets the fragile warning; Attack explains itself', async ({ page }) => {
  await openBattle(page, 'full');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.get('hints').markSeen('guide_first_turn');
    s.registry.get('hints').markSeen('guide_healer_heals'); // Patient is hurt in this preset
    s._guidance.note?.close(false);
    const spots = [
      [6, 4],
      [7, 2],
      [6, 6],
      [8, 5],
    ];
    s.enemyUnits.slice(0, spots.length).forEach((e, i) => {
      [e.col, e.row] = spots[i];
      s.updateUnitPosition(e);
    });
  });
  const sera = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((p) => p.name === 'Sera');
    return [u.col, u.row];
  });
  let p = await screenOf(page, ...sera);
  await page.touchscreen.tap(p.x, p.y);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  const attack = hud.getByRole('button', { name: /^Attack/ });
  await expect(attack).toBeDisabled();
  await expect(attack).toContainText('No target in range 1–2');
  await expect(attack).not.toHaveClass(/mb-primary/);
  const target = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.selectedUnit;
    let best = null;
    for (const [key, entry] of s.movementRange) {
      if (entry.stoppable === false || key === `${u.col},${u.row}`) continue;
      const [col, row] = key.split(',').map(Number);
      const count = s._threatSight.query(u, col, row).count;
      if (!best || count > best.count) best = { col, row, count };
    }
    return best;
  });
  expect(target.count).toBeGreaterThan(0);
  p = await screenOf(page, target.col, target.row);
  await page.touchscreen.tap(p.x, p.y);
  await expect(note(page)).toHaveAttribute('data-guide', 'guide_fragile_in_reach');
  const enemies = target.count === 1 ? '1 enemy' : `${target.count} enemies`;
  await expect(note(page)).toContainText(`Sera would be in reach of ${enemies}`);
  await expect(note(page)).toContainText('Tap Back');
  await page.screenshot({ path: test.info().outputPath('guidance-fragile.png') });
  // The advice works while the note is up: Back undoes the move.
  await hud.getByRole('button', { name: 'Back', exact: true }).last().tap();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const u = window.__emblemRogueGame.scene.getScene('Battle').selectedUnit;
        return u ? [u.col, u.row] : null;
      }),
    )
    .toEqual(sera);
  // "Fewer tips" steps Guidance down to Light.
  await note(page)
    .getByRole('button', { name: /Fewer tips/ })
    .tap();
  await expect(note(page)).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').registry.get('settings').getGuidance(),
    ),
  ).toBe('light');
  expect(await seen(page, 'guide_fragile_in_reach')).toBe(true);
});

test('Light skips coaching but keeps essentials; Off shows nothing', async ({ page }) => {
  await openBattle(page, 'light');
  await page.waitForTimeout(600);
  await expect(note(page)).toHaveCount(0); // first-turn coaching is Full only
  // Commander at half HP is an essential rule: shown on Light.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits.find((u) => u.isCommander) || s.playerUnits[0];
    edric.currentHP = Math.floor(edric.stats.HP / 2);
    s._guidance._key = '';
  });
  await expect(note(page)).toHaveAttribute('data-guide', 'guide_commander_low_hp');
  await expect(note(page)).toContainText('the run ends');
  // Light keeps Fire Emblem's hidden Attack (no greyed row).
  await note(page).getByRole('button', { name: 'Got it' }).tap();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.get('settings').setGuidance('off');
    s.registry.get('hints').reset();
    s._guidance._key = '';
  });
  await page.waitForTimeout(600);
  await expect(note(page)).toHaveCount(0);
});

test('Settings cycles Guidance Full -> Light -> Off', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: true, guidance: 'full' }),
    );
  });
  await page.goto('/');
  await waitForScene(page, 'Title');
  await page.getByRole('button', { name: /^Settings$/ }).tap();
  const control = page.locator('[data-setting="guidance"]');
  await expect(control).toHaveText('Guidance · Full');
  await control.tap();
  await expect(control).toHaveText('Guidance · Light');
  await control.tap();
  await expect(control).toHaveText('Guidance · Off');
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_settings')),
  );
  expect(saved).toMatchObject({ guidance: 'off', hints: false });
  await control.tap();
  await expect(control).toHaveText('Guidance · Full');
});
