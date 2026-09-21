import { test, expect } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';
test('repeated battle RNG preserves live text textures and destroys their own entries', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  const result = await page.evaluate(() => {
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    const rng = Math.random;
    let first, second;
    try {
      Math.random = () => 0;
      first = scene.add.text(0, 0, 'First live text');
      second = scene.add.text(0, 20, 'Second live text');
    } finally {
      Math.random = rng;
    }
    const keys = [first.texture.key, second.texture.key];
    second.destroy();
    const firstSurvived = scene.textures.exists(keys[0]) && first.texture.get() === first.frame;
    first.destroy();
    return { keys, firstSurvived, cleaned: keys.every((key) => !scene.textures.exists(key)) };
  });
  expect(result.keys[0]).not.toBe(result.keys[1]);
  expect(result.firstSurvived).toBe(true);
  expect(result.cleaned).toBe(true);
  expect(errors).toEqual([]);
});
