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
      return {
        complete: boot._preloadComplete,
        recovery: boot._stallUi.length,
        texts: boot.children.list.filter((o) => o.text).map((o) => o.text),
      };
    });
    expect(feedback.complete).toBe(false);
    expect(feedback.recovery).toBe(0);
    expect(feedback.texts.some((text) => /\d+ \/ \d+ files ready/.test(text))).toBe(true);
    expect(feedback.texts.some((text) => text.includes('lordedric') && text.includes('80%'))).toBe(
      true,
    );
  } finally {
    release();
  }
});
