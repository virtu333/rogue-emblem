import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
const url = '/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1';
async function boot(page) {
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
}
test('battle speed cycles and persists without changing accessibility or quality', async ({
  page,
}, info) => {
  await boot(page);
  await page.evaluate(async () => {
    const { SettingsOverlay } = await import('/src/ui/SettingsOverlay.js');
    new SettingsOverlay(window.__emblemRogueGame.scene.getScene('Battle')).show();
  });
  await page.getByRole('button', { name: 'Battle speed · Normal', exact: true }).click();
  await page.getByRole('button', { name: 'Battle speed · Fast', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Battle speed · Instant', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('battle-speed-settings.png') });
  await page.keyboard.press('Escape');
  await page.reload();
  await waitForScene(page, 'Battle');
  expect(
    await page.evaluate(() => window.__emblemRogueGame.registry.get('settings').getBattleSpeed()),
  ).toBe('instant');
});
test('real seeded combat resolution and presentation agree across speed, motion and quality', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let reference;
  for (const motion of [false, true])
    for (const quality of ['high', 'low'])
      for (const speed of ['normal', 'fast', 'instant']) {
        await boot(page);
        const outcome = await page.evaluate(
          async ({ speed, motion, quality }) => {
            const s = window.__emblemRogueGame.scene.getScene('Battle');
            const settings = s.registry.get('settings');
            settings.setBattleSpeed(speed);
            settings.setReduceMotion(motion);
            settings.setEffectsQuality(quality);
            const a = s.playerUnits.find((u) => u.weapon && u.weapon.type !== 'Staff');
            const b = s.enemyUnits[0];
            // Run creation rolls lord traits before this test seeds combat. Pin
            // combat inputs so the matrix compares presentation, not fresh recruits.
            for (const unit of [a, b]) {
              unit.stats = {
                HP: 100,
                STR: 12,
                MAG: 0,
                SKL: 15,
                SPD: 10,
                DEF: 5,
                RES: 5,
                LCK: 0,
                MOV: 5,
              };
              unit.currentHP = 100;
              unit.traits = [];
              unit.accessory = null;
              unit.affixes = [];
              unit._conditions = [];
            }
            a.weapon = { ...a.weapon, crit: 100 }; // exercise crit reactions/camera/pop/cut-in
            a.skills = [];
            b.skills = [];
            a.col = b.col - 1;
            a.row = b.row;
            const home = [a, b].map((u) => ({
              x: u.graphic.x,
              y: u.graphic.y,
              sx: u.graphic.scaleX,
              sy: u.graphic.scaleY,
            }));
            s.battleState = 'COMBAT_RESOLVING';
            const { createSeededRng } = await import('/src/engine/BlessingEngine.js');
            const original = Math.random;
            Math.random = createSeededRng(240);
            let resolved;
            let nextRandom;
            try {
              resolved = await s._runCombatResolution(
                a,
                b,
                s._prepareCombatContext(a, b, { isPlayerInitiator: true }),
              );
              nextRandom = Math.random();
            } finally {
              Math.random = original;
            }
            const settled = [a, b].map((u) => ({
              x: u.graphic.x,
              y: u.graphic.y,
              sx: u.graphic.scaleX,
              sy: u.graphic.scaleY,
            }));
            return {
              result: resolved.result,
              nextRandom,
              hp: [a.currentHP, b.currentHP],
              home,
              settled,
              remaining: s._combatFx._motionTweens.size,
              snapshot: s._combatSpeedSnapshot ?? null,
            };
          },
          { speed, motion, quality },
        );
        expect(outcome.settled).toEqual(outcome.home);
        expect(outcome.remaining).toBe(0);
        expect(outcome.snapshot).toBeNull();
        const comparable = {
          result: outcome.result,
          hp: outcome.hp,
          nextRandom: outcome.nextRandom,
        };
        expect(Number.isFinite(outcome.nextRandom)).toBe(true);
        if (!reference) reference = comparable;
        expect(comparable).toEqual(reference);
      }
  expect(errors).toEqual([]);
});
