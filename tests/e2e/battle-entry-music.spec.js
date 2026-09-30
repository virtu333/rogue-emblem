// Entering a battle is never silent (playtest 2026-09-28: the castle theme "was silent
// at the beginning of the map"). The route's track plays on through Travel, the deploy
// screen and the battle track's load, then gives way to the battle's own track.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.setTimeout(120_000);

test('the route track bridges into the battle track with no silent gap', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0.2, sfxVolume: 0, hints: false }),
    ),
  );
  await page.goto('/?devScene=nodemap&preset=roster_checks&seed=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();

  const nodeId = await page.evaluate(
    () =>
      window.__emblemRogueGame.scene
        .getScene('NodeMap')
        .runManager.getAvailableNodes()
        .find((node) => node.type === 'battle')?.id,
  );
  expect(nodeId).toBeTruthy();
  const node = page.locator(`.re-node-map [data-node="${nodeId}"]`);
  await node.click();
  // Browsers start audio only after a user gesture, which Phaser hears on the page body
  // (in play, the title screen's taps; the route's own DOM keeps its events to itself).
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Shift');
  await node.focus();
  await page.waitForFunction(() => {
    const audio = window.__emblemRogueGame.registry.get('audio');
    return audio.currentMusicKey?.startsWith('music_') && audio.currentMusic?.isPlaying;
  });

  // Sample the playing track every frame from Travel until the battle's track sounds.
  await page.evaluate(() => {
    const audio = window.__emblemRogueGame.registry.get('audio');
    const log = (window.__musicLog = []);
    const tick = () => {
      const key = audio.currentMusic?.isPlaying ? audio.currentMusicKey : null;
      if (log.at(-1) !== key) log.push(key);
      if (!key?.startsWith('music_battle') && !key?.startsWith('music_boss')) {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });
  const routeKey = await page.evaluate(() => window.__musicLog[0]);
  expect(routeKey).toMatch(/^music_/);

  await page.getByRole('button', { name: 'Travel', exact: true }).click();
  await waitForScene(page, 'Battle');
  const deploy = page.getByRole('dialog', { name: 'Deploy units', exact: true });
  await page.waitForFunction(
    () =>
      ['DEPLOY_SELECTION', 'DEPLOY_POSITIONING', 'PLAYER_IDLE'].includes(
        window.__sceneState?.battle?.state,
      ),
    null,
    { timeout: 30_000 },
  );
  if (await deploy.isVisible()) {
    // The deploy screen plays the route's track, not silence.
    expect(await page.evaluate(() => window.__musicLog.at(-1))).toBe(routeKey);
    await deploy.getByRole('button', { name: /^Sera/ }).click();
    await deploy.getByRole('button', { name: /^Gaspar/ }).click();
    await deploy.getByRole('button', { name: 'Deploy', exact: true }).click();
  }
  await page.waitForFunction(
    () => /^music_(battle|boss)/.test(window.__musicLog.at(-1) || ''),
    null,
    { timeout: 30_000 },
  );
  const log = await page.evaluate(() => window.__musicLog);
  // The route's track, then the battle's: never a frame with nothing playing.
  expect(log).toEqual([routeKey, log.at(-1)]);
  expect(errors).toEqual([]);
});
