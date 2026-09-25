// Growth ceremony review captures — drives the real flows on a running dev
// server (dev routes only) and writes PNGs per flow per viewport.
// Presentation review tooling; never part of the build.
//
//   npx vite --port 3712 --host 127.0.0.1
//   node tools/art/captureGrowth.mjs --base http://127.0.0.1:3712 \
//     --out docs/art-direction/growth/captures --viewport 844x390m [--only rite,levelup] [--dpr 3]
//
// Viewport "WxH" is desktop; a trailing "m" emulates an iPhone (touch UA,
// ?mobilePreview=1). --dpr sets the device scale (default 3 for phones, 1
// for desktop). CHROMIUM_PATH overrides the browser binary.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((pair) => {
      const [key, ...rest] = pair.trim().split(/\s+/);
      return [key, rest.join(' ')];
    }),
);
const base = args.base || 'http://127.0.0.1:3712';
const outDir = args.out || 'docs/art-direction/growth/captures';
const viewport = /^(\d+)x(\d+)(m?)$/.exec(args.viewport || '844x390m');
if (!viewport) throw new Error(`bad --viewport ${args.viewport}`);
const W = Number(viewport[1]);
const H = Number(viewport[2]);
const phone = viewport[3] === 'm';
const DPR = Number(args.dpr || (phone ? 3 : 1));
const want = args.only ? new Set(args.only.split(',')) : null;
fs.mkdirSync(outDir, { recursive: true });
const tag = `${W}x${H}`;
const q = phone ? '&mobilePreview=1' : '';

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

async function newPage({ reduced = false, speed = 'normal' } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: DPR,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    ...(phone
      ? {
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
          hasTouch: true,
        }
      : {}),
  });
  await ctx.addInitScript(
    ({ reduced, speed }) => {
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({
          musicVolume: 0,
          sfxVolume: 0,
          hints: false,
          battleSpeed: speed,
          reduceMotion: reduced,
        }),
      );
    },
    { reduced, speed },
  );
  await ctx.addInitScript(() => {
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

const scene = (page, key, timeout = 40000) =>
  page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, { timeout });

async function battle(page, preset = 'battle_smoke') {
  await page.goto(`${base}/?devScene=battle&preset=${preset}&seed=42${q}`);
  await scene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
    null,
    { timeout: 40000 },
  );
  // Let the opening phase band leave before staging anything over the map.
  await page
    .waitForFunction(() => !document.querySelector('.ce-phase-layer'), null, { timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(300);
}

async function nodemap(page) {
  await page.goto(`${base}/?devScene=nodemap${q}`);
  await scene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForTimeout(400);
}

const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}-${tag}.png` });

// Promotion via the battle Master Seal, frozen at points of the rite.
async function sealRite(page, { unitIndex = 1 } = {}) {
  await battle(page);
  await page.evaluate((unitIndex) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits[unitIndex] || s.playerUnits[0];
    u.level = 10;
    u.consumables = [structuredClone(s.gameData.consumables.find((i) => i.effect === 'promote'))];
    s.battleState = 'COMBAT_RESOLVING';
    window.__promo = s.executePromotion(u);
  }, unitIndex);
  return page;
}

const flows = {
  async chooser(page) {
    await battle(page);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((x) => x.name === 'Sera') || s.playerUnits[1];
      u.level = 10;
      const { PromotionChoicePanel } = await import('/src/ui/PromotionChoicePanel.js');
      const targets = ['Swordmaster', 'Duelist'].map((n) =>
        s.gameData.classes.find((c) => c.name === n),
      );
      const m = s.playerUnits.find((x) => !x.isLord) || u;
      // A Myrmidon with two paths: the widest real choice.
      Object.assign(m, { className: 'Myrmidon', tier: 'base', isLord: false, name: 'Ilse' });
      s.battleState = 'COMBAT_RESOLVING';
      new PromotionChoicePanel(s, m, targets, s.gameData.skills).show();
    });
    await page.waitForTimeout(700);
    await shot(page, 'chooser-battle');
  },
  async rite(page) {
    await sealRite(page, { unitIndex: 0 });
    await page.waitForSelector('.gr-rite-layer', { timeout: 15000 });
    // Freeze every CSS animation and step the timeline deterministically
    // (Web Animations currentTime includes each animation's delay).
    const own = () =>
      document.getAnimations().filter((a) => a.effect?.target?.closest?.('.gr-rite-layer'));
    await page.evaluate(`(${own})().forEach((a) => a.pause())`);
    const seek = (t) => page.evaluate(`(${own})().forEach((a) => { a.currentTime = ${t}; })`);
    const strip = [
      [200, 'rite-1-light'],
      [950, 'rite-2-burn'],
      [1500, 'rite-3-name'],
      [2300, 'rite-4-stats'],
      [3600, 'rite-5-end'],
    ];
    for (const [t, name] of strip) {
      await seek(t);
      await page.waitForTimeout(60);
      await shot(page, name);
    }
    if (args.gif) {
      const { default: sharp } = await import('sharp');
      const frames = [];
      for (let t = 0; t <= 3600; t += 100) {
        await seek(t);
        await page.waitForTimeout(30);
        frames.push(await page.screenshot({ scale: 'css' }));
      }
      for (let i = 0; i < 12; i++) frames.push(frames[frames.length - 1]);
      const resized = await Promise.all(
        frames.map((f) =>
          sharp(f)
            .resize({ width: Math.min(W, 844) })
            .png()
            .toBuffer(),
        ),
      );
      await sharp(resized, { join: { animated: true } })
        .gif({ delay: resized.map(() => 100), loop: 0, effort: 7 })
        .toFile(`${outDir}/rite-${tag}.gif`);
    }
  },
  async ritegeneric(page) {
    await battle(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((x) => x.name === 'Sera');
      u.level = 10;
      u.consumables = [structuredClone(s.gameData.consumables.find((i) => i.effect === 'promote'))];
      s.battleState = 'COMBAT_RESOLVING';
      s.executePromotion(u);
    });
    await page.waitForSelector('.gr-rite-layer', { timeout: 15000 });
    await page.waitForTimeout(900);
    await shot(page, 'rite-sera-burn');
    await page.waitForSelector('.gr-rite-layer.is-done', { timeout: 15000 });
    await page.waitForTimeout(400);
    await shot(page, 'rite-sera-end');
  },
  async church(page) {
    await nodemap(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      s.runManager.gold = 10000;
      s.runManager.roster[0].level = 10;
      s.handleChurch(s.runManager.getAvailableNodes()[0]);
    });
    const church = page.getByRole('dialog', { name: 'Church', exact: true });
    await church.getByRole('button', { name: /Edric.*Lord/ }).click();
    await page.waitForTimeout(500);
    await shot(page, 'church-chooser');
    await page.getByRole('button', { name: /^Promote to Great Lord/ }).click();
    await page.waitForTimeout(1100);
    await shot(page, 'church-rite-burn');
    await page.waitForSelector('.gr-rite-layer.is-done', { timeout: 15000 });
    await page.waitForTimeout(400);
    await shot(page, 'church-rite-end');
  },
  async levelup(page) {
    await battle(page);
    const variants = [
      ['levelup-normal', { HP: 1, STR: 1, SKL: 1, SPD: 1 }, []],
      ['levelup-perfect', { HP: 1, STR: 1, MAG: 1, SKL: 1, SPD: 1, DEF: 1, RES: 1, LCK: 1 }, []],
      ['levelup-blank', { DEF: 1 }, []],
      ['levelup-skill', { HP: 1, SPD: 1, LCK: 1 }, ['Vantage']],
    ];
    for (const [name, gains, skills] of variants) {
      await page.evaluate(
        async ({ gains, skills }) => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          s.battleState = 'COMBAT_RESOLVING';
          const { LevelUpPopup } = await import('/src/ui/LevelUpPopup.js');
          window.__popup = new LevelUpPopup(
            s,
            s.playerUnits[0],
            { newLevel: 5, gains },
            false,
            skills,
          );
          window.__popup.show();
        },
        { gains, skills },
      );
      await page.waitForSelector('.gr-level-layer.is-done', { timeout: 10000 });
      await page.waitForTimeout(450);
      await shot(page, name);
      await page.evaluate(() => window.__popup.destroy());
      await page.waitForTimeout(200);
    }
  },
  async recruit(page) {
    await battle(page);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { generateBossRecruitCandidates } = await import('/src/engine/BossRecruitSystem.js');
      const c = generateBossRecruitCandidates(
        'act2',
        s.runManager.roster,
        s.gameData,
        s.runManager.getEffectiveMetaEffects(),
        [],
      );
      const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
      s.time.timeScale = 0.05;
      s.battleState = 'BATTLE_END';
      growthCeremonies(s).showRecruit({ unit: c[0].unit, kind: 'boss' });
    });
    await page.waitForTimeout(1600);
    await shot(page, 'recruit-boss');
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s._growthCeremonies?.destroy();
      const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
      const npc = { ...s.playerUnits[0], name: 'Maren', className: 'Cleric', level: 4, isLord: false, faction: 'npc', tier: 'base' }; // prettier-ignore
      growthCeremonies(s).showRecruit({ unit: npc, kind: 'recruit' });
    });
    await page.waitForTimeout(1600);
    await shot(page, 'recruit-talk');
  },
  // Mechanics audit: battle notices, reinforcement arrival, status marks.
  async notices(page) {
    await battle(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.showBriefBanner('Village saved! +300g, Vulnerary sent to convoy', '#95c487');
    });
    await page.waitForTimeout(450);
    await shot(page, 'audit-notice-village');
    await page.waitForTimeout(1600);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const arrivals = s.enemyUnits.slice(0, 2);
      let presenter;
      try {
        const { ReinforcementPresenter } = await import('/src/ui/ReinforcementPresenter.js');
        presenter = s._reinforcements ||= new ReinforcementPresenter(s);
      } catch {
        presenter = null; // before the presenter existed
      }
      if (presenter) presenter.present(arrivals);
      else s.showReinforcementBanner(arrivals.length);
    });
    await page.waitForTimeout(520);
    await shot(page, 'audit-reinforcements');
  },
  async status(page) {
    await battle(page);
    const clip = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const [a, b] = s.playerUnits;
      s._addConditionIcon(a, 'sleep');
      s._addConditionIcon(a, 'acid');
      if (b) s._addConditionIcon(b, 'silence');
      const e = s.enemyUnits[0];
      s._addConditionIcon(e, 'root');
      const w = s.grid.gridToPixel(a.col, a.row);
      const p = s._worldToScreen(w.x, w.y);
      const r = s.game.canvas.getBoundingClientRect();
      const x = r.x + (p.x * r.width) / s.scale.width;
      const y = r.y + (p.y * r.height) / s.scale.height;
      return { x: Math.max(0, x - 110), y: Math.max(0, y - 110), width: 300, height: 190 };
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${outDir}/audit-status-${tag}.png`, clip });
  },
  async roster(page) {
    await nodemap(page);
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._openRoster());
    await page.waitForTimeout(700);
    await shot(page, 'roster-crest');
  },
};

for (const [name, fn] of Object.entries(flows)) {
  if (want && !want.has(name)) continue;
  const page = await newPage();
  try {
    await fn(page);
    console.log('ok', name, tag, page.errors.length ? page.errors : '');
  } catch (error) {
    console.log('FAIL', name, tag, error.message.split('\n')[0]);
    await page.screenshot({ path: `${outDir}/FAIL-${name}-${tag}.png` }).catch(() => {});
  }
  await page.context().close();
}
await browser.close();
