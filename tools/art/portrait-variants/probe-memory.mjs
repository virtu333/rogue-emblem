#!/usr/bin/env node
// Texture memory probe for portrait variety (docs/mobile-memory-budget.md).
//
//   node tools/art/portrait-variants/probe-memory.mjs --url http://localhost:3147 [--chrome PATH]
//
// Loads the game in Chromium at 844x390 (iPhone profile) and reports decoded
// texture memory (width x height x 4 per texture source, counted once) at the
// Title, on the route map with the roster open (plus the decoded size of the
// DOM portrait images on screen), and in a battle. Run it against a build of
// main and of this branch to compare.
import { chromium, devices } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const URL = opt('--url', 'http://localhost:3147');
const CHROME = opt('--chrome', process.env.CHROME_PATH || undefined);

const measure = () => {
  const g = window.__emblemRogueGame;
  let tex = 0;
  let portraitTex = 0;
  let variantTex = 0;
  const seen = new Set();
  for (const k of g.textures.getTextureKeys())
    for (const s of g.textures.get(k).source)
      if (!seen.has(s)) {
        seen.add(s);
        const b = s.width * s.height * 4;
        tex += b;
        if (/portrait/.test(k)) portraitTex += b;
        if (k.startsWith('pc98v-')) variantTex += b;
      }
  let dom = 0;
  let domCount = 0;
  for (const img of document.querySelectorAll('img.pc98-portrait'))
    if (img.complete && img.naturalWidth) {
      dom += img.naturalWidth * img.naturalHeight * 4;
      domCount++;
    }
  return {
    textureMB: +(tex / 1e6).toFixed(2),
    portraitTextureMB: +(portraitTex / 1e6).toFixed(2),
    variantTextureKB: +(variantTex / 1e3).toFixed(1),
    domPortraits: domCount,
    domPortraitKB: +(dom / 1e3).toFixed(1),
  };
};

async function scene(page, key) {
  await page.waitForFunction(
    (k) => window.__emblemRogueGame?.scene?.getScene(k)?.sys?.isActive(),
    key,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch({ executablePath: CHROME });
const out = {};
try {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 844, height: 390 },
  });
  const page = await context.newPage();
  await page.goto(`${URL}/`);
  await scene(page, 'Title');
  out.title = await page.evaluate(measure);

  await page.goto(`${URL}/?devScene=nodemap&preset=battle_smoke&seed=42`);
  await scene(page, 'NodeMap');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.dialogueOverlay?.hide?.();
    s._openRoster();
  });
  await page.waitForTimeout(1500);
  out.rosterOpen = await page.evaluate(measure);

  await page.goto(`${URL}/?devScene=battle&preset=battle_smoke&seed=42`);
  await scene(page, 'Battle');
  await page.waitForTimeout(1500);
  out.battle = await page.evaluate(measure);
  await context.close();
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
