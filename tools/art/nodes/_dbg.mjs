import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await b.newContext({ viewport: { width: 844, height: 390 } })).newPage();
await page.goto('http://localhost:3107/?devScene=nodemap&preset=event&seed=42&event=twin_altar');
await page.waitForFunction(() => window.__sceneState?.activeScene === 'NodeMap');
await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
await page.locator('.re-node-map').waitFor();
await page.getByRole('button', { name: /^Event · (Available|You are here)/ }).first().click();
await page.getByRole('button', { name: 'Travel', exact: true }).click();
await page.locator('.ev-menu .ev-title').waitFor();
await page.waitForTimeout(1000);
console.log(
  await page.evaluate(() => {
    const band = document.querySelector('.ev-band');
    const cs = getComputedStyle(band, '::before');
    return {
      cls: band.className,
      h: getComputedStyle(band).height,
      bandH: getComputedStyle(band).getPropertyValue('--ev-band-h'),
      w: cs.width,
      left: cs.left,
      right: cs.right,
      bg: cs.backgroundSize,
      pos: cs.position,
    };
  }),
);
await b.close();
