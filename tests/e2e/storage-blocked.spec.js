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
    await expect(notice).toContainText("won't be saved");

    // Writes work for the session and the notice can be dismissed.
    const roundTrip = await page.evaluate(() => {
      localStorage.setItem('probe', 'ok');
      return localStorage.getItem('probe');
    });
    expect(roundTrip).toBe('ok');
    await notice.getByRole('button').click();
    await expect(notice).toHaveCount(0);

    expect(errors.filter((e) => /SecurityError|insecure/i.test(String(e)))).toEqual([]);
  });
});
