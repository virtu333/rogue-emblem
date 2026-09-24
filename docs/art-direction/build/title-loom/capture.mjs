// Captures the implemented title (The Hollow Sun) and route map (the Loom) from the
// running game for docs/art-direction/build/title-loom/.
//
//   npx vite --port 3000 &            (any dev server; pass its origin below)
//   node docs/art-direction/build/title-loom/capture.mjs [origin] [chromium-path]
//
// Loom captures swap in the approved board's act (the real generator, Mulberry32
// seed 6: docs/art-direction/board/loom/gen/generate-graph.mjs) so the build can be
// compared with the study state by state. Nothing is saved to a slot.
import { chromium, devices } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = process.argv[2] || 'http://127.0.0.1:3000';
const executablePath = process.argv[3] || process.env.CHROMIUM || undefined;
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const PHONE = { width: 844, height: 390 };
const PHONE_SMALL = { width: 667, height: 375 };
const DESKTOP = { width: 960, height: 720 };

const BOARD_STATES = {
  choice: { completed: ['act1_0_2'], current: 'act1_0_2', selected: 'act1_1_2' },
  mid: {
    completed: ['act1_0_2', 'act1_1_2', 'act1_2_2', 'act1_3_2'],
    current: 'act1_3_2',
    selected: 'act1_4_1',
  },
  vision: {
    completed: ['act1_0_2', 'act1_1_2', 'act1_2_2', 'act1_3_2'],
    current: 'act1_3_2',
    selected: 'act1_5_2',
  },
  frayed: {
    completed: ['act1_0_2', 'act1_1_2', 'act1_2_2', 'act1_3_2'],
    current: 'act1_3_2',
    selected: 'act1_5_4',
  },
};

function context(browser, viewport, phone, extra = {}) {
  const opts = phone
    ? { ...devices['iPhone 13'], viewport, deviceScaleFactor: 2 }
    : { viewport, deviceScaleFactor: 1 };
  delete opts.defaultBrowserType;
  return browser.newContext({ ...opts, ...extra });
}

async function waitScene(page, key) {
  await page.waitForFunction((k) => window.__emblemRogueGame?.scene?.isActive(k), key, {
    timeout: 120_000,
  });
}

async function settle(page, ms = 1200) {
  // Dev-route saves have no slot; hide that toast so it never covers a capture.
  await page.addStyleTag({ content: '.re-hint-toast{display:none!important}' });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(ms);
}

async function skipStory(page) {
  // The act intro can start a beat after the scene; keep skipping until the route shows.
  for (let i = 0; i < 80; i++) {
    const state = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(
        (el) => /^(Skip conversation|Continue)$/.test(el.textContent.trim()) && el.offsetParent,
      );
      b?.click();
      const route = document.querySelector('.re-node-map');
      return { clicked: !!b, route: !!route && !route.hidden };
    });
    if (state.route && !state.clicked) return;
    await page.waitForTimeout(250);
  }
}

async function title(browser, name, viewport, phone, milestone) {
  const ctx = await context(browser, viewport, phone);
  const page = await ctx.newPage();
  if (milestone)
    await page.addInitScript(
      (m) => localStorage.setItem('emblem_rogue_slot_1_meta', JSON.stringify({ milestones: [m] })),
      milestone,
    );
  await page.goto(`${origin}/?devScene=title${phone ? '&mobilePreview=1' : ''}`);
  await waitScene(page, 'Title');
  await page.waitForSelector('.re-title-art.re-keyart-ready');
  await settle(page, 1500);
  await page.screenshot({ path: path.join(here, `${name}.png`) });
  await ctx.close();
}

// Returning player with one suspended run: the longest title menu (Resume, New Game,
// Save Slots, Tutorial). Uses the same fixture as tests/e2e/save-choice-contracts.
async function titleResume(browser, name, viewport, phone) {
  const ctx = await context(browser, viewport, phone);
  const page = await ctx.newPage();
  await page.goto(
    `${origin}/?devScene=battle&preset=battle_smoke&seed=42${phone ? '&mobilePreview=1' : ''}`,
  );
  await waitScene(page, 'Battle');
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, getRunKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = s.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    setActiveSlot(1);
    const run = s.runManager.toJSON();
    run.savedAt = Date.now();
    run.battleInProgress = null;
    localStorage.setItem(getRunKey(1), JSON.stringify(run));
    const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
    await ensureSceneLoaded(s, 'Title');
    s.scene.start('Title', { gameData: s.gameData });
  });
  await waitScene(page, 'Title');
  await page.waitForSelector('.re-title-art.re-keyart-ready');
  await settle(page, 1500);
  await page.screenshot({ path: path.join(here, `${name}.png`) });
  await ctx.close();
}

async function auth(browser, name, viewport, phone) {
  const ctx = await context(browser, viewport, phone);
  const page = await ctx.newPage();
  // Cloud builds show the auth gate; emulate one with a stub client (no network).
  await page.route(/\/src\/cloud\/supabaseClient\.js(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /export const supabase =[\s\S]*?null;/,
      'export const supabase = { auth: { getSession: async () => ({ data: { session: null } }) } };',
    );
    await route.fulfill({ response, body });
  });
  await page.goto(`${origin}/`);
  await page.waitForSelector('#auth-wrapper.re-keyart-ready', { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(here, `${name}.png`) });
  await ctx.close();
}

async function loom(browser, name, viewport, phone, stateKey) {
  const ctx = await context(browser, viewport, phone);
  const page = await ctx.newPage();
  await page.goto(
    `${origin}/?devScene=nodemap&preset=fresh&seed=6${phone ? '&mobilePreview=1' : ''}`,
  );
  await waitScene(page, 'NodeMap');
  await skipStory(page);
  await page.evaluate(async (S) => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const rm = scene.runManager;
    const { generateNodeMap } = await import('/src/engine/NodeMapGenerator.js');
    const { ACT_CONFIG } = await import('/src/utils/constants.js');
    let a = 6;
    const seeded = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const real = Math.random;
    Math.random = seeded;
    const map = generateNodeMap('act1', ACT_CONFIG.act1, scene.gameData.mapTemplates, {
      fogChanceBonus: 0,
      halfFogChance: true,
      villageAmbushChance: 0,
      colosseumConfig: scene.gameData.colosseum?.nodeGeneration ?? null,
      caravanChanceBonus: 0,
    });
    Math.random = real;
    rm.nodeMap = map;
    for (const id of S.completed) map.nodes.find((n) => n.id === id).completed = true;
    rm.currentNodeId = S.current;
    rm.completedBattles = S.completed.length;
    rm.gold = S.completed.length > 2 ? 1240 : 385;
    scene.nodeView.selected = S.selected;
    scene.drawMap();
  }, BOARD_STATES[stateKey]);
  await skipStory(page);
  await settle(page, 1200);
  await page.screenshot({ path: path.join(here, `${name}.png`) });
  await ctx.close();
}

async function campaignInBattle(browser, name, viewport, phone) {
  const ctx = await context(browser, viewport, phone);
  const page = await ctx.newPage();
  await page.goto(
    `${origin}/?devScene=battle&preset=battle_smoke&seed=42${phone ? '&mobilePreview=1' : ''}&battleLab=1`,
  );
  await waitScene(page, 'Battle');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').showPauseMenu());
  await page.getByRole('button', { name: 'Campaign Map', exact: true }).click();
  await page.getByRole('dialog', { name: 'Campaign map', exact: true }).waitFor();
  await settle(page, 1200);
  await page.screenshot({ path: path.join(here, `${name}.png`) });
  await ctx.close();
}

const shots = [
  ['title_dusk_phone', (b) => title(b, 'title_dusk_phone', PHONE, true, null)],
  ['title_rising_phone', (b) => title(b, 'title_rising_phone', PHONE, true, 'beatAct1')],
  ['title_ashfall_phone', (b) => title(b, 'title_ashfall_phone', PHONE, true, 'beatGame')],
  ['title_dusk_phone_small', (b) => title(b, 'title_dusk_phone_small', PHONE_SMALL, true, null)],
  [
    'title_rising_phone_small',
    (b) => title(b, 'title_rising_phone_small', PHONE_SMALL, true, 'beatAct1'),
  ],
  [
    'title_ashfall_phone_small',
    (b) => title(b, 'title_ashfall_phone_small', PHONE_SMALL, true, 'beatGame'),
  ],
  ['title_dusk_desktop', (b) => title(b, 'title_dusk_desktop', DESKTOP, false, null)],
  ['title_rising_desktop', (b) => title(b, 'title_rising_desktop', DESKTOP, false, 'beatAct1')],
  ['title_ashfall_desktop', (b) => title(b, 'title_ashfall_desktop', DESKTOP, false, 'beatGame')],
  ['title_resume_phone', (b) => titleResume(b, 'title_resume_phone', PHONE, true)],
  [
    'title_resume_phone_small',
    (b) => titleResume(b, 'title_resume_phone_small', PHONE_SMALL, true),
  ],
  ['auth_phone', (b) => auth(b, 'auth_phone', PHONE, true)],
  ['auth_phone_portrait', (b) => auth(b, 'auth_phone_portrait', { width: 390, height: 844 }, true)],
  ['auth_desktop', (b) => auth(b, 'auth_desktop', DESKTOP, false)],
  ['loom_first_choice_phone', (b) => loom(b, 'loom_first_choice_phone', PHONE, true, 'choice')],
  ['loom_mid_elite_phone', (b) => loom(b, 'loom_mid_elite_phone', PHONE, true, 'mid')],
  ['loom_vision_phone', (b) => loom(b, 'loom_vision_phone', PHONE, true, 'vision')],
  ['loom_frayed_phone', (b) => loom(b, 'loom_frayed_phone', PHONE, true, 'frayed')],
  [
    'loom_first_choice_phone_small',
    (b) => loom(b, 'loom_first_choice_phone_small', PHONE_SMALL, true, 'choice'),
  ],
  ['loom_mid_elite_desktop', (b) => loom(b, 'loom_mid_elite_desktop', DESKTOP, false, 'mid')],
  ['loom_vision_desktop', (b) => loom(b, 'loom_vision_desktop', DESKTOP, false, 'vision')],
  [
    'loom_campaign_battle_phone',
    (b) => campaignInBattle(b, 'loom_campaign_battle_phone', PHONE, true),
  ],
  [
    'loom_campaign_battle_desktop',
    (b) => campaignInBattle(b, 'loom_campaign_battle_desktop', DESKTOP, false),
  ],
];

const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const [name, run] of shots) {
    if (only && !only.test(name)) continue;
    process.stdout.write(`${name} … `);
    await run(browser);
    console.log('ok');
  }
} finally {
  await browser.close();
}
