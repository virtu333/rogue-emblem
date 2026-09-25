import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
// clock.runFor(10000) renders every fake frame: give loaded machines room.
test.setTimeout(60000);

async function boot(page, reduced = false, promotion = false, speed = 'normal') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.evaluate(
    async ({ reduced, promotion, speed }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.registry.get('settings').setReduceMotion(reduced);
      s.registry.get('settings').setBattleSpeed(speed);
      s.battleState = 'COMBAT_RESOLVING';
      const { LevelUpPopup } = await import('/src/ui/LevelUpPopup.js');
      const u = s.playerUnits[0];
      window.originalStats = JSON.stringify(u.stats);
      window.ticks = 0;
      const audio = s.registry.get('audio');
      const play = audio.playSFX.bind(audio);
      audio.playSFX = (key) => {
        if (key === 'sfx_cursor') window.ticks++;
        else play(key);
      };
      window.settled = 0;
      window.popup = new LevelUpPopup(
        s,
        u,
        { newLevel: promotion ? 1 : 2, gains: { HP: 1, STR: 1, ...(promotion ? { MOV: 1 } : {}) } },
        promotion,
        ['A long newly learned skill to check the small-phone layout'],
        promotion ? { STR: 5 } : null,
      );
      window.popup.show().then(() => window.settled++);
    },
    { reduced, promotion, speed },
  );
  return {
    errors,
    dialog: page.getByRole('dialog', { name: promotion ? 'Promotion' : 'Level up', exact: true }),
  };
}

// Level-ups are the growth card (GrowthCeremonyController): pips ignite in
// ember on the scene clock, a first press completes the reveal, the next
// continues. Promotions keep this dialog only as the canvas-era fallback
// (the battle, church and roster paths play the promotion rite).
test('level up reveals, holds and dismisses without mutating results', async ({ page }, info) => {
  const { errors, dialog } = await boot(page, false, false);
  await expect(dialog.getByRole('button', { name: 'Reveal gains', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /Edric/ })).toBeInViewport();
  await page.clock.runFor(20);
  expect(await page.locator('.mobile-battle-hud').evaluate((e) => e.inert)).toBe(true);
  // Two gains: two ember ticks as their pips ignite, then the card holds.
  await page.clock.runFor(1200);
  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.ticks)).toBe(2);
  await expect(dialog.locator('.gr-level-row.is-gain')).toHaveCount(2);
  await expect(dialog.locator('.re-gain')).toHaveCount(2);
  expect(await page.evaluate(() => window.settled)).toBe(0);
  await page.clock.runFor(10000);
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.screenshot({ path: info.outputPath('revealed.png') });
  await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.settled)).toBe(1);
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].stats),
    ),
  ).toBe(await page.evaluate(() => window.originalStats));
  expect(errors).toEqual([]);
});

test('a press mid-reveal completes it; the next press continues', async ({ page }) => {
  const { errors, dialog } = await boot(page, false, false);
  await page.clock.runFor(200);
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  const ticks = await page.evaluate(() => window.ticks);
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.ticks)).toBe(ticks);
  expect(await page.evaluate(() => window.settled)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.settled)).toBe(1);
  expect(errors).toEqual([]);
});

test('promotion fallback dialog reveals, holds and dismisses without mutating results', async ({
  page,
}, info) => {
  const { errors, dialog } = await boot(page, false, true);
  await expect(dialog.getByRole('button', { name: 'Reveal gains', exact: true })).toBeVisible();
  expect(await dialog.locator('.re-menu-body').evaluate((e) => e.scrollTop)).toBe(0);
  await page.clock.runFor(20);
  const first = dialog.locator('dd').first();
  const initial = Number(await first.textContent());
  await page.clock.runFor(100);
  await expect(first).toHaveText(`${initial + 1} (+1)`);
  await page.clock.runFor(960);
  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect(dialog.locator('dt').filter({ hasText: /^MOV$/ })).toHaveCount(1);
  await page.clock.runFor(10000);
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.ticks)).toBe(3);
  await page.screenshot({ path: info.outputPath('revealed.png') });
  await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.settled)).toBe(1);
  expect(errors).toEqual([]);
});

test('reduced motion shows every gain immediately with no reveal ticks', async ({ page }) => {
  const { dialog, errors } = await boot(page, true);
  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect(dialog.locator('.re-gain')).toHaveCount(2);
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.ticks)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.settled)).toBe(1);
  expect(errors).toEqual([]);
});

test('shutdown during reveal cancels ticks and settles exactly once', async ({ page }) => {
  const { dialog, errors } = await boot(page);
  await page.clock.runFor(180);
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle').events.emit('shutdown'),
  );
  await expect(dialog).toHaveCount(0);
  const ticks = await page.evaluate(() => window.ticks);
  await page.clock.runFor(2000);
  await page.evaluate(() => window.popup.destroy());
  expect(await page.evaluate(() => [window.ticks, window.settled])).toEqual([ticks, 1]);
  expect(errors).toEqual([]);
});

test('Instant level-up opens revealed and closes with one tap', async ({ page }) => {
  const { dialog, errors } = await boot(page, false, false, 'instant');
  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect(dialog.locator('.re-gain')).toHaveCount(2);
  // One tap continues (past the ceremony's accidental-tap guard).
  await page.clock.runFor(200);
  await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => [window.ticks, window.settled])).toEqual([0, 1]);
  expect(errors).toEqual([]);
});
