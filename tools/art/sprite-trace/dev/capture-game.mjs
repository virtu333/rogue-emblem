// In-game review captures: stage the same units on the same cells of a real battle
// (BattlefieldLab maps: grass, forest, stone, snow, swamp, lava) and screenshot the
// canvas at phone viewports and DPRs, for the current rebuilt art and the traced art.
//
//   node tools/art/sprite-trace/dev/capture-game.mjs OUT_DIR [--maps a,b] [--viewports 844x390,667x375]
//        [--dprs 1,3] [--variants rebuilt,traced,traced-device] [--cells 9x5] [--select]
//        [--cast v2|v3|all] [--chunk i/n] [--atmosphere act1|act4|rime|deep|...] [--desktop]
//
// --cast all stages every unit kind the battlefield can show (each generic class as a
// player recruit and an enemy, the creatures, the seven lords base and promoted, every
// named boss), split into n chunks by --chunk. --atmosphere turns the act mood on
// (dev grade override) so sprites are judged under dusk / night grading, not flat light.
//
// Needs the dev server on 127.0.0.1:3302. Writes lossless WebP crops of the map area.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';

const args = process.argv.slice(2);
const out = args[0];
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = flag('base', 'http://127.0.0.1:3302');
const maps = flag(
  'maps',
  'river_crossing,forest_ambush,castle_ruins,frozen_pass,mire_crossing,caldera',
).split(',');
const viewports = flag('viewports', '844x390,667x375')
  .split(',')
  .map((v) => v.split('x').map(Number));
const dprs = flag('dprs', '1,3').split(',').map(Number);
// traced sprites are the default since 2026-09-24; the rebuilt set is ?spriteArt=rebuilt
const VARIANTS = {
  rebuilt: '&spriteArt=rebuilt',
  traced: '',
  'traced-device': '&renderScale=device',
  'rebuilt-device': '&spriteArt=rebuilt&renderScale=device',
};
const variants = flag('variants', 'rebuilt,traced,traced-device').split(',');
const [cellsW, cellsH] = flag('cells', '9x5').split('x').map(Number);
const select = args.includes('--select');
const desktop = args.includes('--desktop');
mkdirSync(out, { recursive: true });

// v3: a mixed cast across tiers, mounts, factions and states (lords, promoted
// recruits, flyers, a boss, corrupted enemies, creatures, an ally NPC)
const CAST_V3 = [
  { name: 'Edric', className: 'Lord', faction: 'player', isLord: true, hp: 1 },
  {
    name: 'Astrid',
    className: 'Seraph Knight',
    faction: 'player',
    isLord: true,
    tier: 'promoted',
    hp: 0.9,
  },
  { name: 'Kira', className: 'Tactician', faction: 'player', isLord: true, hp: 0.7, acted: true },
  { name: 'Aldo', className: 'Swordmaster', faction: 'player', tier: 'promoted', hp: 1 },
  { name: 'Brin', className: 'General', faction: 'player', tier: 'promoted', hp: 0.8 },
  { name: 'Cato', className: 'Paladin', faction: 'player', tier: 'promoted', hp: 1 },
  { name: 'Dara', className: 'Wyvern Rider', faction: 'player', hp: 0.6 },
  { name: 'Esk', className: 'Sniper', faction: 'player', tier: 'promoted', hp: 1 },
  { name: 'Fen', className: 'Cleric', faction: 'player', hp: 1, acted: true },
  { name: 'Knight Commander', className: 'Paladin', faction: 'enemy', isBoss: true, hp: 1 },
  { name: 'Warrior', className: 'Warrior', faction: 'enemy', hp: 0.8 },
  { name: 'Berserker', className: 'Berserker', faction: 'enemy', hp: 1, affixes: ['vampiric'] },
  { name: 'Sage', className: 'Sage', faction: 'enemy', hp: 1 },
  { name: 'Dark Knight', className: 'Dark Knight', faction: 'enemy', hp: 0.5 },
  { name: 'Falcon', className: 'Falcon Knight', faction: 'enemy', hp: 1, affixes: ['swift'] },
  { name: 'Zombie', className: 'Zombie', faction: 'enemy', hp: 1 },
  { name: 'Dragon', className: 'Dragon', faction: 'enemy', hp: 1 },
  { name: 'Villager', className: 'Mage', faction: 'npc', hp: 1 },
];

// The staged cast (same for every variant): players on the left, enemies right.
const CAST_V2 = [
  { name: 'Edric', className: 'Lord', faction: 'player', isLord: true, hp: 1 },
  { name: 'Sera', className: 'Light Sage', faction: 'player', isLord: true, hp: 0.8, acted: true },
  { name: 'Aldo', className: 'Myrmidon', faction: 'player', hp: 0.9 },
  { name: 'Brin', className: 'Knight', faction: 'player', hp: 1 },
  { name: 'Cato', className: 'Cavalier', faction: 'player', hp: 0.7 },
  { name: 'Dara', className: 'Pegasus Knight', faction: 'player', hp: 1 },
  { name: 'Myrmidon', className: 'Myrmidon', faction: 'enemy', hp: 1 },
  { name: 'Fighter', className: 'Fighter', faction: 'enemy', hp: 0.6 },
  { name: 'Archer', className: 'Archer', faction: 'enemy', hp: 1 },
  { name: 'Mage', className: 'Mage', faction: 'enemy', hp: 1, affixes: ['vampiric'] },
  { name: 'Knight', className: 'Knight', faction: 'enemy', hp: 0.9 },
  { name: 'Cavalier', className: 'Cavalier', faction: 'enemy', hp: 1 },
  { name: 'Villager', className: 'Cleric', faction: 'npc', hp: 1 },
  { name: 'Thief', className: 'Thief', faction: 'enemy', hp: 1 },
];

// every unit kind (data-driven): recruits and enemies of each class, lords, bosses
const DATA = (f) => JSON.parse(readFileSync(new URL(`../../../../data/${f}`, import.meta.url)));
const NAMES = ['Aldo', 'Brin', 'Cato', 'Dara', 'Esk', 'Fen', 'Gil', 'Hana', 'Ivo', 'Jun'];
function castAll() {
  const lords = DATA('lords.json');
  const lordClasses = new Set(lords.flatMap((l) => [l.class, l.promotedClass]));
  const classes = DATA('classes.json').filter((c) => !lordClasses.has(c.name) && c.tier !== 'boss');
  const out = [];
  for (const l of lords) {
    out.push({ name: l.name, className: l.class, faction: 'player', isLord: true, hp: 1 });
    out.push({
      name: l.name,
      className: l.promotedClass,
      faction: 'player',
      isLord: true,
      tier: 'promoted',
      hp: 1,
    });
  }
  const creatures = new Set(['Zombie', 'Revenant', 'Dragon', 'Dragon Lord']);
  classes.forEach((c, i) => {
    const tier = c.tier === 'promoted' ? 'promoted' : 'base';
    if (!creatures.has(c.name))
      out.push({
        name: NAMES[i % NAMES.length],
        className: c.name,
        faction: 'player',
        tier,
        hp: 1,
      });
    out.push({ name: c.name, className: c.name, faction: 'enemy', tier, hp: 1 });
  });
  const bosses = Object.values(DATA('enemies.json').bosses).flat();
  const seen = new Set();
  for (const b of bosses)
    if (!seen.has(b.name) && seen.add(b.name))
      out.push({ name: b.name, className: b.className, faction: 'enemy', isBoss: true, hp: 1 });
  return out;
}
const castName = flag('cast', 'v2');
let CAST = castName === 'v3' ? CAST_V3 : castName === 'all' ? castAll() : CAST_V2;
const chunk = flag('chunk', null);
if (chunk) {
  const [i, n] = chunk.split('/').map(Number);
  const size = Math.ceil(CAST.length / n);
  CAST = CAST.slice(i * size, (i + 1) * size);
}
const atmosphere = flag('atmosphere', null);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

async function capture(map, [vw, vh], dpr, variant) {
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: dpr,
    isMobile: !desktop,
    hasTouch: !desktop,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const grade = atmosphere;
  await page.addInitScript(
    (grade) =>
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({
          musicVolume: 0,
          sfxVolume: 0,
          hints: false,
          atmosphere: grade ? 'full' : 'off',
        }),
      ),
    grade,
  );
  const mood = grade ? `&atmosphere=${grade}` : '';
  const url = desktop
    ? `${base}/?devScene=battle&preset=battle_smoke&seed=42${VARIANTS[variant]}${mood}`
    : `${base}/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1&labMap=${map}${VARIANTS[variant]}${mood}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__sceneState?.activeScene === 'Battle', null, {
    timeout: 40000,
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits?.length > 0,
    null,
    { timeout: 40000 },
  );
  // leave deployment, wait for the painted terrain
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    if (b.battleState === 'DEPLOY_SELECTION')
      b.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    null,
    { timeout: 40000 },
  );
  if (!desktop)
    await page
      .waitForFunction(() => document.querySelector('.battlefield-lab')?.dataset.terrainArt, null, {
        timeout: 40000,
      })
      .catch(() => {});
  else await page.waitForTimeout(2500);
  await page.waitForTimeout(1200);
  const box = await page.evaluate(
    ({ cast, cellsW, cellsH, select, desktop }) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      document
        .querySelectorAll('.phase-banner, .re-phase-band, [class*="phase"]')
        .forEach((e) => (e.style.display = 'none'));
      const open = (c, r) => {
        const t = b.grid.getTerrainAt(c, r);
        const cost = b.grid.getMoveCost(c, r, 'Infantry');
        return t && Number.isFinite(cost) && cost < 99;
      };
      for (const u of [...b.playerUnits, ...b.enemyUnits, ...(b.npcUnits || [])])
        b.removeUnitGraphic(u);
      b.playerUnits = [];
      b.enemyUnits = [];
      b.npcUnits = [];
      // find the window of cellsW x cellsH with the most open cells, near the centre
      let best = null;
      for (let r0 = 0; r0 + cellsH <= b.grid.rows; r0++)
        for (let c0 = 0; c0 + cellsW <= b.grid.cols; c0++) {
          let n = 0;
          for (let r = r0 + 1; r < r0 + cellsH - 1; r++)
            for (let c = c0 + 1; c < c0 + cellsW - 1; c++) if (open(c, r)) n++;
          const d =
            Math.abs(c0 + cellsW / 2 - b.grid.cols / 2) +
            Math.abs(r0 + cellsH / 2 - b.grid.rows / 2);
          const score = n * 10 - d;
          if (!best || score > best.score) best = { c0, r0, score };
        }
      const cells = [];
      for (let r = best.r0 + 1; r < best.r0 + cellsH - 1; r++)
        for (let c = best.c0 + 1; c < best.c0 + cellsW - 1; c++) if (open(c, r)) cells.push([c, r]);
      // checker spacing: every other cell when there is room
      const spaced = cells.filter(([c, r]) => (c + r) % 2 === 0);
      const use = spaced.length >= cast.length ? spaced : cells;
      cast.slice(0, use.length).forEach((spec, i) => {
        const [col, row] = use[i];
        const u = {
          ...spec,
          id: `stage-${i}`,
          col,
          row,
          level: 5,
          tier: spec.tier || 'base',
          stats: { HP: 30, MOV: 5 },
          currentHP: Math.round(30 * spec.hp),
          affixes: spec.affixes || [],
          inventory: [],
          skills: [],
          proficiencies: [],
        };
        b.addUnitGraphic(u);
        (u.faction === 'enemy'
          ? b.enemyUnits
          : u.faction === 'npc'
            ? b.npcUnits
            : b.playerUnits
        ).push(u);
        if (spec.acted) b.dimUnit(u);
      });
      if (select) {
        const u = b.playerUnits[2];
        const reach = [];
        for (let dc = -2; dc <= 2; dc++)
          for (let dr = -2; dr <= 2; dr++)
            if (Math.abs(dc) + Math.abs(dr) <= 2) reach.push({ col: u.col + dc, row: u.row + dr });
        const reachable = new Map(reach.map((t) => [`${t.col},${t.row}`, t]));
        b.grid.showMovementRange?.(reachable, u.col, u.row);
        b.dangerZone?.show?.(b.calculateDangerZone());
      }
      // camera: tactical zoom (34 CSS px per tile), centred on the staged window
      const cam = b.cameras.main;
      const rect = window.__emblemRogueGame.canvas.getBoundingClientRect();
      const zoom = desktop ? cam.zoom : (34 * cam.height) / (rect.height * 32);
      cam.setZoom(zoom);
      const centre = b.grid.gridToPixel(best.c0 + (cellsW - 1) / 2, best.r0 + (cellsH - 1) / 2);
      if (!desktop) cam.centerOn(centre.x, centre.y);
      // screen rect of the window (CSS px)
      const tl = b.grid.gridToPixel(best.c0, best.r0);
      const toScreen = (x, y) => {
        const off = {
          x: (cam.width / 2) * (1 - 1 / cam.zoom),
          y: (cam.height / 2) * (1 - 1 / cam.zoom),
        };
        return { x: (x - cam.scrollX - off.x) * cam.zoom, y: (y - cam.scrollY - off.y) * cam.zoom };
      };
      const p0 = toScreen(tl.x - 16, tl.y - 16);
      const k = rect.height / cam.height;
      return {
        x: rect.left + p0.x * k,
        y: rect.top + p0.y * k,
        w: cellsW * 32 * cam.zoom * k,
        h: cellsH * 32 * cam.zoom * k,
      };
    },
    { cast: CAST, cellsW, cellsH, select, desktop },
  );
  await page.waitForTimeout(400);
  const clip = {
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
    width: Math.min(box.w, vw - box.x),
    height: Math.min(box.h, vh - box.y),
  };
  const png = await page.screenshot({ clip });
  const tag = `${grade ? `_${grade}` : ''}${chunk ? `_c${chunk.split('/')[0]}` : ''}`;
  const name = `${desktop ? 'desktop' : map}_${vw}x${vh}_dpr${dpr}_${variant}${tag}${select ? '_select' : ''}.webp`;
  await sharp(png).webp({ lossless: true, effort: 6 }).toFile(`${out}/${name}`);
  await context.close();
  return name;
}

for (const map of maps)
  for (const vp of viewports)
    for (const dpr of dprs)
      for (const v of variants) {
        const name = await capture(map, vp, dpr, v);
        console.log(name);
      }
await browser.close();
