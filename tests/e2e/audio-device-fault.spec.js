import { test, expect, devices } from '@playwright/test';
import { waitForBattleState, waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });

// iOS WebKit can refuse to start its audio engine ("InvalidStateError: Failed to
// start the audio device") after an interruption. Inject that refusal into the real
// AudioContext during reward selection, through every path that resumes it (Phaser's
// focus and visibility handlers, a tap's recovery, a bare rejection), and require the
// game to carry on: no Runtime Error modal, and the reward can still be chosen.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const proto = (window.BaseAudioContext || window.AudioContext).prototype;
    const stateGetter = Object.getOwnPropertyDescriptor(proto, 'state').get;
    const nativeResume = window.AudioContext.prototype.resume;
    window.__audioFaultInjected = false;
    window.__audioFaultResumes = 0;
    Object.defineProperty(proto, 'state', {
      configurable: true,
      get() {
        return window.__audioFaultInjected ? 'interrupted' : stateGetter.call(this);
      },
    });
    window.AudioContext.prototype.resume = function resume() {
      if (!window.__audioFaultInjected) return nativeResume.call(this);
      window.__audioFaultResumes++;
      return Promise.reject(
        new DOMException('Failed to start the audio device', 'InvalidStateError'),
      );
    };
  });
});

test('an audio device refusal during reward selection is not a runtime error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await waitForBattleState(page, 'PLAYER_IDLE');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.set('activeSlot', 1);
    s.onVictory();
  });
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const r = s._lootController.mobileRewards;
    r.choices[0] = {
      type: 'forge',
      item: { type: 'Whetstone', name: 'Silver Whetstone', forgeStat: 'choice' },
    };
    r.selected = 0;
    r.render();
  });

  await page.evaluate(async () => {
    window.__audioFaultInjected = true;
    const sound = window.__emblemRogueGame.sound;
    sound.locked = false;
    // Phaser's own handlers call resume() and drop the promise.
    sound.onFocus();
    sound.onGameVisible();
    // A tap and a return to the foreground: audio recovery tries again.
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('touchend'));
    window.dispatchEvent(new Event('focus'));
    // A refusal from a path nobody catches.
    Promise.reject(new DOMException('Failed to start the audio device', 'InvalidStateError'));
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  await expect(page.locator('#runtime-fatal-overlay')).toHaveCount(0);
  const seen = await page.evaluate(() => ({
    resumes: window.__audioFaultResumes,
    faults: (window.__emblemRogueAudioFaults || []).map((f) => f.message),
  }));
  expect(seen.resumes).toBeGreaterThan(0);
  expect(seen.faults).toContain('Failed to start the audio device');

  await rewards.getByRole('button', { name: 'Choose reward', exact: true }).tap();
  await rewards.getByRole('button', { name: 'Continue', exact: true }).tap();
  await rewards.getByRole('button', { name: 'Continue', exact: true }).tap();
  await rewards.getByRole('button', { name: 'Apply reward', exact: true }).tap();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle')._lootController.claimed.size,
      ),
    )
    .toBe(1);
  await expect(page.locator('#runtime-fatal-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});
