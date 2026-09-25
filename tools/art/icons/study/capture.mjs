// Audit captures + layout metrics of every item/service/upgrade surface (study only).
//   npx vite --port 3161 --host 127.0.0.1
//   node tools/art/icons/study/capture.mjs --out <dir> [--only shop-buy,rewards]
//        [--viewport phone|desktop|both] [--dpr 2]
// Phone = 844x390 with ?mobilePreview=1; desktop = 1280x800.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { SCREENS, newStudyPage } from './screens.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const base = arg('base', 'http://127.0.0.1:3161/');
const out = arg('out', 'References/items-study/audit');
const dpr = Number(arg('dpr', '2'));
const only = arg('only', null)?.split(',');
const which = arg('viewport', 'both');
fs.mkdirSync(out, { recursive: true });

const VIEWPORTS = {
  phone: { w: 844, h: 390, mobile: true },
  desktop: { w: 1280, h: 800, mobile: false },
};

const SELECTORS = [
  '.shop-row',
  '.shop-detail',
  '.reward-card',
  '.mu-row',
  '.mu-detail',
  '.re-menu-body button',
  'header',
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const metrics = {};
for (const [vp, cfg] of Object.entries(VIEWPORTS)) {
  if (which !== 'both' && which !== vp) continue;
  for (const [name, drive] of Object.entries(SCREENS)) {
    if (only && !only.includes(name)) continue;
    const page = await newStudyPage(browser, { dpr: vp === 'phone' ? dpr : 1, ...cfg });
    const file = `${out}/${name}-${cfg.w}x${cfg.h}.png`;
    try {
      await drive(page, base);
      await page.screenshot({ path: file });
      metrics[`${name}@${vp}`] = await page.evaluate((sels) => {
        const r = {};
        for (const s of sels) {
          const els = [...document.querySelectorAll(s)].filter((e) => e.offsetParent);
          if (!els.length) continue;
          r[s] = els.slice(0, 4).map((e) => {
            const b = e.getBoundingClientRect();
            return {
              x: Math.round(b.x),
              y: Math.round(b.y),
              w: Math.round(b.width),
              h: Math.round(b.height),
              text: (e.innerText || '').slice(0, 40).replace(/\s+/g, ' '),
            };
          });
        }
        return r;
      }, SELECTORS);
      console.log('captured', name, vp, page.errors.length ? page.errors : '');
    } catch (e) {
      console.log('FAILED', name, vp, e.message.split('\n')[0]);
      await page.screenshot({ path: file.replace('.png', '-failed.png') }).catch(() => {});
    }
    await page.context().close();
  }
}
fs.writeFileSync(`${out}/metrics.json`, JSON.stringify(metrics, null, 1));
await browser.close();
