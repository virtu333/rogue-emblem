#!/usr/bin/env node
// Deterministic strike timing in the real game: the loop is stepped at 60 fps on a
// virtual clock (scene clock + Phaser's Date.now tween clock) and the frames until
// _runCombatResolution resolves are counted, so machine load never skews the result.
// Point --base at a dev server of any revision to compare presentations.
//
//   node tools/art/combat-fx/timing.mjs --base http://127.0.0.1:3519
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://127.0.0.1:3519';
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : fs.existsSync('/opt/pw-browsers/chromium')
      ? { executablePath: '/opt/pw-browsers/chromium' }
      : {},
);
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 1,
});
await ctx.addInitScript(() => {
  localStorage.setItem(
    'emblem_rogue_settings',
    JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
  );
});
const page = await ctx.newPage();
await page.goto(
  `${base}/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1`,
);
await page.waitForFunction(
  () => window.__emblemRogueGame?.scene?.getScene('Battle')?.battleState === 'PLAYER_IDLE',
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const g = window.__emblemRogueGame;
  const s = g.scene.getScene('Battle');
  const { ProcBannerController } = await import('/src/ui/ProcBannerController.js');
  ProcBannerController.prototype.showCutIn = async () => {};
  g.loop.sleep();
  let now = Date.now();
  Date.now = () => now;
  let t = performance.now();
  window.__step = () => {
    now += 1000 / 60;
    t += 1000 / 60;
    g.step(t, 1000 / 60);
  };
  for (const k of ['_awaitSceneDelay', '_awaitSceneTween']) {
    const f = s[k].bind(s);
    s[k] = (a, o = {}) => f(a, { ...o, timeoutMs: 1e9 });
  }
});
const cases = [
  ['Iron Sword', 1, 'hit'],
  ['Iron Sword', 1, 'crit'],
  ['Iron Sword', 1, 'miss'],
  ['Iron Bow', 2, 'hit'],
  ['Iron Bow', 2, 'crit'],
  ['Longbow', 3, 'hit'],
  ['Fire', 2, 'hit'],
  ['Bolting', 5, 'hit'],
  ['Iron Axe', 1, 'hit'],
  ['Excalibur', 2, 'hit'],
  ['Shine', 2, 'hit'],
  ['Twisting Vortex', 2, 'hit'],
  ['Fire Breath', 1, 'hit'],
];
const rows = [];
// 'reduced' = Normal speed with Reduce motion on.
for (const label of ['normal', 'fast', 'instant', 'reduced']) {
  const speed = label === 'reduced' ? 'normal' : label;
  const reduced = label === 'reduced';
  for (const [weapon, dist, mode] of cases) {
    await page.evaluate(
      ({ speed, reduced, weapon, dist, mode }) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.registry.get('settings').setBattleSpeed(speed);
        s.registry.get('settings').setReduceMotion(reduced);
        const w = s.gameData.weapons.find((x) => x.name === weapon);
        const a = s.playerUnits.find((u) => u.weapon);
        const b = s.enemyUnits[0];
        a.weapon = {
          ...structuredClone(w),
          hit: mode === 'miss' ? -999 : 999,
          crit: mode === 'crit' ? 100 : 0,
          range: '1-10',
        };
        for (const u of [a, b]) {
          u.stats = { ...u.stats, HP: 99, STR: 1, MAG: 1, SKL: 20, SPD: 5, DEF: 0, RES: 0, LCK: 0 };
          u.currentHP = 99;
          u.skills = [];
        }
        b.weapon = null;
        b.col = 6;
        b.row = 4;
        a.col = 6 - dist;
        a.row = 4;
        for (const u of [a, b]) {
          const p = s.grid.gridToPixel(u.col, u.row);
          u.graphic.x = p.x;
          u.graphic.y = p.y;
        }
        window.__done = false;
        s._runCombatResolution(
          a,
          b,
          s._prepareCombatContext(a, b, { isPlayerInitiator: true }),
        ).then(
          (r) => {
            window.__strikes = r.result.events.filter((e) => e.type === 'strike').length;
            window.__done = true;
          },
          () => (window.__done = true),
        );
      },
      { speed, reduced, weapon, dist, mode },
    );
    let frames = 0;
    for (; frames < 400; frames++) {
      const done = await page.evaluate(async () => {
        await new Promise((r) => setTimeout(r, 0));
        if (window.__done) return true;
        window.__step();
        return false;
      });
      if (done) break;
    }
    const strikes = await page.evaluate(() => window.__strikes);
    rows.push(
      `${label}\t${weapon}@${dist}\t${mode}\t${Math.round((frames * 1000) / 60)}\t${strikes}`,
    );
  }
}
console.log('speed\tstrike\tresult\tms\tstrikes');
console.log(rows.join('\n'));
await browser.close();
