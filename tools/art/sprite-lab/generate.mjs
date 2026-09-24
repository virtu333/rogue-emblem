#!/usr/bin/env node
// Sprite lab — procedural map-sprite study. Renders every sprite, animation and
// review capture into docs/art-direction/sprites/ (deterministic).
//
//   node tools/art/sprite-lab/generate.mjs [--out DIR] [--only sprites,lineup,compare,phone,checks,sword,recruits,anim,derived,states]
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Img, writeGif } from './lib/image.mjs';
import { RECIPES } from './lib/recipes.mjs';
import { LORDS, GENERICS, PLAYER_SEED, spec, tex } from './lib/units.mjs';
import { rollIdentity } from './lib/identity.mjs';
import { hashString } from './lib/rng.mjs';
import { loadCurrent, loadRebuilt } from './lib/rebuilt.mjs';
import { loadBoard, stage, openCells, STUDY_MAPS } from './lib/stage.mjs';
import { gridSheet, onGround, hcat, caption, MEADOW } from './lib/sheet.mjs';
import { hitFlash, gameHalo, acted, grayscale, silhouette, deutan } from './lib/treat.mjs';
import { derive, treatedRebuilt } from './lib/derive.mjs';
import { resolve, unlightGrade } from './lib/resolve.mjs';
import { splitImage } from './lib/treat.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const OUT = opt('--out', join(ROOT, 'docs/art-direction/sprites'));
const ONLY = opt('--only', null)?.split(',');
const want = (k) => !ONLY || ONLY.includes(k);
for (const d of ['', 'sprites', 'anim']) mkdirSync(join(OUT, d), { recursive: true });

const FACTIONS = ['player', 'enemy', 'corrupted'];
const ALL = [...LORDS, ...GENERICS];
const factionsOf = (cls) => (cls.startsWith('lord_') ? ['player'] : FACTIONS);
const unitOf = (cls, faction, extra = {}) =>
  spec(cls, faction, extra.seed ?? PLAYER_SEED[cls] ?? 1, extra);
const T = (cls, faction, extra = {}) => tex(unitOf(cls, faction, extra), extra.render ?? {});
const short = (cls) => RECIPES[cls].label.replace(/ \(.*\)/, '');
const log = (...a) => console.log(...a);
const manifest = { generated: 'tools/art/sprite-lab/generate.mjs', sprites: [] };

// ------------------------------------------------------------ 1. sprites ----
if (want('sprites')) {
  for (const cls of [...ALL, 'swordmaster'])
    for (const faction of factionsOf(cls)) {
      const u = unitOf(cls, faction);
      const idle = [0, 1, 2, 3].map((frame) => tex({ ...u, pose: 'idle', frame }));
      const wind = tex({ ...u, pose: 'windup' });
      const strike = tex({ ...u, pose: 'strike' });
      const flash = Img.from(64, 64, hitFlash(idle[0].d));
      const key = `${cls}_${faction}`;
      await idle[0].png(join(OUT, 'sprites', `${key}.png`));
      await hcat(idle, 0, [0, 0, 0, 0]).png(join(OUT, 'anim', `${key}_idle.png`));
      await hcat([wind, strike, idle[0], flash], 0, [0, 0, 0, 0]).png(
        join(OUT, 'anim', `${key}_attack.png`),
      );
      const b = idle[0].alphaBounds();
      manifest.sprites.push({
        key,
        cls,
        faction,
        seed: u.seed,
        id: u.id,
        bounds: b,
        kind: RECIPES[cls].kind,
      });
    }
  writeFileSync(join(OUT, 'sprites', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  log('sprites', manifest.sprites.length);
}

// ------------------------------------------------------------- 2. lineup ----
if (want('lineup')) {
  const rows = [];
  const lordCells = LORDS.map((c) => ({ img: onGround(T(c, 'player')), label: short(c) }));
  rows.push({
    title: 'player',
    cells: [
      ...lordCells,
      ...GENERICS.map((c) => ({ img: onGround(T(c, 'player')), label: short(c) })),
    ],
  });
  for (const f of ['enemy', 'corrupted'])
    rows.push({
      title: f,
      cells: [
        { img: new Img(48, 48) },
        { img: new Img(48, 48) },
        ...GENERICS.map((c) => ({ img: onGround(T(c, f)) })),
      ],
    });
  const one = await gridSheet(rows, {
    title: 'Procedural sprites, 1x (one texel = one world px; tile = 32)',
    labelSize: 9,
  });
  await one.png(join(OUT, 'lineup_1x.png'));
  const rows3 = rows.map((r) => ({
    ...r,
    cells: r.cells.map((c) => ({ ...c, img: c.img.scale(3) })),
  }));
  await (
    await gridSheet(rows3, { title: 'Procedural sprites, 3x', labelSize: 12 })
  ).png(join(OUT, 'lineup_3x.png'));
  log('lineup');
}

// ------------------------------------------------------------ 3. compare ----
if (want('compare')) {
  const rows = [];
  for (const faction of ['player', 'enemy']) {
    const cur = [],
      neu = [];
    for (const cls of ALL) {
      if (faction === 'enemy' && cls.startsWith('lord_')) continue;
      const c = await loadCurrent(cls, faction);
      cur.push({
        img: onGround(gameHalo(c.tex, Img)).scale(3),
        label: c.source.replace('rebuilt ', 'rb ').slice(0, 22),
      });
      neu.push({
        img: onGround(gameHalo(T(cls, faction), Img)).scale(3),
        label: `procedural ${short(cls)}`.slice(0, 22),
      });
    }
    rows.push({ title: `${faction}\ncurrent game`, cells: cur });
    rows.push({ title: `${faction}\nprocedural`, cells: neu });
  }
  await (
    await gridSheet(rows, {
      title:
        'Current game art (rebuilt / legacy, as the phone renderer places it) vs procedural — 3x, with the game contrast halo',
      labelSize: 10,
    })
  ).png(join(OUT, 'compare_current_3x.png'));
  log('compare');
}

// --------------------------------------------------------------- 4. phone ---
const PLAYER_ARMY = [
  'lord_edric',
  'lord_sera',
  'myrmidon',
  'knight',
  'archer',
  'cleric',
  'cavalier',
  'mage',
];
const ENEMY_ARMY = [
  ['fighter', 'enemy'],
  ['myrmidon', 'enemy'],
  ['knight', 'enemy'],
  ['archer', 'enemy'],
  ['mage', 'corrupted'],
  ['cavalier', 'enemy'],
  ['mercenary', 'enemy'],
  ['pegasus_knight', 'enemy'],
];
function placeArmy(board, crop) {
  const [c0, r0, cols, rows] = crop;
  const inCrop = ({ col, row }) => col >= c0 && col < c0 + cols && row >= r0 && row < r0 + rows;
  const used = new Set();
  const take = (list) =>
    list
      .filter(inCrop)
      .filter((p) => !used.has(`${p.col},${p.row}`) && used.add(`${p.col},${p.row}`));
  const open = openCells(board.map, c0, r0, cols, rows).map(([col, row]) => ({ col, row }));
  let ps = take(board.map.playerSpawns);
  let es = take(board.map.enemySpawns);
  const mid = c0 + cols / 2;
  const fill = (arr, n, left) => {
    for (const p of open
      .filter((p) => (left ? p.col < mid : p.col >= mid))
      .sort((a, b) => ((a.col * 7 + a.row * 13) % 11) - ((b.col * 7 + b.row * 13) % 11))) {
      if (arr.length >= n) break;
      const k = `${p.col},${p.row}`;
      if (used.has(k)) continue;
      if (
        [...used].some((u) => {
          const [a, b] = u.split(',').map(Number);
          return Math.abs(a - p.col) + Math.abs(b - p.row) < 2;
        })
      )
        continue;
      used.add(k);
      arr.push(p);
    }
  };
  fill(ps, 6, true);
  fill(es, 6, false);
  return { ps: ps.slice(0, 6), es: es.slice(0, 6) };
}
async function phoneScene(mapKey, kind, which, crop, opts = {}) {
  const board = await loadBoard(mapKey, kind);
  const { ps, es } = placeArmy(board, crop);
  const units = [];
  for (let i = 0; i < ps.length; i++) {
    const cls = PLAYER_ARMY[i];
    const t =
      which === 'current'
        ? (await loadCurrent(cls, 'player')).tex
        : which === 'hybrid' && cls.startsWith('lord_')
          ? await treatedRebuilt(cls)
          : T(cls, 'player');
    units.push({ ...ps[i], tex: t, faction: 'player', acted: i === 3, hp: 1 - (i % 3) * 0.2 });
  }
  for (let i = 0; i < es.length; i++) {
    const [cls, f] = ENEMY_ARMY[i];
    const t = which === 'current' ? (await loadCurrent(cls, 'enemy')).tex : T(cls, f);
    units.push({ ...es[i], tex: t, faction: 'enemy', hp: 0.6 + (i % 2) * 0.4 });
  }
  return stage(board, crop, units, opts);
}
if (want('phone')) {
  for (const s of STUDY_MAPS) {
    const crop = [s.crop[0], s.crop[1], 16, 10];
    for (const kind of ['procedural', 'weathered']) {
      const cur = await phoneScene(s.key, kind, 'current', crop);
      const neu = await phoneScene(s.key, kind, 'procedural', crop);
      const hyb = await phoneScene(s.key, kind, 'hybrid', crop);
      const L = await caption(cur, `A · current game sprites · ${s.key} · ${kind} · 34px/cell`);
      const M = await caption(neu, `B · all procedural (same positions)`);
      const R = await caption(hyb, `C · hybrid: treated rebuilt lords + procedural`);
      await hcat([L, M, R], 10).png(join(OUT, `phone_${s.key}_${kind}.png`));
    }
    log('phone', s.key);
  }
  // 3x-DPR device-pixel crops (what a Retina phone actually lights up)
  for (const key of ['river', 'mire']) {
    const s = STUDY_MAPS.find((m) => m.key === key);
    const crop = [s.crop[0], s.crop[1], 16, 10];
    for (const which of ['current', 'procedural', 'hybrid']) {
      const img = await phoneScene(key, 'procedural', which, crop, { scale: 102, nearest: true });
      await img.crop(0, 0, 8 * 102, 5 * 102).png(join(OUT, `device3x_${key}_${which}.png`));
    }
  }
}

// ------------------------------------------------------------- 5. checks ----
async function groundPatch(mapKey, name, kind = 'procedural') {
  const board = await loadBoard(mapKey, kind);
  const { names } = board.map;
  for (let r = 0; r < names.length - 1; r++)
    for (let c = 0; c < names[0].length - 1; c++)
      if (
        [names[r][c], names[r][c + 1], names[r + 1][c], names[r + 1][c + 1]].every(
          (n) => n === name,
        )
      )
        return board.img.crop(c * 48 + 12, r * 48 + 12, 72, 72).resizeArea(48, 48);
  return new Img(48, 48, MEADOW);
}
if (want('checks')) {
  const grounds = {
    plain: await groundPatch('river', 'Plain'),
    forest: await groundPatch('river', 'Forest'),
    swamp: await groundPatch('mire', 'Swamp'),
    floor: await groundPatch('castle', 'Floor'),
    snow: await groundPatch('frozen', 'Plain'),
    lava: await groundPatch('caldera', 'Plain'),
  };
  const put = (g, t) => {
    const o = Img.from(48, 48, g.d);
    return o.draw(gameHalo(t, Img).crop(8, 0, 48, 48), 0, 0);
  };
  for (const faction of ['player', 'enemy']) {
    const rows = [];
    for (const cls of ALL) {
      if (faction === 'enemy' && cls.startsWith('lord_')) continue;
      const t = T(cls, faction);
      const cells = [
        ...Object.entries(grounds).map(([k, g]) => ({
          img: put(g, t).scale(2),
          label: rows.length ? '' : k,
        })),
        {
          img: put(grounds.plain, t).map(grayscale).scale(2),
          label: rows.length ? '' : 'gray/plain',
        },
        {
          img: put(grounds.swamp, t).map(grayscale).scale(2),
          label: rows.length ? '' : 'gray/swamp',
        },
        {
          img: onGround(t.map(silhouette), [200, 196, 186, 255]).scale(2),
          label: rows.length ? '' : 'silhouette',
        },
        { img: put(grounds.plain, t.map(acted)).scale(2), label: rows.length ? '' : 'acted 0xb8' },
        {
          img: put(grounds.plain, t).map(deutan).scale(2),
          label: rows.length ? '' : 'deuteranopia',
        },
      ];
      rows.push({ title: short(cls), cells });
    }
    await (
      await gridSheet(rows, {
        title: `Readability checks — ${faction} (2x; ground patches from the procedural terrain renders)`,
        labelSize: 10,
      })
    ).png(join(OUT, `checks_${faction}.png`));
  }
  log('checks');
}

// --------------------------------------------------------- 6. sword test ----
if (want('sword')) {
  // Deterministic shuffle; the key is written to sword_test_key.txt.
  const order = [
    ['thief', 'player'],
    ['myrmidon', 'enemy'],
    ['mercenary', 'player'],
    ['myrmidon', 'player'],
    ['thief', 'enemy'],
    ['mercenary', 'enemy'],
  ];
  const board = await loadBoard('river', 'procedural');
  const cells = [];
  const sil = [];
  for (let i = 0; i < order.length; i++) {
    const [cls, f] = order[i];
    const t = T(cls, f, { seed: 40 + i });
    const scene = stage(
      board,
      [2, 5, 3, 3],
      [{ col: 3, row: 6, tex: t, faction: f === 'player' ? 'player' : 'enemy' }],
    );
    cells.push({ img: scene.scale(2), label: `#${i + 1}` });
    sil.push({
      img: onGround(t.map(silhouette), [200, 196, 186, 255]).scale(3),
      label: `#${i + 1}`,
    });
  }
  await (
    await gridSheet(
      [
        { title: 'phone scale\n(34px/cell, 2x)', cells },
        { title: 'silhouette 3x', cells: sil },
      ],
      {
        title:
          'Name the three sword classes (Myrmidon / Mercenary / Thief) — no labels. Key: sword_test_key.txt',
        labelSize: 12,
      },
    )
  ).png(join(OUT, 'sword_test.png'));
  writeFileSync(
    join(OUT, 'sword_test_key.txt'),
    order.map(([c, f], i) => `#${i + 1}: ${c} (${f})`).join('\n') + '\n',
  );
  log('sword');
}

// ------------------------------------------------ 7. recruits + promotion ---
if (want('recruits')) {
  const names = ['Soren', 'Kael', 'Hana', 'Zephyr', 'Riven', 'Yara'];
  const runSeed = 20260924;
  const base = [],
    promo = [],
    phone = [];
  const board = await loadBoard('river', 'procedural');
  for (let i = 0; i < 6; i++) {
    const seed = hashString(`${runSeed}:recruit:${i}`);
    const id = rollIdentity(seed, 'myrmidon');
    const b = tex({ cls: 'myrmidon', faction: 'player', seed, id });
    const p = tex({ cls: 'swordmaster', faction: 'player', seed, id });
    const desc = `${names[i]} · ${id.hair}/${id.hairRamp.replace('hair', '')}\n${id.skin.replace('skin', '')} · ${id.headgear} · ${id.face}`;
    base.push({ img: onGround(b).scale(3), label: desc });
    promo.push({ img: onGround(p).scale(3), label: `${names[i]} → Swordmaster` });
    phone.push({ tex: b, faction: 'player' });
  }
  // six fighters from the same run, to show a second family's rules
  const fighters = [];
  for (let i = 0; i < 6; i++) {
    const seed = hashString(`${runSeed}:fighter:${i}`);
    const id = rollIdentity(seed, 'fighter');
    fighters.push({
      img: onGround(tex({ cls: 'fighter', faction: 'player', seed, id })).scale(3),
      label: `${id.hair}/${id.hairRamp.replace('hair', '')} ${id.beard}`,
    });
  }
  const enemies = [];
  for (let i = 0; i < 6; i++)
    enemies.push({
      img: onGround(T('myrmidon', 'enemy', { seed: 100 + i })).scale(3),
      label: `enemy seed ${100 + i}`,
    });
  await (
    await gridSheet(
      [
        { title: 'Myrmidon recruits\n(seeded identity)', cells: base },
        { title: 'same seeds,\npromoted', cells: promo },
        { title: 'Fighter recruits', cells: fighters },
        { title: 'enemy Myrmidons\n(issue kit)', cells: enemies },
      ],
      {
        title:
          'Identity from the appearance seed: six recruits of one class, their promotions, and why enemies do not roll (3x)',
        labelSize: 10,
      },
    )
  ).png(join(OUT, 'recruits_3x.png'));
  // phone-scale: the six side by side on terrain
  // two rows of three on open ground, one cell apart
  const crop = [1, 1, 8, 5];
  const open = openCells(board.map, ...crop);
  const picked = [];
  for (const [c, r] of open) {
    if (picked.length >= 6) break;
    if (picked.some(([pc, pr]) => Math.abs(pc - c) < 2 && Math.abs(pr - r) < 2)) continue;
    if (board.map.names[r][c] !== 'Plain' || r === crop[1]) continue;
    picked.push([c, r]);
  }
  const sc = stage(
    board,
    crop,
    phone.map((u, i) => ({ ...u, col: picked[i][0], row: picked[i][1] })),
  );
  await sc.png(join(OUT, 'recruits_phone.png'));
  log('recruits');
}

// -------------------------------------------------------------- 8. anim -----
if (want('anim')) {
  const rows = [];
  for (const [cls, f] of [
    ['lord_edric', 'player'],
    ['myrmidon', 'player'],
    ['knight', 'enemy'],
    ['archer', 'player'],
    ['mage', 'corrupted'],
    ['cavalier', 'player'],
    ['pegasus_knight', 'enemy'],
  ]) {
    const u = unitOf(cls, f);
    const idle = [0, 1, 2, 3].map((frame) => tex({ ...u, pose: 'idle', frame }));
    const w = tex({ ...u, pose: 'windup' });
    const s = tex({ ...u, pose: 'strike' });
    const flash = Img.from(64, 64, hitFlash(idle[0].d));
    rows.push({
      title: `${short(cls)} ${f}`,
      cells: [...idle, w, s, flash].map((t, k) => ({
        img: onGround(t, MEADOW, [4, 0, 56, 48]).scale(3),
        label: rows.length
          ? ''
          : ['idle 0', 'idle 1', 'idle 2', 'idle 3', 'windup', 'strike', 'hit flash'][k],
      })),
    });
    const seq = [...idle, idle[0], w, s, s, idle[0]].map((t) =>
      onGround(gameHalo(t, Img), MEADOW, [4, 0, 56, 48]).scale(3),
    );
    await writeGif(
      join(OUT, 'anim', `${cls}_${f}.gif`),
      seq,
      [220, 220, 220, 220, 300, 140, 200, 200, 300],
    );
  }
  await (
    await gridSheet(rows, {
      title:
        'Procedural animation: 4-frame idle (breath + cloth sway), windup / strike (lunge), hit flash — 3x',
      labelSize: 11,
    })
  ).png(join(OUT, 'anim_3x.png'));
  log('anim');
}

// ------------------------------------------------------------ 9. derived ----
if (want('derived')) {
  const sets = [
    {
      key: 'lord_edric',
      cand: {
        main: 'teal',
        hair: 'hairBrown',
        skin: 'skinWarm',
        leather: 'leather',
        sub: 'umber',
        metal: 'bladeP',
        trim: 'gold',
      },
    },
    {
      key: 'lord_sera',
      cand: {
        main: 'plum',
        hair: 'hairAuburn',
        skin: 'skinFair',
        linen: 'bone',
        leather: 'leather',
        sub: 'charcoal',
        trim: 'gold',
      },
    },
    {
      key: 'enemy_myrmidon',
      cand: {
        main: 'lacquer',
        hair: 'hairBlack',
        skin: 'skinWarm',
        leather: 'leather',
        sub: 'charcoal',
        metal: 'bladeE',
        linen: 'linen',
      },
    },
  ];
  const rows = [];
  for (const s of sets) {
    const src = await loadRebuilt(s.key);
    const f = derive(src, s.cand);
    const R = (alias, o = {}) =>
      Img.from(64, 64, resolve(f, { ...s.cand, ...alias }, { outline: null, ...o }));
    const player = R({
      main: s.key === 'enemy_myrmidon' ? 'steelCloth' : s.cand.main,
      metal: 'bladeP',
    });
    const enemy = R({ main: 'lacquer', metal: 'bladeE', trim: 'ironTrim' });
    const corrupt = Img.from(
      64,
      64,
      splitImage(
        resolve(
          f,
          { ...s.cand, main: 'lacquer', metal: 'bladeE', trim: 'ironTrim' },
          { outline: null, grade: unlightGrade() },
        ),
        64,
        64,
        5,
      ),
    );
    // generic breath on finished art: everything above the waist drops a pixel
    const b = src.alphaBounds();
    const waist = Math.round(b.y0 + b.height * 0.55);
    const breath = new Img(64, 64);
    breath.draw(player.crop(0, waist, 64, 64 - waist), 0, waist);
    breath.draw(player.crop(0, 0, 64, waist), 0, 1);
    const calmed = Img.from(
      64,
      64,
      resolve(derive(src, s.cand, { calm: 2 }), s.cand, { outline: null }),
    );
    rows.push({
      title: s.key,
      cells: [src, R({}), calmed, player, enemy, corrupt, breath].map((t, k) => ({
        img: onGround(t).scale(3),
        label: rows.length
          ? ''
          : [
              'rebuilt (as shipped)',
              'quantized to ramps',
              'calmed (2 passes)',
              'player treatment',
              'enemy / lacquer swap',
              'corrupted (unlight)',
              'idle breath frame',
            ][k],
      })),
    });
  }
  await (
    await gridSheet(rows, {
      title:
        'Approach (b): procedural treatment of finished art — the rebuilt sprites indexed into the lab ramps (3x)',
      labelSize: 11,
    })
  ).png(join(OUT, 'derived_3x.png'));
  log('derived');
}

// ------------------------------------------------------------- 10. states ---
if (want('states')) {
  const board = await loadBoard('river', 'procedural');
  const rows = [];
  for (const [cls, f] of [
    ['lord_edric', 'player'],
    ['archer', 'player'],
    ['fighter', 'enemy'],
    ['knight', 'corrupted'],
  ]) {
    const t = T(cls, f);
    const fac = f === 'player' ? 'player' : 'enemy';
    const one = (u) =>
      stage(board, [2, 5, 3, 3], [{ col: 3, row: 6, faction: fac, ...u }]).scale(2);
    const flash = Img.from(64, 64, hitFlash(t.d));
    rows.push({
      title: `${short(cls)} ${f}`,
      cells: [
        { img: one({ tex: t }), label: rows.length ? '' : 'ready' },
        { img: one({ tex: t, acted: true }), label: rows.length ? '' : 'acted today (x0xb8)' },
        {
          img: one({ tex: T(cls, f, { render: { acted: true } }) }),
          label: rows.length ? '' : 'acted: palette op',
        },
        { img: one({ tex: flash }), label: rows.length ? '' : 'hit flash' },
        { img: one({ tex: T(cls, f, { pose: 'strike' }) }), label: rows.length ? '' : 'strike' },
      ],
    });
  }
  await (
    await gridSheet(rows, {
      title:
        'States on terrain at phone scale (2x): ready / acted (current multiply tint vs proposed palette op) / hit flash / strike',
      labelSize: 11,
    })
  ).png(join(OUT, 'states_2x.png'));
  log('states');
}
