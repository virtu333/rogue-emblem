#!/usr/bin/env node
// Screenshot a dev-server URL (design review and README captures).
//   node tools/art/icons/shot.mjs <url> <out.png> [--w 1280] [--h 800] [--dpr 1] [--full]
//        [--wait selector] [--delay ms]
// Uses the preinstalled Chromium (/opt/pw-browsers/chromium) when present.
import fs from 'node:fs';
import { chromium } from 'playwright';

const [url, out, ...rest] = process.argv.slice(2);
const arg = (k, d) => (rest.includes(`--${k}`) ? rest[rest.indexOf(`--${k}`) + 1] : d);
const exe = ['/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({
  viewport: { width: Number(arg('w', 1280)), height: Number(arg('h', 800)) },
  deviceScaleFactor: Number(arg('dpr', 1)),
});
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(url, { waitUntil: 'networkidle' });
if (arg('wait')) await page.waitForSelector(arg('wait'));
await page.waitForTimeout(Number(arg('delay', 300)));
await page.screenshot({ path: out, fullPage: rest.includes('--full') });
await browser.close();
console.log(out);
