import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

// Phaser's paused status must not invalidate the current battle session: enemy
// resolution can enter another presentation wait while a history/pause view is
// open. Drive the real SceneManager so mock isActive() semantics cannot hide it.
test('a paused enemy phase finishes and returns control when the same battle resumes', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: 'instant' }),
    ),
  );
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  const session = await page.evaluate(() => {
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    // Pause before the enemy phase begins, so every first presentation wait
    // enters with the actual Phaser Systems status already PAUSED.
    scene.game.scene.pause('Battle');
    if (!scene.scene.isPaused()) throw new Error('Phaser did not pause the battle');
    const session = scene._battleSession;
    scene.turnManager.endPlayerPhase();
    return session;
  });
  await page
    .waitForFunction(
      (session) => {
        const scene = window.__emblemRogueGame.scene.getScene('Battle');
        return (
          scene._battleSession === session &&
          scene.turnManager.turnNumber === 2 &&
          scene.turnManager.currentPhase === 'player' &&
          scene.battleState === 'PLAYER_IDLE'
        );
      },
      session,
      { timeout: 20000 },
    )
    .catch(async (error) => {
      const state = await page.evaluate(() => {
        const scene = window.__emblemRogueGame.scene.getScene('Battle');
        return {
          phase: scene.turnManager.currentPhase,
          turn: scene.turnManager.turnNumber,
          battle: scene.battleState,
          paused: scene.scene.isPaused(),
          guards: [...(scene._lifecycleAwaitGuards || [])].map((guard) => guard.label),
          timers: [...(scene._managedSceneTimers || [])].map((timer) => ({
            delay: timer.delay,
            elapsed: timer.elapsed,
            dispatched: timer.hasDispatched,
          })),
        };
      });
      throw new Error(`${error.message}; battle state: ${JSON.stringify(state)}`);
    });
  const outcome = await page.evaluate(() => {
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    const paused = scene.scene.isPaused();
    const alive = scene.playerUnits.every((unit) => unit.currentHP > 0);
    scene.game.scene.resume('Battle');
    return { paused, alive, active: scene.scene.isActive() };
  });
  expect(outcome).toEqual({ paused: true, alive: true, active: true });
  expect(errors).toEqual([]);
});
