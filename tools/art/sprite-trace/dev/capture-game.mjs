// In-game review captures: stage the same units on the same cells of a real battle
// (BattlefieldLab maps: grass, forest, stone, snow, swamp, lava) and screenshot the
// canvas at phone viewports and DPRs, for the current rebuilt art and the traced art.
//
//   node tools/art/sprite-trace/dev/capture-game.mjs OUT_DIR [--maps a,b] [--viewports 844x390,667x375]
//        [--dprs 1,3] [--variants rebuilt,traced,traced-device] [--cells 9x5] [--select]
//
// Needs the dev server on 127.0.0.1:3302. Writes lossless WebP crops of the map area.
import { mkdirSync } from 'node:fs';
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
const VARIANTS = {
  rebuilt: '',
  traced: '&spriteArt=traced',
  'traced-device': '&spriteArt=traced&renderScale=device',
  'rebuilt-device': '&renderScale=device',
};
const variants = flag('variants', 'rebuilt,traced,traced-device').split(',');
const [cellsW, cellsH] = flag('cells', '9x5').split('x').map(Number);
const select = args.includes('--select');
const desktop = args.includes('--desktop');
mkdirSync(out, { recursive: true });

// The staged cast (same for every variant): players on the left, enemies right.
const CAST = [
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
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, atmosphere: 'off' }),
    ),
  );
  const url = desktop
    ? `${base}/?devScene=battle&preset=battle_smoke&seed=42${VARIANTS[variant]}`
    : `${base}/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1&labMap=${map}${VARIANTS[variant]}`;
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
          tier: 'base',
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
  const name = `${desktop ? 'desktop' : map}_${vw}x${vh}_dpr${dpr}_${variant}${select ? '_select' : ''}.webp`;
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
