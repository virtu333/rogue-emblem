// E2E: a browser that blocks site data (reading `localStorage` throws) still plays the session.
import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, collectErrors } from './helpers.js';

test.describe('storage blocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException('The operation is insecure.', 'SecurityError');
          },
        });
      }
    });
  });

  test('Title renders, play is session-only and says so', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await waitForGame(page);
    await waitForScene(page, 'Title');

    const notice = page.locator('#session-only-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("won't be saved if you reload or close");

    // The notice never intercepts a tap meant for the game; only its close button takes one.
    await expect(notice).toHaveCSS('pointer-events', 'none');
    await expect(notice.getByRole('button')).toHaveCSS('pointer-events', 'auto');

    // Writes work for the session and the notice can be dismissed.
    const roundTrip = await page.evaluate(() => {
      localStorage.setItem('probe', 'ok');
      return localStorage.getItem('probe');
    });
    expect(roundTrip).toBe('ok');
    // Past the Title: starting a game reads the slots and still works.
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Battle');

    await notice.getByRole('button').click();
    await expect(notice).toHaveCount(0);

    // sessionStorage stays refused, so a stale-chunk error can never reload the run away.
    expect(
      await page.evaluate(() => {
        try {
          return window.sessionStorage ? 'works' : 'missing';
        } catch {
          return 'refused';
        }
      }),
    ).toBe('refused');

    expect(errors.filter((e) => /SecurityError|insecure/i.test(String(e)))).toEqual([]);
  });
});
