#!/usr/bin/env node
// Capture the item-art surfaces at phone (844x390, mobilePreview) and desktop (1280x800)
// through the study's dev-route drivers (tools/art/icons/study/screens.mjs).
//   node tools/art/icons/captureSurfaces.mjs --base http://127.0.0.1:3157/ --out dir
//        [--only shop-buy,church] [--tag before] [--phone-only|--desktop-only] [--dpr 2]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { SCREENS, newStudyPage } from './study/screens.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const base = arg('base', 'http://127.0.0.1:3157/');
const out = arg('out', 'References/items-art/captures');
const tag = arg('tag', 'after');
const only = arg('only', null)?.split(',');
const dpr = Number(arg('dpr', 2));
const exe = ['/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
fs.mkdirSync(out, { recursive: true });

// Production-only drivers on top of the study's.
Object.assign(SCREENS, {
  async 'upgrade-bought'(page, base) {
    await SCREENS['upgrades-economy'](page, base);
    await page.locator('.mu-buy').click();
    await page.waitForTimeout(300);
  },
  async 'upgrades-lords'(page, base) {
    await SCREENS.upgrades(page, base);
    await page.locator('.mu-tabs button', { hasText: 'Lords' }).click();
    await page.waitForTimeout(500);
  },
});

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const views = [];
if (!argv.includes('--desktop-only')) views.push({ name: '844x390', w: 844, h: 390, mobile: true });
if (!argv.includes('--phone-only')) views.push({ name: '1280x800', w: 1280, h: 800, mobile: false });
for (const [name, drive] of Object.entries(SCREENS)) {
  if (only && !only.includes(name)) continue;
  for (const v of views) {
    const page = await newStudyPage(browser, { dpr: v.mobile ? dpr : 1, w: v.w, h: v.h, mobile: v.mobile });
    try {
      await drive(page, base);
      await page.waitForTimeout(700);
      const file = path.join(out, `${name}-${tag}-${v.name}.png`);
      await page.screenshot({ path: file });
      console.log(file, page.errors.length ? `errors: ${page.errors.join(' | ')}` : '');
    } catch (e) {
      console.log(`FAILED ${name} ${v.name}: ${e.message.split('\n')[0]}`);
    } finally {
      await page.context().close();
    }
  }
}
await browser.close();
