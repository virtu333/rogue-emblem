// Ceremony review captures — drives the real flows on a running dev server
// (dev routes only: devScene / devNode=boss / preset) and writes one PNG per
// ceremony per viewport. Presentation review tooling; never part of the build.
//
//   npx vite --port 3202 --host 127.0.0.1
//   node tools/art/captureCeremonies.mjs --base http://127.0.0.1:3202 \
//     --out docs/art-direction/build/ceremonies --viewport 844x390m [--only boss,fallen]
//
// Viewport "WxH" is desktop; a trailing "m" emulates an iPhone (touch UA,
// DPR 2, ?mobilePreview=1). CHROMIUM_PATH overrides the browser binary.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import sharp from 'sharp';

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
const base = args.base || 'http://127.0.0.1:3202';
const outDir = args.out || 'docs/art-direction/build/ceremonies';
const viewport = /^(\d+)x(\d+)(m?)$/.exec(args.viewport || '844x390m');
if (!viewport) throw new Error(`bad --viewport ${args.viewport}`);
const W = Number(viewport[1]);
const H = Number(viewport[2]);
const phone = viewport[3] === 'm';
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
    deviceScaleFactor: phone ? 2 : 1,
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
  // Dev routes run without a save slot, so the route map raises a "Save
  // failed" toast; it is an artifact of the capture route, not a ceremony.
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
const sleep = (page, ms) => page.waitForTimeout(ms);
const shot = async (page, name) => {
  // WebP keeps the committed review set small (~6 MB instead of ~27 MB as PNG).
  const path = `${outDir}/${name}-${tag}.webp`;
  await sharp(await page.screenshot())
    .webp({ quality: 88, effort: 6 })
    .toFile(path);
  console.log('shot', path);
};
const waitScene = (page, key) =>
  page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, { timeout: 45000 });

async function enterBattle(page, url) {
  await page.goto(base + url);
  await waitScene(page, 'Battle');
}

async function settleBattle(page, { skipCard = true } = {}) {
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
    if (st.card && skipCard) await page.mouse.click(40, 40);
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
    } else {
      const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
      const cont = page.getByRole('button', { name: 'Continue', exact: true });
      if (await skip.isVisible().catch(() => false)) await skip.click();
      else if (await cont.isVisible().catch(() => false)) await cont.click();
      else if (st.state === 'PLAYER_IDLE' && !st.locked && st.turn >= 1) break;
    }
    await sleep(page, 200);
  }
  await sleep(page, 2400); // let the phase band leave
}

async function useSlot(page) {
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
}

const scenarios = {
  // Boss encounter card, boss bar, chunk, enrage, FOE VANQUISHED — Act II boss battle.
  async boss() {
    const page = await newPage();
    await enterBattle(
      page,
      `/?devScene=battle&devNode=boss&preset=late_act&seed=${process.env.BOSS_SEED || 42}${q}`,
    );
    await page.waitForSelector('.ce-boss-layer', { timeout: 45000 });
    await sleep(page, 1200);
    await shot(page, 'boss-card');
    await settleBattle(page);
    await shot(page, 'bossbar');
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const boss = s.enemyUnits.find((u) => u.isBoss);
      boss.currentHP = Math.max(1, boss.currentHP - Math.round(boss.stats.HP * 0.35));
      s.updateHPBar(boss);
    });
    await sleep(page, 200);
    await shot(page, 'bossbar-chunk');
    await sleep(page, 1400);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.turnManager.turnNumber = 12;
      s.updateAntiTurtlePressure(12);
    });
    await sleep(page, 900);
    await shot(page, 'bossbar-enraged');
    await sleep(page, 1800);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const boss = s.enemyUnits.find((u) => u.isBoss);
      boss.currentHP = 0;
      s.updateHPBar(boss);
      await s.removeUnit(boss, { killer: s.playerUnits[0] });
    });
    await sleep(page, 900);
    await shot(page, 'foe-vanquished');
    if (page.errors.length) console.log(page.errors);
    await page.context().close();
  },
  // The Entity's card (no name, split image).
  async entity() {
    const page = await newPage();
    await enterBattle(page, `/?devScene=battle&preset=late_act&seed=42${q}`);
    await settleBattle(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      void s._getCeremonies().showBossIntro({
        unit: {
          name: 'The Entity',
          className: 'Entity',
          isBoss: true,
          isEntity: true,
          faction: 'enemy',
        },
        actId: 'finalBoss',
      });
    });
    await sleep(page, 3000);
    await shot(page, 'entity-card');
    await page.context().close();
  },
  // Longest boss name + epithet.
  async longest() {
    const page = await newPage();
    await enterBattle(page, `/?devScene=battle&preset=late_act&seed=42${q}`);
    await settleBattle(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      void s._getCeremonies().showBossIntro({
        unit: { name: 'Knight Commander', className: 'Paladin', isBoss: true, faction: 'enemy' },
        actId: 'act2',
      });
    });
    await sleep(page, 1600);
    await shot(page, 'boss-card-longest');
    await page.context().close();
  },
  // Crit and weapon-art cut-ins (held for the capture), phase band.
  async cutin() {
    for (const reduced of [false, true]) {
      const page = await newPage({ reduced });
      await enterBattle(page, `/?devScene=battle&preset=late_act&seed=42${q}`);
      await settleBattle(page);
      const variants = reduced ? ['crit'] : ['crit', 'art', 'boss'];
      for (const v of variants) {
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
              : edric;
          window.__cutDone = false;
          c.showCutIn({
            unit,
            unitName: unit.name,
            weaponName: unit.weapon?.name,
            label: v === 'art' ? 'Galeforce Assault' : 'CRITICAL HIT',
            category: v === 'art' ? 'art' : 'offense',
            side: v === 'boss' ? 'right' : 'left',
          }).finally(() => {
            s._awaitSceneDelay = delay;
            window.__cutDone = true;
          });
        }, v);
        await sleep(page, 700);
        await shot(page, `cutin-${v}${reduced ? '-reduced' : ''}`);
        await page.waitForFunction(() => window.__cutDone, null, { timeout: 15000 });
        await sleep(page, 300);
      }
      if (!reduced) {
        await page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          s.showPhaseBanner('enemy', 2);
        });
        await sleep(page, 500);
        await shot(page, 'phase-enemy');
        await page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          s.battleConfig.templateId = 'act3_dark_champion_keep';
          s.showPhaseBanner('player', 1);
        });
        await sleep(page, 700);
        await shot(page, 'phase-player-place');
      }
      await page.context().close();
    }
  },
  // Real victory: rout the last enemies → ROUTED band.
  async victory() {
    const page = await newPage();
    await enterBattle(page, `/?devScene=battle&preset=late_act&seed=42${q}`);
    await settleBattle(page);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.turnManager.turnNumber = 7;
      for (const e of [...s.enemyUnits]) {
        e.currentHP = 0;
        await s.removeUnit(e, { killer: s.playerUnits[0] });
      }
      s.checkBattleEnd();
    });
    await sleep(page, 700);
    await shot(page, 'victory-routed');
    await page.context().close();
  },
  // Lord falls → FALLEN + offer; Accept fate → DEFEAT → THE THREAD IS CUT.
  async fallen() {
    const page = await newPage();
    await enterBattle(page, `/?devScene=battle&preset=late_act&seed=42${q}`);
    await settleBattle(page);
    await useSlot(page);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.gameData = { ...s.gameData, dialogue: { ...s.gameData.dialogue, lordFarewell: {} } };
      const commander = s.playerUnits.find((u) => u.isCommander);
      commander.currentHP = 0;
      await s.removeUnit(commander, { killer: s.enemyUnits[0] });
      s.checkBattleEnd();
    });
    await sleep(page, 1400);
    await shot(page, 'fallen');
    await page.getByRole('button', { name: 'Accept fate', exact: true }).click();
    await sleep(page, 900);
    await shot(page, 'defeat');
    await waitScene(page, 'RunComplete');
    await sleep(page, 2400);
    await shot(page, 'thread-cut');
    const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    else {
      const cont = page.getByRole('button', { name: 'Continue', exact: true });
      if (await cont.isVisible().catch(() => false)) await cont.click();
    }
    await sleep(page, 1200);
    await shot(page, 'result-menu');
    if (page.errors.length) console.log(page.errors);
    await page.context().close();
  },
  // Victory run end (gold counterpart), forced on the RunComplete scene.
  async holds() {
    const page = await newPage();
    await enterBattle(page, `/?devScene=battle&preset=late_act&seed=42${q}`);
    await settleBattle(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.runManager.completedBattles = 14;
      s.runManager.actIndex = s.runManager.actSequence.length - 1;
      s.scene.start('RunComplete', {
        gameData: { ...s.gameData, dialogue: { ...s.gameData.dialogue, runComplete: null } },
        runManager: s.runManager,
        result: 'victory',
      });
    });
    await waitScene(page, 'RunComplete');
    await sleep(page, 1800);
    await shot(page, 'thread-holds');
    await page.context().close();
  },
  // Longest strings on the story cards (run end, act title) at this width.
  async longtext() {
    const page = await newPage();
    await enterBattle(page, `/?devScene=battle&preset=late_act&seed=42${q}`);
    await settleBattle(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      void s._getCeremonies().showRunEnd({
        result: 'defeat',
        commander: 'Astrid',
        actId: 'act3',
        turn: 12,
        defeatContext: { defeatedBy: 'Knight Commander', wasBoss: true },
      });
    });
    await sleep(page, 2600);
    await shot(page, 'thread-cut-longest');
    await page.context().close();
  },
  // Act I at run start (real NodeMap flow) and Act IV (forced).
  async act() {
    const page = await newPage();
    await page.goto(`${base}/?devScene=nodemap&preset=fresh&seed=42${q}`);
    await waitScene(page, 'NodeMap');
    await page.waitForSelector('.ce-act-layer', { timeout: 45000 });
    await sleep(page, 1800);
    await shot(page, 'act1-runstart');
    for (let i = 0; i < 6; i++) {
      const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
      const cont = page.getByRole('button', { name: 'Continue', exact: true });
      if (await skip.isVisible().catch(() => false)) await skip.click();
      else if (await cont.isVisible().catch(() => false)) await cont.click();
      else break;
      await sleep(page, 300);
    }
    await sleep(page, 1200);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const { CeremonyController } = await import('/src/ui/CeremonyController.js');
      window.__act = new CeremonyController(s).showActCard({ actId: 'act3', withLines: false });
    });
    await sleep(page, 1800);
    await shot(page, 'act3-alone');
    await page.context().close();
  },
};

for (const [name, run] of Object.entries(scenarios)) {
  if (want && !want.has(name)) continue;
  try {
    await run();
  } catch (e) {
    console.log('SCENARIO', name, 'FAILED', e.message);
  }
}
await browser.close();
