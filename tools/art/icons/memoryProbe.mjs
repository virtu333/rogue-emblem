#!/usr/bin/env node
// Texture-memory probe for the item art (mobile budget, docs/art-direction/items/production).
// Boots the game through the study's dev-route drivers and reports, per screen:
//   - Phaser textures: count and decoded bytes (w*h*4 over every texture source),
//     and how many are legacy `icon_*` keys;
//   - DOM item art actually displayed: atlases, painted heroes, vignettes and blessing
//     cards, each decoded once (w*h*4), with their download bytes.
//   node tools/art/icons/memoryProbe.mjs --base http://127.0.0.1:3157/ [--only nodemap,shop-buy]
//        [--phone-only] [--out file.json]
import fs from 'node:fs';
import { chromium } from 'playwright';
import { SCREENS, newStudyPage } from './study/screens.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const base = arg('base', 'http://127.0.0.1:3157/');
const only = arg('only', 'nodemap,shop-buy,church,upgrades,rewards')?.split(',');
const exe = ['/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const views = [{ name: '844x390', w: 844, h: 390, mobile: true, dpr: 3 }];
if (!argv.includes('--phone-only'))
  views.push({ name: '1280x800', w: 1280, h: 800, mobile: false, dpr: 1 });

async function measure(page) {
  return page.evaluate(async () => {
    const g = window.__emblemRogueGame;
    let phaserBytes = 0;
    let phaserCount = 0;
    let legacyIcons = 0;
    // Textures cut from one shared page (traced sprites) share a source image: count
    // each decoded image once.
    const seen = new Set();
    for (const [key, tex] of Object.entries(g?.textures?.list || {})) {
      if (key.startsWith('__')) continue;
      phaserCount += 1;
      if (key.startsWith('icon_')) legacyIcons += 1;
      for (const s of tex.source || []) {
        const image = s.image || s.source || s;
        if (seen.has(image)) continue;
        seen.add(image);
        phaserBytes += (s.width || 0) * (s.height || 0) * 4;
      }
    }
    // DOM item art on screen: every URL an item-art element is actually painting.
    const urls = new Set();
    const bg = (el, pseudo) => getComputedStyle(el, pseudo).backgroundImage;
    const add = (value) => {
      for (const m of String(value || '').matchAll(/url\("?([^")]+)"?\)/g))
        if (/assets\/ui\/(items|moments)\//.test(m[1])) urls.add(m[1]);
    };
    const visible = (el) =>
      el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
    for (const el of document.querySelectorAll(
      '.ia-glyph, .ia-band, .ia-card-art, [class*="ia-"]',
    )) {
      if (!visible(el)) continue;
      add(bg(el));
      add(bg(el, '::before'));
    }
    for (const img of document.querySelectorAll('img'))
      if (visible(img)) add(img.currentSrc || img.src);
    const art = [];
    for (const url of urls) {
      const im = new Image();
      im.src = url;
      try {
        await im.decode();
      } catch {
        continue;
      }
      const entry = performance.getEntriesByName(url)[0];
      art.push({
        url: url.replace(/^.*assets\//, 'assets/'),
        w: im.naturalWidth,
        h: im.naturalHeight,
        decoded: im.naturalWidth * im.naturalHeight * 4,
        transfer: entry?.encodedBodySize || entry?.transferSize || null,
      });
    }
    return {
      phaser: { count: phaserCount, decodedMB: +(phaserBytes / 1048576).toFixed(2), legacyIcons },
      itemArt: {
        files: art,
        decodedMB: +(art.reduce((a, b) => a + b.decoded, 0) / 1048576).toFixed(3),
      },
    };
  });
}

const report = {};
for (const name of only) {
  if (!SCREENS[name]) continue;
  for (const v of views) {
    const page = await newStudyPage(browser, { dpr: v.dpr, w: v.w, h: v.h, mobile: v.mobile });
    try {
      await SCREENS[name](page, base);
      await page.waitForTimeout(1200);
      report[`${name} ${v.name}`] = await measure(page);
      const r = report[`${name} ${v.name}`];
      console.log(
        `${name} ${v.name}: phaser ${r.phaser.count} textures ${r.phaser.decodedMB} MB (legacy icon_* ${r.phaser.legacyIcons}); item art ${r.itemArt.files.length} files ${r.itemArt.decodedMB} MB`,
      );
    } catch (e) {
      console.log(`FAILED ${name} ${v.name}: ${e.message.split('\n')[0]}`);
    } finally {
      await page.context().close();
    }
  }
}
await browser.close();
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(report, null, 2));
