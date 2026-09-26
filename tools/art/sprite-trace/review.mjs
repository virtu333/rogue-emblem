#!/usr/bin/env node
// Review sheets for docs/art-direction/sprites-v2 (offline, deterministic):
//   node tools/art/sprite-trace/review.mjs [--out docs/art-direction/sprites-v2] [--only a,b]
// sections: lineup checks recruits sword states anim pipeline density
// In-game captures are separate: dev/capture-game.mjs (needs the dev server).
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeWebp, writeGif, textRaster, readRaster } from './lib/io.mjs';
import { Raster, hstack, vstack } from './lib/raster.mjs';
import { bakeFrames, recruitEntries, loadNative, traceId, allEntries } from './lib/pipeline.mjs';
import { swatch, SWATCHES } from './lib/terrain.mjs';
import { render } from './lib/render.mjs';
import { paletteFor, actedGrade, hitFlash, multiplyActed } from './lib/treat.mjs';
import { SLOT_DEBUG } from './lib/slots.mjs';
import { segment } from './lib/segment.mjs';
import { traceNative } from './lib/trace.mjs';
import { splitFigures } from './lib/figures.mjs';
import { ROSTER, reviewEntry } from './roster.mjs';

const BAKE = allEntries();

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = flag('out', 'docs/art-direction/sprites-v2');
const only = flag('only', null)?.split(',');
const want = (s) => !only || only.includes(s);
mkdirSync(`${OUT}/anim`, { recursive: true });

const INK = [20, 20, 24, 255];
const PAPER = '#ddd0bd';
const label = (t, width, size = 11) => textRaster(t, { size, bg: '#16131e', color: PAPER, width });
const tight = (img, pad = 2) => {
  const b = img.alphaBounds(0);
  return img.crop(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
};
const on = (bg, img) => bg.clone().draw(img, 0, 0);
const flat = (img, c = [92, 104, 84, 255]) =>
  new Raster(img.w, img.h).fillRect(0, 0, img.w, img.h, c).draw(img, 0, 0);
const byKey = (k) => reviewEntry(k, BAKE);
const lum = ([r, g, b, a]) => {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return [l, l, l, a];
};
const deutan = ([r, g, b, a]) => [
  0.367 * r + 0.861 * g - 0.228 * b,
  0.28 * r + 0.673 * g + 0.047 * b,
  -0.012 * r + 0.043 * g + 0.969 * b,
  a,
];
const silhouette = ([, , , a]) => (a ? [16, 14, 20, 255] : [0, 0, 0, 0]);

const CLASSES = [
  'myrmidon',
  'mercenary',
  'thief',
  'fighter',
  'knight',
  'archer',
  'mage',
  'cleric',
  'cavalier',
  'pegasus_knight',
];

// --- lineup: every class x (player, enemy, corrupted, NPC), lords and bosses ------------
if (want('lineup')) {
  const grass = swatch('grass');
  for (const [zoom, name] of [
    [1, 'lineup_1x'],
    [3, 'lineup_3x'],
  ]) {
    const rows = [];
    const head = ['', 'player', 'enemy', 'corrupted', 'NPC'];
    const cw = 96 * zoom;
    rows.push(hstack(await Promise.all(head.map((h, i) => label(h, i ? cw : 120))), 4, INK));
    for (const cls of CLASSES) {
      const cells = [await label(cls, 120)];
      for (const key of [cls, `enemy_${cls}`, `enemy_${cls}-corrupt`, `npc_${cls}`]) {
        const { still } = await bakeFrames(byKey(key));
        cells.push(on(grass, still).scale(zoom));
      }
      rows.push(hstack(cells, 4, INK));
    }
    const lords = [await label('lords', 120)];
    for (const key of ['lord_edric', 'lord_edric_promoted', 'lord_sera', 'lord_kira'])
      lords.push(on(grass, (await bakeFrames(byKey(key))).still).scale(zoom));
    rows.push(hstack(lords, 4, INK));
    const bosses = [await label('promoted\n& bosses', 120)];
    for (const key of ['swordmaster', 'enemy_swordmaster', 'boss_blade_lord', 'boss_iron_wall'])
      bosses.push(on(grass, (await bakeFrames(byKey(key))).still).scale(zoom));
    rows.push(hstack(bosses, 4, INK));
    await writeWebp(vstack(rows, 4, INK), `${OUT}/${name}.webp`);
  }
  console.log('lineup');
}

// --- checks: terrain, grayscale, silhouette, acted, colour vision ----------------------
if (want('checks')) {
  const sw = Object.fromEntries(SWATCHES.map(([l]) => [l, swatch(l)]));
  const cols = [
    ...SWATCHES.map(([l]) => [l, (s) => on(sw[l], s)]),
    ['gray/grass', (s) => on(sw.grass, s).map(lum)],
    ['gray/swamp', (s) => on(sw.swamp, s).map(lum)],
    ['silhouette', (s) => flat(s.map(silhouette), [200, 196, 186, 255])],
    ['acted (game)', (s) => on(sw.grass, s.map(multiplyActed))],
    ['acted (palette)', null],
    ['deutan', (s) => on(sw.grass, s).map(deutan)],
  ];
  for (const [faction, keys] of [
    ['player', ['lord_edric', 'lord_sera', ...CLASSES]],
    ['enemy', [...CLASSES.map((c) => `enemy_${c}`), 'boss_blade_lord', 'boss_iron_wall']],
  ]) {
    const rows = [
      hstack(await Promise.all([label('', 150), ...cols.map(([n]) => label(n, 96, 10))]), 2, INK),
    ];
    for (const key of keys) {
      const e = byKey(key);
      const f = await bakeFrames(e);
      const acted = render(f.sprite, { ...f.palette, grade: actedGrade() });
      const cells = [await label(key, 150, 10)];
      for (const [n, fn] of cols)
        cells.push(n === 'acted (palette)' ? on(sw.grass, acted) : fn(f.still));
      rows.push(hstack(cells, 2, INK));
    }
    await writeWebp(vstack(rows, 2, INK), `${OUT}/checks_${faction}.webp`);
  }
  console.log('checks');
}

// --- seeded recruits and their promotion -------------------------------------------------
if (want('recruits')) {
  const grass = swatch('grass');
  const rec = recruitEntries();
  const top = [await label('Myrmidon', 110)],
    bot = [await label('Swordmaster', 110)],
    names = [await label('', 110)];
  for (const r of rec) {
    const a = (await bakeFrames(r.base)).still,
      b = (await bakeFrames(r.promoted)).still;
    top.push(on(grass, a).crop(8, 4, 80, 70).scale(3));
    bot.push(on(grass, b).crop(8, 4, 80, 70).scale(3));
    const id = r.base.person;
    names.push(
      await label(
        `${id.id} ${id.design.toUpperCase()} ${id.hair.replace('hair', '')}\n${id.skin.replace('skin', '')}${id.bald ? ' bald' : ''}`,
        240,
        10,
      ),
    );
  }
  const enemy = [await label('enemy\n(issue kit)', 110)];
  for (let i = 0; i < 6; i++)
    enemy.push(
      on(grass, (await bakeFrames(byKey('enemy_myrmidon'))).still)
        .crop(8, 4, 80, 70)
        .scale(3),
    );
  await writeWebp(
    vstack(
      [hstack(names, 4, INK), hstack(top, 4, INK), hstack(bot, 4, INK), hstack(enemy, 4, INK)],
      4,
      INK,
    ),
    `${OUT}/recruits_3x.webp`,
  );
  console.log('recruits');
}

// --- blind sword-class test ----------------------------------------------------------------
if (want('sword')) {
  const grass = swatch('grass');
  // fixed shuffled order; the key is written separately
  const order = [
    'enemy_thief',
    'mercenary',
    'enemy_myrmidon',
    'thief',
    'enemy_mercenary',
    'myrmidon',
  ];
  const phone = [],
    big = [],
    sil = [];
  for (const [i, k] of order.entries()) {
    const s = (await bakeFrames(byKey(k))).still;
    const tile = on(grass, s);
    phone.push(vstack([tile.resizeNearest(64, 64), await label(String(i + 1), 64)]));
    big.push(tile.crop(8, 4, 80, 70).scale(3));
    sil.push(flat(s.map(silhouette), [200, 196, 186, 255]).crop(8, 4, 80, 70).scale(2));
  }
  await writeWebp(
    vstack(
      [
        await label(
          'Name the three sword classes (Myrmidon / Mercenary / Thief) before opening sword_test_key.txt',
          1500,
        ),
        hstack(phone, 8, INK),
        hstack(big, 8, INK),
        hstack(sil, 8, INK),
      ],
      8,
      INK,
    ),
    `${OUT}/sword_test.webp`,
  );
  writeFileSync(
    `${OUT}/sword_test_key.txt`,
    order.map((k, i) => `${i + 1}: ${k}`).join('\n') + '\n',
  );
  console.log('sword');
}

// --- states --------------------------------------------------------------------------------
if (want('states')) {
  const grass = swatch('grass');
  const heads = [
    'ready',
    'acted (game x0xb8)',
    'acted (palette op)',
    'hit flash',
    'windup',
    'strike',
    'corrupted',
  ];
  const rows = [
    hstack(await Promise.all([label('', 150), ...heads.map((h) => label(h, 240, 10))]), 4, INK),
  ];
  for (const key of ['lord_edric', 'knight', 'enemy_myrmidon', 'enemy_cavalier', 'lord_sera']) {
    const e = byKey(key);
    const f = await bakeFrames(e);
    const corrupt = BAKE.find((b) => b.key === `${key.replace(/^enemy_/, 'enemy_')}-corrupt`) || {
      ...e,
      faction: 'corrupted',
      corrupt: true,
    };
    const c = (await bakeFrames({ ...corrupt, key: `${key}-corrupt` })).still;
    const acted = render(f.sprite, { ...f.palette, grade: actedGrade() });
    const cells = [
      f.still,
      f.still.map(multiplyActed),
      acted,
      hitFlash(f.still),
      f.attack[0],
      f.attack[1],
      c,
    ];
    rows.push(
      hstack(
        [await label(key, 150, 10), ...cells.map((s) => on(grass, s).crop(8, 4, 80, 70).scale(3))],
        4,
        INK,
      ),
    );
  }
  await writeWebp(vstack(rows, 4, INK), `${OUT}/states_3x.webp`);
  console.log('states');
}

// --- animation GIFs -----------------------------------------------------------------------------
if (want('anim')) {
  const grass = swatch('grass');
  for (const key of [
    'lord_edric',
    'lord_sera',
    'myrmidon',
    'knight',
    'enemy_fighter',
    'enemy_archer',
    'cavalier',
    'pegasus_knight',
    'enemy_mage-corrupt',
  ]) {
    const f = await bakeFrames(byKey(key));
    const z = (s) => on(grass, s).scale(3);
    await writeGif(`${OUT}/anim/${key.replace('~', '_')}_idle.gif`, f.idle.map(z), 260);
    await writeGif(
      `${OUT}/anim/${key.replace('~', '_')}_attack.gif`,
      [f.idle[0], f.attack[0], f.attack[1], f.attack[1], f.idle[0]].map(z),
      [300, 180, 90, 240, 400],
    );
  }
  console.log('anim');
}

// --- pipeline steps --------------------------------------------------------------------------------
if (want('pipeline')) {
  const rows = [];
  for (const id of ['edric', 'knight_a', 'myrmidon_e']) {
    const e = ROSTER.sources[id];
    const src = await readRaster(e.src);
    const box = e.figure != null ? splitFigures(src, 3)[e.figure] : src.alphaBounds(64);
    const crop = src.crop(box.x, box.y, box.width, box.height);
    const H = 300;
    const { native, pitch, mode } = await loadNative(id);
    const seg = segment(native, e);
    const slotMap = new Raster(native.w, native.h);
    for (let p = 0; p < native.w * native.h; p++) {
      const c = SLOT_DEBUG[seg.slot[p]];
      if (c) slotMap.d.set([...c, 255], p * 4);
    }
    const t = await traceId(id);
    const raw = traceNative(
      native,
      { ...e, keyLight: false, eyes: false, speck: 0, calm: 0, orphans: false },
      { density: 1.5, aspect: pitch.y / pitch.x },
    );
    const fit = (img) => flat(img).resizeNearest(Math.round((img.w * H) / img.h), H);
    const steps = [
      [`source ${crop.w}x${crop.h}`, flat(crop).resizeArea(Math.round((crop.w * H) / crop.h), H)],
      [
        `native ${native.w}x${native.h} (pitch ${pitch.x.toFixed(1)}${pitch.y !== pitch.x ? `x${pitch.y.toFixed(1)}` : ''}, ${mode})`,
        fit(native),
      ],
      ['materials', fit(slotMap)],
      ['reduced (no cleanup)', fit(tight(render(raw.sprite, { ramps: raw.ramps, eye: raw.eye })))],
      ['cleaned + lit', fit(tight(render(t.sprite, { ramps: t.ramps, eye: t.eye })))],
      [
        'player',
        fit(
          tight(render(t.sprite, paletteFor(t, { faction: 'player', keepMain: id === 'edric' }))),
        ),
      ],
      ['enemy', fit(tight(render(t.sprite, paletteFor(t, { faction: 'enemy' }))))],
    ];
    const cells = [];
    for (const [n, img] of steps) cells.push(vstack([img, await label(n, img.w, 10)]));
    rows.push(hstack(cells, 6, INK));
  }
  await writeWebp(vstack(rows, 8, INK), `${OUT}/pipeline.webp`);
  console.log('pipeline');
}

// --- density comparison at DPR 3 device pixels --------------------------------------------------
if (want('density')) {
  // A DPR-3 phone at the tactical zoom shows ~109 device px per 32 px tile, i.e. a 64-world-px
  // texture window on ~218 device px. Every variant is sampled the way the GPU does (nearest).
  const DEVICE = 218;
  const rows = [];
  const heads = [
    'rebuilt today (64 px)',
    'traced D=1 (64 px)',
    'traced D=1.5 (96 px)',
    'traced D=2 (128 px)',
  ];
  rows.push(
    hstack(await Promise.all([label('', 110), ...heads.map((h) => label(h, DEVICE, 10))]), 4, INK),
  );
  for (const id of ['edric', 'myrmidon_a', 'knight_e']) {
    const { native, pitch } = await loadNative(id);
    const e = ROSTER.sources[id];
    const cells = [await label(id, 110)];
    // the rebuilt runtime path: nearest-sample the 1024 px source into the 64 px placement
    const rebuiltKey = {
      edric: 'lord_edric',
      myrmidon_a: 'enemy_myrmidon',
      knight_e: 'enemy_knight',
    }[id];
    const rsrc = await readRaster(`docs/art/rebuilt-sprite-sources/${rebuiltKey}.png`);
    const rb = rsrc.alphaBounds(10);
    const sc = Math.min(38 / rb.width, (e.kind === 'heavy' ? 36 : 34) / rb.height);
    const rw = Math.max(1, Math.round(rb.width * sc)),
      rh = Math.max(1, Math.round(rb.height * sc));
    const r64 = new Raster(64, 64).draw(
      rsrc.crop(rb.x, rb.y, rb.width, rb.height).resizeNearest(rw, rh),
      Math.round((64 - rw) / 2),
      44 - rh,
    );
    const grass96 = swatch('grass');
    const bgFor = (size) => grass96.resizeNearest(size, size);
    cells.push(on(bgFor(64), r64).resizeNearest(DEVICE, DEVICE));
    for (const D of [1, 1.5, 2]) {
      const t = traceNative(native, e, { density: D, aspect: pitch.y / pitch.x });
      const pal = paletteFor(t, {
        faction: e.main === 'red' ? 'enemy' : 'player',
        keepMain: id === 'edric',
      });
      const img = render(t.sprite, pal);
      cells.push(on(bgFor(img.w), img).resizeNearest(DEVICE, DEVICE));
    }
    rows.push(hstack(cells, 4, INK));
  }
  await writeWebp(vstack(rows, 4, INK), `${OUT}/density_dpr3.webp`);
  console.log('density');
}

// --- sources: which reference each unit is traced from, against the alternatives --------
if (want('sources')) {
  const grass = swatch('grass');
  const heads = [
    'current game (rebuilt, 64 px)',
    'hand-authored sprite-kit (64 px)',
    'traced from an earlier source',
    'traced from the chosen source',
  ];
  const rows = [
    hstack(await Promise.all([label('', 150), ...heads.map((h) => label(h, 240, 10))]), 4, INK),
  ];
  const units = [
    ['Edric', 'lord_edric', 'player_lord_edric', 'edric_rebuilt', 'edric', 'player'],
    ['Sera', 'lord_sera', null, 'sera_rebuilt', 'sera', 'player'],
    ['Myrmidon', 'enemy_myrmidon', 'player_myrmidon', 'myrmidon_v1', 'myrmidon_a', 'player'],
    ['Archer', 'enemy_archer', 'player_archer', 'archer_v1', 'archer_a', 'player'],
    ['Enemy Knight', 'enemy_knight', 'enemy_knight', 'knight_v1', 'knight_e', 'enemy'],
  ];
  const big = (img) => {
    const scaled = img.w === 64 ? img.resizeNearest(96, 96) : img;
    return on(grass, scaled).crop(8, 4, 80, 70).scale(3);
  };
  for (const [name, rebuiltKey, kitName, earlier, chosen, faction] of units) {
    const rsrc = await readRaster(`docs/art/rebuilt-sprite-sources/${rebuiltKey}.png`);
    const rb = rsrc.alphaBounds(10);
    const sc = Math.min(38 / rb.width, (rebuiltKey.includes('knight') ? 36 : 34) / rb.height);
    const rw = Math.max(1, Math.round(rb.width * sc)),
      rh = Math.max(1, Math.round(rb.height * sc));
    const r64 = new Raster(64, 64).draw(
      rsrc.crop(rb.x, rb.y, rb.width, rb.height).resizeNearest(rw, rh),
      Math.round((64 - rw) / 2),
      44 - rh,
    );
    const kit = kitName
      ? await readRaster(`docs/art/sprite-candidates/sprites/${kitName}.png`)
      : null;
    const keepMain = name === 'Edric' || name === 'Sera';
    const tr = async (id) => {
      const t = await traceId(id);
      return render(t.sprite, paletteFor(t, { faction, keepMain }));
    };
    const cells = [
      big(r64),
      kit ? big(kit) : flat(new Raster(240, 210), [40, 40, 46, 255]),
      big(await tr(earlier)),
      big(await tr(chosen)),
    ];
    const where = ROSTER.sources[chosen].src.split('/').slice(-3).join('/');
    rows.push(hstack([await label(`${name}\n${where}`, 150, 9), ...cells], 4, INK));
  }
  await writeWebp(vstack(rows, 4, INK), `${OUT}/sources_3x.webp`);
  console.log('sources');
}
