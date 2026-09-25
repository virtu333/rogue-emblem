// Scratch explorer (study only): opens dev routes at phone size and screenshots them.
//   node tools/art/icons/study/explore.mjs <out-dir> 'name|query' ...
import { chromium } from '@playwright/test';

const [outDir, ...routes] = process.argv.slice(2);
const base = process.env.BASE || 'http://127.0.0.1:3611/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
});
await ctx.addInitScript(() => {
  localStorage.setItem(
    'emblem_rogue_settings',
    JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
  );
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
for (const r of routes) {
  const [name, q] = r.split('|');
  await page.goto(`${base}?${q}`, { waitUntil: 'load' });
  await page.waitForTimeout(Number(process.env.WAIT || 9000));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
}
await browser.close();
