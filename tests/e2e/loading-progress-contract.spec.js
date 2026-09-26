import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });

test('ongoing file progress keeps a slow real preload out of recovery and reports completed files', async ({
  page,
}) => {
  await page.clock.install();
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('**/assets/sprites/characters/lordedric.png', async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto('/?devScene=title');
    await page.waitForFunction(
      () => window.__emblemRogueGame?.scene?.getScene('Boot')?._preloadComplete === false,
    );
    // Wait until the held image is the only transfer left. Until then, real progress
    // events from other files overwrite the status line after the emulated ones below.
    await page.waitForFunction(() => {
      const load = window.__emblemRogueGame.scene.getScene('Boot').load;
      const inflight = load.inflight.entries.map((file) => file.key);
      return load.list.size === 0 && inflight.length === 1 && inflight[0] === 'lordedric';
    });
    for (let i = 0; i < 8; i++) {
      await page.evaluate((i) => {
        const boot = window.__emblemRogueGame.scene.getScene('Boot');
        // The real loader is awaiting the held image; emulate successive byte
        // notifications from that same transfer while its request stays pending.
        boot.load.emit('fileprogress', { key: 'lordedric', percentComplete: (i + 1) / 10 });
      }, i);
      await page.clock.fastForward(5000);
    }
    await expect(page.locator('#boot-recovery-overlay')).toHaveCount(0);
    const feedback = await page.evaluate(() => {
      const boot = window.__emblemRogueGame.scene.getScene('Boot');
      const loader = document.getElementById('boot-loader');
      return {
        complete: boot._preloadComplete,
        recovery: boot._loader.stallShown,
        texts: [...loader.querySelectorAll('p')].map((p) => p.textContent),
      };
    });
    expect(feedback.complete).toBe(false);
    expect(feedback.recovery).toBe(false);
    expect(feedback.texts.some((text) => /\d+ \/ \d+ files ready/.test(text))).toBe(true);
    expect(feedback.texts.some((text) => text.includes('lordedric') && text.includes('80%'))).toBe(
      true,
    );
  } finally {
    release();
  }
});

test('the loading screen reads on an upright phone, recovers from a stall, and leaves with Boot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.addInitScript(() => {
    const s = document.createElement('style');
    s.textContent = '#rotate-prompt{display:none!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.append(s));
  });
  await page.clock.install();
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('**/assets/sprites/characters/lordedric.png', async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto('/?devScene=title');
    const loader = page.locator('#boot-loader');
    await expect(loader.getByRole('status')).toBeVisible();
    // DOM text keeps its size upright (canvas text was ~8 CSS px here).
    const size = await loader
      .getByRole('status')
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    expect(size).toBeGreaterThanOrEqual(12);
    await page.waitForFunction(() => {
      const load = window.__emblemRogueGame.scene.getScene('Boot').load;
      return load.list.size === 0 && load.inflight.size === 1;
    });
    await page.clock.fastForward(31_000);
    const reload = loader.getByRole('button', { name: 'Reload', exact: true });
    const safe = loader.getByRole('button', { name: 'Reload Safe Mode', exact: true });
    await expect(loader).toContainText('No download progress for 30 seconds');
    for (const button of [reload, safe]) {
      await expect(button).toBeInViewport({ ratio: 1 });
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
  } finally {
    release();
  }
  // Progress resumes: the recovery steps aside, and the loader leaves with Boot.
  await page.clock.runFor(2000);
  await page.waitForFunction(() => window.__sceneState?.activeScene === 'Title', null, {
    timeout: 60_000,
  });
  await expect(page.locator('#boot-loader')).toHaveCount(0);
});
