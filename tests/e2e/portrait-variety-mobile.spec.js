import { test, expect, devices } from '@playwright/test';
import {
  SHOTS,
  expectDistinctFighters,
  listFaces,
  openRosterWithTwoFighters,
  servicesShowFaces,
} from './portraitVariety.helpers.js';

// Portrait variety on a phone (844x390): see portrait-variety.spec.js.
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
test('two Fighters in the roster wear different faces', async ({ page }) => {
  const { sheet, faces } = await openRosterWithTwoFighters(page);
  await expectDistinctFighters(page, faces);
  // Unit rows are named "<name>, Level <n> <class>, HP …" (#78).
  await sheet.getByRole('button', { name: /^Roderick, Level/ }).click();
  await expect(sheet.getByRole('button', { name: /^Roderick, Level/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(sheet.locator('.mr-summary [data-portrait-id]')).toHaveAttribute(
    'data-portrait-id',
    /^generic_/,
  );
  const summary = await sheet
    .locator('.mr-summary [data-portrait-id]')
    .getAttribute('data-portrait-id');
  const rows = await listFaces(page);
  expect(summary).toBe(rows.find((r) => r.name.includes('Roderick')).id);
  await page.screenshot({ path: `${SHOTS}/roster-844x390.png` });
});

test('service lists show the same faces (colosseum)', async ({ page }) => {
  test.setTimeout(90000);
  await servicesShowFaces(page, '844x390');
});
