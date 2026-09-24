#!/usr/bin/env node
// Portrait review captures (dev server, dev routes only): dialogue, boss
// card, crit cut-ins, roster, home base, battle forecast and Sera's rewind
// offer — before (?portraitArt=classic) and after (PC-98) — as WebP.
//
//   npx vite --port 3303 --host 127.0.0.1
//   node tools/art/pc98/capture.mjs --base http://127.0.0.1:3303 \
//     --viewport 844x390m3 --art pc98 [--only dialogue,boss] [--out DIR]
//
// Viewport "WxH" is desktop at DPR 1; "WxHm<dpr>" emulates an iPhone (touch
// UA, ?mobilePreview=1) at that device pixel ratio. CHROMIUM_PATH overrides
// the browser binary.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const arg = (name, fallback) =>
  argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback;
const base = arg('base', 'http://127.0.0.1:3303');
const outDir = arg('out', 'docs/art-direction/build/portraits-pc98');
const art = arg('art', 'pc98');
const vp = /^(\d+)x(\d+)(?:m(\d(?:\.\d+)?))?$/.exec(arg('viewport', '844x390m3'));
if (!vp) throw new Error('bad --viewport');
const W = Number(vp[1]);
const H = Number(vp[2]);
const phone = Boolean(vp[3]);
const dpr = phone ? Number(vp[3]) : Number(arg('dpr', '1'));
const only = arg('only', null)?.split(',');
fs.mkdirSync(outDir, { recursive: true });
const tag = `${W}x${H}${phone ? 'm' : ''}@${dpr}x-${art}`;
const q = `${phone ? '&mobilePreview=1' : ''}${art === 'classic' ? '&portraitArt=classic' : ''}`;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

async function newPage() {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: dpr,
    ...(phone
      ? {
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
          hasTouch: true,
        }
      : {}),
  });
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: 'normal' }),
    );
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('.re-hint-toast'))
        if (/Save failed/.test(toast.textContent)) toast.style.display = 'none';
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}
const sleep = (page, ms) => page.waitForTimeout(ms);
const shot = async (page, name) => {
  const path = `${outDir}/${name}-${tag}.webp`;
  await sharp(await page.screenshot())
    .webp({ lossless: true, effort: 4 })
    .toFile(path);
  console.log('shot', path);
};
const waitScene = (page, key) =>
  page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, { timeout: 60000 });
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function settleBattle(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const st = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        state: s?.battleState,
        card: !!document.querySelector('.ce-boss-layer'),
        locked: s?.isStoryInputLocked?.(),
        turn: s?.turnManager?.turnNumber,
      };
    });
    if (st.card) await page.mouse.click(40, 40);
    else if (st.state === 'DEPLOY_SELECTION') {
      await page.evaluate(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        b.children.list
          .filter(
            (o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'),
          )
          .at(-1)
          ?.emit('pointerdown');
      });
    } else if (await button(page, 'Skip conversation').isVisible().catch(() => false))
      await button(page, 'Skip conversation').click();
    else if (await button(page, 'Continue').isVisible().catch(() => false))
      await button(page, 'Continue').click();
    else if (st.state === 'PLAYER_IDLE' && !st.locked && st.turn >= 1) break;
    await sleep(page, 200);
  }
  await sleep(page, 2400);
}

const scenarios = {
  // Run start: the act card, then Sera and Edric speak.
  async dialogue() {
    const page = await newPage();
    await page.goto(`${base}/?devScene=nodemap&preset=fresh&seed=42${q}`);
    await waitScene(page, 'NodeMap');
    await page.waitForSelector('.ce-act-layer', { timeout: 45000 }).catch(() => {});
    await sleep(page, 2500);
    await page.mouse.click(40, 40).catch(() => {});
    let shots = 0;
    for (let i = 0; i < 20 && shots < 2; i++) {
      const img = page.locator('.re-dialogue img');
      if (await img.first().isVisible().catch(() => false)) {
        await sleep(page, 500);
        await shot(page, `dialogue-${shots + 1}`);
        shots++;
      }
      if (await button(page, 'Continue').isVisible().catch(() => false))
        await button(page, 'Continue').click();
      else await page.mouse.click(40, 40).catch(() => {});
      await sleep(page, 700);
    }
    // The route map's party chips.
    for (let i = 0; i < 12; i++) {
      if (await button(page, 'Skip conversation').isVisible().catch(() => false))
        await button(page, 'Skip conversation').click();
      else if (await button(page, 'Continue').isVisible().catch(() => false))
        await button(page, 'Continue').click();
      else break;
      await sleep(page, 400);
    }
    await sleep(page, 1200);
    await shot(page, 'loom');
    // Roster sheet.
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._openRoster?.());
    await sleep(page, 1500);
    await shot(page, 'roster');
    if (page.errors.length) console.log(page.errors);
    await page.context().close();
  },
  async boss() {
    const page = await newPage();
    await page.goto(`${base}/?devScene=battle&devNode=boss&preset=late_act&seed=42${q}`);
    await waitScene(page, 'Battle');
    await page.waitForSelector('.ce-boss-layer', { timeout: 45000 });
    await sleep(page, 1600);
    await shot(page, 'boss-card');
    if (page.errors.length) console.log(page.errors);
    await page.context().close();
  },
  async cutin() {
    const page = await newPage();
    await page.goto(`${base}/?devScene=battle&preset=late_act&seed=42${q}`);
    await waitScene(page, 'Battle');
    await settleBattle(page);
    for (const v of ['crit', 'boss', 'generic']) {
      await page.evaluate(async (v) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const { ProcBannerController } = await import('/src/ui/ProcBannerController.js');
        const c = new ProcBannerController(s);
        const delay = s._awaitSceneDelay;
        s._awaitSceneDelay = (ms, opts) =>
          delay.call(s, opts?.label === 'proc_cutin_hold' ? 2500 : ms, opts);
        const edric = s.playerUnits.find((u) => u.name === 'Edric') || s.playerUnits[0];
        const unit =
          v === 'boss'
            ? {
                name: 'Dark Rider',
                className: 'Dark Knight',
                isBoss: true,
                faction: 'enemy',
                weapon: { name: 'Runesword' },
              }
            : v === 'generic'
              ? { name: 'Brigand', className: 'Mage', faction: 'enemy', weapon: { name: 'Fire' } }
              : edric;
        window.__cutDone = false;
        c.showCutIn({
          unit,
          unitName: unit.name,
          weaponName: unit.weapon?.name,
          label: 'CRITICAL HIT',
          category: 'offense',
          side: v === 'crit' ? 'left' : 'right',
        }).finally(() => {
          s._awaitSceneDelay = delay;
          window.__cutDone = true;
        });
      }, v);
      await sleep(page, 700);
      await shot(page, `cutin-${v}`);
      await page.waitForFunction(() => window.__cutDone, null, { timeout: 15000 });
      await sleep(page, 300);
    }
    // Forecast against the nearest enemy.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const a = s.playerUnits.find((u) => u.name === 'Edric') || s.playerUnits[0];
      const d = [...s.enemyUnits].sort(
        (p, q) =>
          Math.abs(p.col - a.col) + Math.abs(p.row - a.row) - Math.abs(q.col - a.col) - Math.abs(q.row - a.row),
      )[0];
      s.selectedUnit = a;
      void s.showForecast(a, d);
    });
    await sleep(page, 1200);
    await shot(page, 'forecast');
    if (page.errors.length) console.log(page.errors);
    await page.context().close();
  },
  async fallen() {
    const page = await newPage();
    await page.goto(`${base}/?devScene=battle&preset=late_act&seed=42${q}`);
    await waitScene(page, 'Battle');
    await settleBattle(page);
    // A real slot, so the fatal decision can checkpoint (as in a run).
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
      const meta = s.registry.get('meta');
      meta.storageKey = getMetaKey(1);
      meta._save();
      s.registry.set('activeSlot', 1);
      setActiveSlot(1);
      s._captureSuspendCheckpoint();
    });
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.gameData = { ...s.gameData, dialogue: { ...s.gameData.dialogue, lordFarewell: {} } };
      const commander = s.playerUnits.find((u) => u.isCommander);
      commander.currentHP = 0;
      await s.removeUnit(commander, { killer: s.enemyUnits[0] });
      s.checkBattleEnd();
    });
    await sleep(page, 1600);
    await shot(page, 'fallen-offer');
    await page.context().close();
  },
  async home() {
    const page = await newPage();
    await page.goto(`${base}/?devScene=homebase&preset=late_act&seed=42${q}`);
    await waitScene(page, 'HomeBase');
    await sleep(page, 2500);
    await shot(page, 'home');
    for (const name of ['Lords', 'Commander', 'Lord']) {
      const tab = page.getByRole('button', { name, exact: true }).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await sleep(page, 900);
        await shot(page, 'home-lords');
        break;
      }
    }
    await page.context().close();
  },
};

for (const [name, run] of Object.entries(scenarios)) {
  if (only && !only.includes(name)) continue;
  try {
    await run();
  } catch (error) {
    console.log(`scenario ${name} failed: ${error.message.split('\n')[0]}`);
  }
}
await browser.close();
