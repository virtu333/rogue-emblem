#!/usr/bin/env node
// In-game Combat v2 captures (dev server, dev routes only), frame-exact.
//
//   npx vite --port 3519 --host 127.0.0.1
//   node tools/art/combat-fx/capture.mjs --base http://127.0.0.1:3519 \
//     [--viewport 844x390m3] [--only sword,death] [--out docs/art-direction/combat-v2/ingame]
//
// The game loop is put to sleep and stepped at a fixed 60 fps with a virtual clock
// (the scene clock and Phaser's tween clock, which reads Date.now), so every strip
// shows the same frames on every machine regardless of load. Real combats are
// resolved with pinned stats; the signature and enrage beats are played through the
// same controllers with a staged event (presentation only).
//
// Outputs (lossless WebP): <scenario>.webp — the action area at the key frame, at device
// resolution; <scenario>_strip.webp — the action area every other frame (33 ms) at CSS
// size, labelled; with --screens also <scenario>_screen.webp, the whole screen.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const arg = (name, fallback) =>
  argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback;
const base = arg('base', 'http://127.0.0.1:3519');
const outDir = arg('out', 'docs/art-direction/combat-v2/ingame');
const only = arg('only', null)?.split(',');
const screens = argv.includes('--screens');
const vp = /^(\d+)x(\d+)(?:m(\d(?:\.\d+)?))?$/.exec(arg('viewport', '844x390m3'));
const W = Number(vp[1]);
const H = Number(vp[2]);
const phone = Boolean(vp[3]);
const dpr = phone ? Number(vp[3]) : 1;
fs.mkdirSync(outDir, { recursive: true });

// kind: strike | heal | death | signature | enrage | ballista
const SCENARIOS = [
  {
    id: 'sword_grass',
    map: 'river_crossing',
    kind: 'strike',
    weapon: 'Iron Sword',
    distance: 1,
    key: 7,
  },
  // Traced map sprites (the battlefield default since 2026-09-25; the flag is a no-op kept
  // so the file names stay stable): the lunge uses their windup and strike frames.
  {
    id: 'sword_traced',
    map: 'river_crossing',
    kind: 'strike',
    weapon: 'Iron Sword',
    distance: 1,
    key: 5,
    query: '&spriteArt=traced',
  },
  { id: 'death_traced', map: 'chokepoint', kind: 'death', key: 18, query: '&spriteArt=traced' },
  {
    id: 'axe_castle',
    map: 'castle_ruins',
    kind: 'strike',
    weapon: 'Iron Axe',
    distance: 1,
    key: 7,
  },
  {
    id: 'lance_mire',
    map: 'mire_crossing',
    kind: 'strike',
    weapon: 'Iron Lance',
    distance: 1,
    key: 8,
  },
  {
    id: 'crit_castle',
    map: 'castle_ruins',
    kind: 'strike',
    weapon: 'Steel Sword',
    distance: 1,
    crit: true,
    key: 8,
  },
  {
    id: 'bow_range2',
    map: 'river_crossing',
    kind: 'strike',
    weapon: 'Iron Bow',
    distance: 2,
    key: 5,
  },
  { id: 'fire_night', map: 'caldera', kind: 'strike', weapon: 'Fire', distance: 2, key: 9 },
  {
    id: 'thunder_night',
    map: 'frozen_pass',
    kind: 'strike',
    weapon: 'Bolting',
    distance: 3,
    key: 5,
  },
  {
    id: 'wind_grass',
    map: 'forest_ambush',
    kind: 'strike',
    weapon: 'Excalibur',
    distance: 2,
    key: 8,
  },
  {
    id: 'light_castle',
    map: 'corridor_siege',
    kind: 'strike',
    weapon: 'Shine',
    distance: 2,
    key: 8,
  },
  {
    id: 'unlight_night',
    map: 'magma_flow',
    kind: 'strike',
    weapon: 'Twisting Vortex',
    distance: 2,
    key: 10,
  },
  {
    id: 'breath_night',
    map: 'glacier_run',
    kind: 'strike',
    weapon: 'Fire Breath',
    distance: 1,
    key: 7,
  },
  {
    id: 'miss_grass',
    map: 'river_crossing',
    kind: 'strike',
    weapon: 'Iron Sword',
    distance: 1,
    miss: true,
    key: 6,
  },
  { id: 'heal', map: 'river_crossing', kind: 'heal', key: 6 },
  { id: 'death', map: 'river_crossing', kind: 'death', key: 18 },
  { id: 'death_night', map: 'caldera', kind: 'death', key: 18 },
  {
    id: 'signature',
    map: 'castle_ruins',
    kind: 'signature',
    weapon: 'Silver Sword',
    sig: 'fx_sig_sword',
    key: 9,
  },
  {
    id: 'signature_magic_night',
    map: 'caldera',
    kind: 'signature',
    weapon: 'Bolganone',
    sig: 'fx_sig_magic',
    distance: 2,
    key: 12,
  },
  { id: 'enrage_night', map: 'magma_flow', kind: 'enrage', key: 8 },
  {
    id: 'breath_toxic',
    map: 'mire_crossing',
    kind: 'strike',
    weapon: 'Toxic Breath',
    distance: 1,
    key: 7,
  },
  {
    id: 'breath_ancient_night',
    map: 'frozen_pass',
    kind: 'strike',
    weapon: 'Ancient Breath',
    distance: 2,
    key: 9,
  },
  { id: 'ballista_castle', map: 'castle_ruins', kind: 'ballista', distance: 3, key: 3 },
  { id: 'death_boss_night', map: 'magma_flow', kind: 'death', boss: true, key: 20 },
  { id: 'death_entity_night', map: 'caldera', kind: 'death', entity: true, key: 20 },
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : fs.existsSync('/opt/pw-browsers/chromium')
      ? { executablePath: '/opt/pw-browsers/chromium' }
      : {},
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
      JSON.stringify({
        musicVolume: 0,
        sfxVolume: 0,
        hints: false,
        battleSpeed: 'normal',
        atmosphere: 'full',
      }),
    );
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

async function label(width, text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="26"><rect width="100%" height="100%" fill="#16131e"/><text x="8" y="18" font-family="DejaVu Sans Mono, monospace" font-size="15" fill="#ddd0bd">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function run(sc) {
  const page = await newPage();
  const q = `${phone ? '&mobilePreview=1' : ''}&battleLab=1&labMap=${sc.map}${sc.query || ''}`;
  await page.goto(`${base}/?devScene=battle&preset=combat_actions&seed=42${q}`);
  await page.waitForFunction(
    () => window.__emblemRogueGame?.scene?.getScene('Battle')?.battleState === 'PLAYER_IDLE',
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(1200);
  const setup = await page.evaluate(async (sc) => {
    const g = window.__emblemRogueGame;
    const s = g.scene.getScene('Battle');
    // Frame-exact stepping: sleep the loop, drive a virtual clock.
    g.loop.sleep();
    let now = Date.now();
    Date.now = () => now;
    let t = performance.now();
    window.__step = (n) => {
      for (let i = 0; i < n; i++) {
        now += 1000 / 60;
        t += 1000 / 60;
        g.step(t, 1000 / 60);
      }
    };
    for (const k of ['_awaitSceneDelay', '_awaitSceneTween']) {
      const f = s[k].bind(s);
      s[k] = (a, o = {}) => f(a, { ...o, timeoutMs: 1e9 });
    }
    s._procBanner && (s._procBanner._lastCutInAt = Infinity);
    const { ProcBannerController } = await import('/src/ui/ProcBannerController.js');
    // Keep the DOM cut-in out of the canvas captures (it is covered by ceremonies).
    ProcBannerController.prototype.showCutIn = async () => {};
    const grid = s.grid;
    const occupied = (c, r) =>
      [...s.playerUnits, ...s.enemyUnits, ...(s.npcUnits || [])].some(
        (u) => u.col === c && u.row === r,
      );
    const open = (c, r) => {
      const tt = grid.getTerrainAt(c, r);
      const cost = tt?.moveCost?.Infantry;
      return c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && cost !== '--' && cost != null;
    };
    const d = sc.distance || 1;
    const cx = Math.floor(grid.cols / 2);
    const cy = Math.floor(grid.rows / 2);
    let pick = null;
    for (let rad = 0; rad < 8 && !pick; rad++)
      for (let dr = -rad; dr <= rad && !pick; dr++)
        for (let dc = -rad; dc <= rad && !pick; dc++) {
          const c = cx + dc;
          const r = cy + dr;
          const ok = [0, d].every((k) => open(c - k, r) && !occupied(c - k, r));
          if (ok) pick = { c, r };
        }
    const a = s.playerUnits.find((u) => u.weapon);
    const b = s.enemyUnits[0];
    const place = (u, c, r) => {
      u.col = c;
      u.row = r;
      const p = grid.gridToPixel(c, r);
      u.graphic.x = p.x;
      u.graphic.y = p.y;
      s.updateUnitPosition?.(u);
    };
    place(b, pick.c, pick.r);
    place(a, pick.c - d, pick.r);
    const w = sc.weapon ? s.gameData.weapons.find((x) => x.name === sc.weapon) : null;
    if (w)
      a.weapon = {
        ...structuredClone(w),
        hit: sc.miss ? -999 : 999,
        crit: sc.crit ? 100 : 0,
        range: '1-10',
      };
    for (const u of [a, b]) {
      u.stats = { ...u.stats, HP: 60, STR: 8, MAG: 8, SKL: 20, SPD: 0, DEF: 0, RES: 0, LCK: 0 };
      u.skills = [];
      u.currentHP = 60;
    }
    b.weapon = null;
    if (sc.kind === 'death') {
      a.weapon = { ...a.weapon, hit: 999, crit: 0, might: 99, range: '1-10' };
      b.currentHP = 5;
      if (sc.boss) b.isBoss = true;
      if (sc.entity) b.isEntity = true;
    }
    // Keep the pair in view on the phone camera (it settles before the action starts).
    s._battleCamera?.ensureWorldVisible?.(b.graphic.x, b.graphic.y, 120);
    window.__stage = { a, b, w };
    return true;
  }, sc);
  if (!setup) throw new Error(`${sc.id}: setup failed`);
  await page.evaluate(() => window.__step(40));
  const view = await page.evaluate(async (sc) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { a, b, w } = window.__stage;
    s.battleState = 'COMBAT_RESOLVING';
    window.__done = false;
    const done = () => (window.__done = true);
    const fail = (e) => {
      window.__err = String((e && e.stack) || e);
      done();
    };
    if (sc.kind === 'strike' || sc.kind === 'death') {
      (async () => {
        await s._runCombatResolution(
          a,
          b,
          s._prepareCombatContext(a, b, { isPlayerInitiator: true }),
        );
        if (b.currentHP <= 0) await s.removeUnit(b, { killer: a });
      })().then(done, fail);
    } else if (sc.kind === 'heal') {
      b.faction = 'player';
      s.animateHeal(b, 12, a).then(done, fail);
    } else if (sc.kind === 'signature') {
      const { CombatChoreography } = await import('/src/ui/CombatChoreography.js');
      const { splitStrikeActivations } = await import('/src/ui/ProcVisualTheme.js');
      new CombatChoreography(s)
        .playStrike({
          event: { miss: false, isCrit: false, damage: 24 },
          striker: a,
          target: b,
          split: splitStrikeActivations([], s.gameData.skills),
          legendaryArt: { name: 'Legendary art', weaponType: w?.type },
          signatureKey: sc.sig,
          windUp: true,
          onContact: () => s._showStrikeResult({ damage: 24, targetHPAfter: 36 }, a, b, false),
        })
        .then(done, fail);
    } else if (sc.kind === 'ballista') {
      // The bolt flies from an emplacement behind the striker's line (hit resolved).
      const { CombatFxController } = await import('/src/ui/CombatFxController.js');
      const fx = (s._combatFx ||= new CombatFxController(s));
      fx.ballistaShot({ col: b.col - (sc.distance || 3), row: b.row }, b, { hit: true, seed: 5 })
        .then(() => s._showStrikeResult({ damage: 10, targetHPAfter: 50 }, a, b, false))
        .then(done, fail);
    } else if (sc.kind === 'enrage') {
      b.isBoss = true;
      s._playBossEnrageFx();
      setTimeout(done, 0);
    }
    const cam = s.cameras.main;
    const mid = { x: (a.graphic.x + b.graphic.x) / 2, y: b.graphic.y - 8 };
    // Game pixels -> CSS pixels (the canvas may render above CSS resolution).
    const rect = s.game.canvas.getBoundingClientRect();
    const kx = rect.width / s.scale.width;
    const ky = rect.height / s.scale.height;
    return {
      sx: rect.x + ((mid.x - cam.worldView.x) * cam.zoom + cam.x) * kx,
      sy: rect.y + ((mid.y - cam.worldView.y) * cam.zoom + cam.y) * ky,
      zoom: cam.zoom * kx,
    };
  }, sc);
  const setupView = view;
  const cw = Math.round(
    Math.min(W, 150 * setupView.zoom + (sc.distance || 1) * 32 * setupView.zoom),
  );
  const ch = Math.round(Math.min(H, 120 * setupView.zoom));
  const clip = {
    x: Math.max(0, Math.min(W - cw, setupView.sx - cw / 2)),
    y: Math.max(0, Math.min(H - ch, setupView.sy - ch / 2)),
    width: cw,
    height: ch,
  };
  const frames = [];
  const count = sc.kind === 'death' ? 28 : 22;
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => window.__step(2));
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    frames.push(await page.screenshot({ clip }));
    if (i === sc.key) {
      // The key frame: the action area at full device resolution (lossless), and the
      // whole screen on request.
      await sharp(frames[i]).webp({ lossless: true, effort: 6 }).toFile(`${outDir}/${sc.id}.webp`);
      if (screens)
        await sharp(await page.screenshot())
          .webp({ lossless: true, effort: 6 })
          .toFile(`${outDir}/${sc.id}_screen.webp`);
    }
  }
  for (let i = 0; i < 300; i++) {
    const done = await page.evaluate(() => {
      window.__step(4);
      return window.__done;
    });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    if (done) break;
  }
  const err = await page.evaluate(() => window.__err || null);
  // Strip: frames every 33 ms, 6 per row, labelled with the time since the start.
  const fw = Math.round(clip.width);
  const fh = Math.round(clip.height);
  const cols = 6;
  const rows = Math.ceil(frames.length / cols);
  const comps = [];
  for (let i = 0; i < frames.length; i++) {
    const x = (i % cols) * fw;
    const y = Math.floor(i / cols) * (fh + 26);
    comps.push({ input: await label(fw, `${Math.round((i + 1) * 33.3)} ms`), left: x, top: y });
    comps.push({
      input: await sharp(frames[i]).resize(fw, fh, { kernel: 'nearest' }).toBuffer(),
      left: x,
      top: y + 26,
    });
  }
  await sharp({
    create: { width: fw * cols, height: (fh + 26) * rows, channels: 4, background: '#16131e' },
  })
    .composite(comps)
    .webp({ lossless: true, effort: 6 })
    .toFile(`${outDir}/${sc.id}_strip.webp`);
  console.log(
    `${sc.id}: ${err ? 'ERROR ' + err : 'ok'}${page.errors.length ? ' page errors: ' + page.errors.join(' | ') : ''}`,
  );
  await page.context().close();
}

for (const sc of SCENARIOS.filter((s) => !only || only.includes(s.id))) await run(sc);
await browser.close();
