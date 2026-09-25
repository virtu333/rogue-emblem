// Choice-screen review captures — drives the real "choose one" screens on a
// running dev server (dev routes only) and writes PNGs per screen per viewport.
// Presentation review tooling; never part of the build.
//
//   npx vite --port 3173 --host 127.0.0.1
//   node tools/art/captureChoices.mjs --base http://127.0.0.1:3173 \
//     --out docs/art-direction/choice-screens/after --viewport 844x390m [--only boss,rewards]
//
// Viewport "WxH" is desktop; a trailing "m" emulates an iPhone (touch UA,
// ?mobilePreview=1), a trailing "t" a touch device at that size. --dpr sets the device scale (default 2 for phones, 1 for
// desktop). --reduced captures with reduced motion. CHROMIUM_PATH overrides
// the browser binary.
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
      return [key, rest.join(' ') || true];
    }),
);
const base = args.base || 'http://127.0.0.1:3173';
const outDir = args.out || 'docs/art-direction/choice-screens/after';
const viewport = /^(\d+)x(\d+)([mt]?)$/.exec(args.viewport || '844x390m');
if (!viewport) throw new Error(`bad --viewport ${args.viewport}`);
const W = Number(viewport[1]);
const H = Number(viewport[2]);
// "m": iPhone preview frame (?mobilePreview=1); "t": touch device at its own size.
const phone = viewport[3] === 'm' || viewport[3] === 't';
const DPR = Number(args.dpr || (phone ? 2 : 1));
const reduced = Boolean(args.reduced);
const want = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
fs.mkdirSync(outDir, { recursive: true });
const tag = `${W}x${H}`;
const q = viewport[3] === 'm' ? '&mobilePreview=1' : '';

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

async function newPage() {
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
  await ctx.addInitScript((reduced) => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, reduceMotion: reduced }),
    );
  }, reduced);
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

async function battle(page) {
  await page.goto(`${base}/?devScene=battle&preset=battle_smoke&seed=42${q}&battleLab=1`);
  await scene(page, 'Battle');
  await page.waitForTimeout(600);
}

async function nodemap(page) {
  await page.goto(`${base}/?devScene=nodemap${q}`);
  await scene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForTimeout(400);
}

const shot = (page, name) =>
  page.screenshot({ path: `${outDir}/${name}-${tag}${reduced ? '-reduced' : ''}.png` });

async function arrival(page, type, mode = 'pick3') {
  await battle(page);
  await page.evaluate(
    async ({ type, mode }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.runManager.metaEffects = { ...(s.runManager.metaEffects || {}), thirdLordMode: mode };
      const module = await import(
        type === 'boss' ? '/src/ui/BossRecruitOverlay.js' : '/src/ui/LordArrivalOverlay.js'
      );
      const Class = type === 'boss' ? module.BossRecruitOverlay : module.LordArrivalOverlay;
      new Class(s, s.runManager, s.gameData).show(() => {});
    },
    { type, mode },
  );
  await page.waitForTimeout(900);
}

// The reward screen (an elite victory may speak story lines first).
async function rewardsOpen(page) {
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  const story = page.getByRole('dialog', { name: 'Story', exact: true });
  await rewards.or(story).first().waitFor({ timeout: 60000 });
  for (let i = 0; i < 12 && (await story.isVisible().catch(() => false)); i++) {
    await story.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForTimeout(300);
  }
  await rewards.waitFor({ timeout: 60000 });
}

const flows = {
  async boss(page) {
    await arrival(page, 'boss');
    await shot(page, 'boss-recruit');
  },
  async bossSecond(page) {
    await arrival(page, 'boss');
    const cards = page.locator('[data-choice-card]');
    if ((await cards.count()) > 1) {
      await cards.nth(1).click();
      await page.waitForTimeout(500);
      await shot(page, 'boss-recruit-select2');
    }
  },
  async lord(page) {
    await arrival(page, 'lord', 'pick3_reroll');
    await shot(page, 'lord-arrival');
  },
  async lordSingle(page) {
    await arrival(page, 'lord', 'random');
    await shot(page, 'lord-arrival-single');
  },
  async mercs(page, { shoot = true } = {}) {
    await nodemap(page);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      s.runManager.gold = 3000;
      const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
      window.arena = new ColosseumOverlay(s, s.runManager, s.gameData);
      window.arena.show(s.runManager.getAvailableNodes()[0], () => {});
    });
    await page.getByRole('button', { name: 'Mercenary board', exact: true }).click();
    await page.waitForTimeout(900);
    if (shoot) await shot(page, 'mercenary-board');
  },
  async hire(page) {
    await flows.mercs(page, { shoot: false });
    await page.locator('.ch-mercs .ch-card').first().click();
    await page.waitForTimeout(700);
    await shot(page, 'mercenary-contract');
  },
  // Longest strings: three candidates renamed to the longest pool names over
  // the widest class names (a text-fit check, not a reachable roll).
  async bossLongest(page) {
    await battle(page);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { generateBossRecruitCandidates } = await import('/src/engine/BossRecruitSystem.js');
      const { showArrivalMenu } = await import('/src/ui/PartyMenus.js');
      const c = generateBossRecruitCandidates(
        'act3',
        s.runManager.roster,
        s.gameData,
        s.runManager.getEffectiveMetaEffects(),
        [],
      );
      const names = ['Seraphina', 'Stormclaw', 'Percival'];
      c.forEach((x, i) => (x.unit.name = names[i] || x.unit.name));
      const owner = { scene: s, gameData: s.gameData, runManager: s.runManager };
      showArrivalMenu(owner, 'Boss recruit', c, () => {}, { skip: true });
    });
    await page.waitForTimeout(900);
    await shot(page, 'boss-recruit-longest');
  },
  async blessing4(page) {
    await flows.blessing(page, { shoot: false });
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('BlessingSelect');
      const pool = s.gameData.blessings.costPools || {};
      s.options = [
        'quartermaster_cache',
        'focused_curriculum',
        'forbidden_tome',
        'scroll_archive',
      ].map((id) => {
        const b = structuredClone(s.gameData.blessings.blessings.find((x) => x.id === id));
        const costs = pool[String(b.tier)];
        if (costs?.length) b.rolledCost = costs[costs.length - 1];
        return b;
      });
      s.selectedIndex = 2;
      s._draw();
    });
    await page.waitForTimeout(700);
    await shot(page, 'blessing-longest');
  },
  async rewardsLegend(page) {
    await battle(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.isElite = true;
      s.onVictory();
    });
    await rewardsOpen(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const r = s._lootController.mobileRewards;
      const w = (n) => structuredClone(s.gameData.weapons.find((x) => x.name === n));
      const legend = s.gameData.weapons.find((x) => x.tier === 'Legend' && x.type === 'Sword');
      r.choices[0] = { type: 'weapon', item: structuredClone(legend) };
      r.choices[1] = { type: 'weapon', item: w('Silver Lance') || w('Steel Sword') };
      r.choices[2] = {
        type: 'rare',
        item: structuredClone(s.gameData.weapons.find((x) => x.teachesWeaponArtId)),
      };
      r.selected = 0;
      r.render();
    });
    await page.waitForTimeout(700);
    await shot(page, 'rewards-legend');
  },
  async difficulty(page) {
    await page.goto(`${base}/?devScene=difficulty${q}`);
    await scene(page, 'DifficultySelect');
    await page.waitForTimeout(900);
    await shot(page, 'difficulty');
  },
  async blessing(page, { shoot = true } = {}) {
    await page.goto(`${base}/?devScene=difficulty${q}`);
    await scene(page, 'DifficultySelect');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await scene(page, 'BlessingSelect');
    await page.waitForTimeout(900);
    if (shoot) await shot(page, 'blessing');
  },
  async rewards(page) {
    await battle(page);
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
    await rewardsOpen(page);
    await page.waitForTimeout(900);
    await shot(page, 'rewards');
  },
  async rewardsElite(page) {
    await battle(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.isElite = true;
      s.onVictory();
    });
    await rewardsOpen(page);
    await page.waitForTimeout(900);
    await shot(page, 'rewards-elite');
  },
  async rewardsWeapon(page) {
    await battle(page);
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
    await rewardsOpen(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const r = s._lootController.mobileRewards;
      const steel = s.gameData.weapons.find((w) => w.name === 'Steel Sword');
      r.choices[0] = { type: 'weapon', item: structuredClone(steel) };
      r.selected = 0;
      r.render();
    });
    await page.getByRole('button', { name: 'Choose reward', exact: true }).click();
    await page.waitForTimeout(700);
    await shot(page, 'rewards-recipient');
  },
};

for (const [name, flow] of Object.entries(flows)) {
  if (want && !want.has(name)) continue;
  const page = await newPage();
  try {
    await flow(page);
    console.log(`ok ${name}${page.errors.length ? ` (errors: ${page.errors.join(' | ')})` : ''}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message.split('\n')[0]}`);
  } finally {
    await page.context().close();
  }
}
await browser.close();
