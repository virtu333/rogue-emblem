// itemGrammar — maps game data to icon specs (the "Forged in code" direction).
//
// One rule set covers the whole catalog, so a new item in data/*.json gets an
// icon without an artist:
//   silhouette  = family (sword, lance, axe, bow, tome, staff, scroll, vial, ring...)
//   metal       = tier (Iron dull grey, Steel cold blue, Silver bright, Legend gilt +
//                 ember core, Rare/enemy blackened with a violet glint)
//   accent      = what it does (STAT colour on gems/boosters/whetstones, ELEMENT
//                 colour on tomes/stones, special: crit = blood, magic = sky,
//                 poison = verdigris, drain = unlight)
//   variant     = mechanics you can see (throwable = short, brave = twin/broad,
//                 reaver = serrated, effective = broad head, long range = long bow)
// Pure data -> spec; no randomness.
import * as D from './iconDefs.mjs';
import * as X from './iconDefsExtra.mjs';
import { STAT_MATERIAL } from './palette.mjs';
import { skillGlyph, WEAPON_GLYPH } from './glyphs.mjs';

/** Lookups the grammar needs beyond the item itself (skills, weapon arts). */
export function grammarContext(data = {}) {
  const skills = Array.isArray(data.skills) ? data.skills : data.skills?.skills || [];
  const arts = data.weaponArts?.arts || (Array.isArray(data.weaponArts) ? data.weaponArts : []);
  return {
    skill: (id) => skills.find((s) => s.id === id) || (id ? { id } : null),
    art: (id) => arts.find((a) => a.id === id) || null,
  };
}

const TIER = {
  Iron: { metal: 'iron', fit: 'ironFit', wood: 'wood' },
  Steel: { metal: 'steel', fit: 'steelFit', wood: 'darkWood' },
  Silver: { metal: 'silver', fit: 'silverFit', wood: 'darkWood' },
  Legend: { metal: 'legendBlade', fit: 'gilt', wood: 'darkWood' },
  Rare: { metal: 'blackened', fit: 'blackened', wood: 'ink' },
};

function special(w) {
  const s = `${w.special || ''} ${w.name}`.toLowerCase();
  return {
    crit: /critical|killer|killing/.test(s),
    throw: /throwable/.test(s),
    brave: /attacks twice/.test(s),
    reaver: /reverses weapon triangle/.test(s),
    effective: /effective vs|slayer/.test(s),
    magic: /magic sword|levin/.test(s),
    poison: /poison|venin|toxic/.test(s),
    drain: /drain|soulreaver|eldritch/.test(s),
    sunder: /halves target def|sunder/.test(s),
    long: /extended range|longbow|starfall/.test(s),
    short: /close-range/.test(s),
  };
}

function accentFor(sp, tier) {
  if (sp.drain) return 'unlight';
  if (sp.poison) return 'verdigris';
  if (sp.magic) return 'sky';
  if (sp.crit) return 'blood';
  if (sp.sunder) return 'rose';
  if (sp.effective) return 'leaf';
  if (tier === 'Legend') return 'ember';
  return null;
}

const TOME_ELEMENT = {
  Fire: 'fire',
  Elfire: 'fire',
  Bolganone: 'fire',
  Witchfire: 'fire',
  Excalibur: 'wind',
  Bolting: 'thunder',
  'Twisting Vortex': 'dark',
};
const ELEMENT_COVER = {
  fire: 'blood',
  wind: 'verdigris',
  thunder: 'sky',
  dark: 'unlight',
  light: 'parchment',
};
const ELEMENT_EMBLEM = {
  fire: 'ember',
  wind: 'leaf',
  thunder: 'pearl',
  dark: 'lilac',
  light: 'gilt',
};

/**
 * A tome whose emblem survives 16px: below 21px the corner fittings drop out and the
 * emblem is redrawn 1.5x larger in its brightest level (the study's emblem was lost).
 */
export function tomeSpec(
  el,
  fit,
  cover = ELEMENT_COVER[el],
  emblemMat = ELEMENT_EMBLEM[el],
  pages = 'parchment',
) {
  const spec = D.tome({ cover, fit, emblem: el, emblemMat, pages });
  const [page, face, spine, ...rest] = spec.parts;
  const fits = rest.slice(0, 2).map((p) => ({ ...p, minSize: 21 }));
  const emblem = rest.slice(2);
  const k = 1.5;
  const [cx, cy] = [16.2, 15.2];
  const bold = transformSpec({ parts: emblem }, k, cx * (1 - k), cy * (1 - k)).parts.map((p) => ({
    ...p,
    maxSize: 20,
    shade: 'flat',
    level: 3,
    spec: false,
  }));
  return {
    ...spec,
    parts: [page, face, spine, ...fits, ...emblem.map((p) => ({ ...p, minSize: 21 })), ...bold],
  };
}

export function lightSpec(fit, crit) {
  return tomeSpec('light', fit, 'parchment', crit ? 'blood' : 'gilt', 'pearl');
}

export function weaponSpec(w, ctx = grammarContext()) {
  const tier = TIER[w.tier] ? w.tier : 'Iron';
  const t = TIER[tier];
  const sp = special(w);
  const acc = accentFor(sp, tier);
  switch (w.type) {
    case 'Sword': {
      const variant = sp.brave
        ? 'twin'
        : /rapier/i.test(w.name)
          ? 'rapier'
          : sp.throw
            ? 'short'
            : sp.reaver
              ? 'serrated'
              : /wo dao|killing/i.test(w.name)
                ? 'curved'
                : 'broad';
      const blade = sp.drain && tier !== 'Legend' ? 'blackened' : t.metal;
      return D.sword({
        blade,
        fit: t.fit,
        grip:
          tier === 'Legend'
            ? 'blood'
            : tier === 'Rare'
              ? 'unlight'
              : tier === 'Silver'
                ? 'cloth'
                : 'cord',
        gem: sp.crit || sp.effective ? acc : tier === 'Legend' ? 'blood' : null,
        core:
          sp.magic || sp.poison || sp.drain || sp.sunder || tier === 'Legend'
            ? acc || 'ember'
            : null,
        variant,
      });
    }
    case 'Lance':
      return D.lance({
        head: t.metal,
        fit: t.fit,
        shaft: t.wood === 'ink' ? 'darkWood' : t.wood,
        tassel: acc || (sp.brave ? 'gilt' : null),
        variant: sp.throw
          ? 'javelin'
          : sp.crit || sp.reaver
            ? 'barbed'
            : sp.brave || sp.effective || tier === 'Legend'
              ? 'broad'
              : 'leaf',
      });
    case 'Axe':
      return D.axe({
        head: t.metal,
        fit: t.fit,
        haft: t.wood === 'ink' ? 'darkWood' : t.wood,
        gem: acc && !sp.effective ? acc : null,
        variant: /hammer/i.test(w.name)
          ? 'hammer'
          : sp.throw
            ? 'hand'
            : sp.brave || sp.reaver
              ? 'double'
              : tier === 'Legend'
                ? 'great'
                : 'bearded',
      });
    case 'Bow':
      return D.bow({
        limb:
          tier === 'Silver'
            ? 'silver'
            : tier === 'Legend'
              ? 'gilt'
              : tier === 'Rare'
                ? 'blackened'
                : tier === 'Steel'
                  ? 'darkWood'
                  : 'wood',
        fit: acc || t.fit,
        size: sp.long ? 1.12 : sp.short ? 0.82 : 1,
        recurve: sp.short || sp.brave || /double/i.test(w.name),
      });
    case 'Tome':
      return tomeSpec(TOME_ELEMENT[w.name] || 'fire', t.fit);
    case 'Light':
      return lightSpec(t.fit, sp.crit);
    case 'Staff': {
      const n = w.name.toLowerCase();
      if (/sleep|silence/.test(n))
        return D.staff({ rod: 'darkWood', fit: 'blackened', gem: 'unlight', variant: 'crescent' });
      if (/rescue|warp/.test(n))
        return D.staff({
          rod: 'darkWood',
          fit: t.fit === 'blackened' ? 'gilt' : t.fit,
          gem: 'sky',
          variant: 'wing',
        });
      if (/restore/.test(n)) return D.staff({ fit: t.fit, gem: 'pearl', variant: 'crescent' });
      return D.staff({
        rod: tier === 'Iron' ? 'wood' : 'darkWood',
        fit: tier === 'Iron' ? 'bronze' : t.fit,
        gem: 'verdigris',
      });
    }
    case 'Breath':
      return D.stoneGem({
        mat: sp.poison ? 'verdigris' : /ancient/i.test(w.name) ? 'unlight' : 'blood',
        fit: t.fit,
      });
    case 'Scroll':
      return scrollSpec(w, ctx);
    default:
      return D.sword();
  }
}

const BOOSTER = {
  STR: () => D.gemItem({ mat: 'blood', cut: 'drop' }),
  MAG: () => D.pouch({ cloth: 'unlight', sparkle: 'lilac' }),
  SKL: () =>
    D.tome({ cover: 'pearl', fit: 'gilt', emblem: 'dark', emblemMat: 'ink', pages: 'parchment' }),
  SPD: () => D.feather({ mat: 'sky' }),
  DEF: () => D.shield({ face: 'steel', rim: 'silverFit', emblem: 'diamond', emblemMat: 'sky' }),
  RES: () => D.pendant({ chain: 'silverFit', body: 'silver', gem: 'lilac', form: 'leaf' }),
  HP: () => D.robe({ cloth: 'verdigris', trim: 'gilt' }),
  MOV: () => D.boot({ leather: 'wood', trim: 'leaf', wing: true }),
};

export function consumableSpec(c) {
  switch (c.effect) {
    case 'heal':
      return D.vial({ liquid: 'verdigris' });
    case 'healFull':
      return D.vial({ shape: 'flask', liquid: 'ember', cork: 'gilt' });
    case 'promote':
      return D.seal({ wax: 'blood', ribbon: 'cloth', metal: 'gilt', glyph: 'star' });
    case 'reclass':
      return D.seal({
        wax: c.subEffect === 'mounted' ? 'earth' : 'steel',
        ribbon: 'cloth',
        metal: 'silver',
        glyph: c.subEffect === 'mounted' ? 'horseshoe' : 'boot',
      });
    case 'statBoost':
      return (BOOSTER[c.stat] || BOOSTER.STR)();
    case 'cure':
      return D.herb();
    case 'cureHeal':
      return D.vial({ shape: 'tin', glass: 'silver', cork: 'silverFit', liquid: 'blood' });
    default:
      return D.vial();
  }
}

const RING_STAT = {
  STR: 'blood',
  MAG: 'unlight',
  SPD: 'sky',
  DEF: 'steel',
  RES: 'lilac',
  SKL: 'pearl',
};

export function accessorySpec(a) {
  const n = a.name;
  const stats = a.effects || a.stats || {};
  const keys = Object.keys(stats);
  if (/ Ring$/.test(n)) {
    if (keys.length === 1 && RING_STAT[keys[0]])
      return D.ringItem({ band: 'gilt', gem: RING_STAT[keys[0]] });
    if (/Pursuit/.test(n)) return D.ringItem({ band: 'silver', gem: 'sky', cut: 'marquise' });
    if (/Nullify/.test(n)) return D.ringItem({ band: 'silver', gem: 'slate', cut: 'square' });
    if (/Life/.test(n)) return D.ringItem({ band: 'gilt', gem: 'verdigris', cut: 'marquise' });
    return D.ringItem({ band: 'silver', gem: 'pearl' });
  }
  const table = {
    'Goddess Icon': () => D.pendant({ form: 'wing', gem: 'rose' }),
    'Seraph Robe': () => D.robe({ cloth: 'pearl', trim: 'verdigris' }),
    Boots: () => D.boot({ leather: 'wood', trim: 'leaf' }),
    'Delphi Shield': () =>
      D.shield({ face: 'lilac', rim: 'gilt', emblem: 'diamond', emblemMat: 'pearl' }),
    "Veteran's Crest": () =>
      D.medal({
        ribbon: 'steel',
        disc: 'bronze',
        glyph: 'star',
        glyphMat: 'gilt',
        shape: 'shield',
      }),
    'Wrath Band': () => D.band({ metal: 'blackened', inlay: 'blood' }),
    'Counter Seal': () =>
      D.medal({ ribbon: 'slate', disc: 'silver', glyph: 'cross', glyphMat: 'steel' }),
    'Forest Charm': () =>
      D.pendant({ form: 'leaf', body: 'leaf', chain: 'wood', gem: 'verdigris' }),
    'Blood Gem': () => D.gemItem({ mat: 'blood', cut: 'gem', fit: 'gilt' }),
    "Vampire's Bloodshard": () => D.gemItem({ mat: 'blood', cut: 'shard' }),
    'Soothing Stone': () => D.gemItem({ mat: 'verdigris', cut: 'drop' }),
    'Phoenix Brooch': () => D.pendant({ form: 'wing', body: 'ember', gem: 'blood', chain: 'gilt' }),
    'Recoil Guard': () =>
      D.shield({ face: 'blood', rim: 'silverFit', emblem: 'cross', emblemMat: 'silver' }),
    "Bounty Hunter's Mark": () =>
      D.medal({
        ribbon: 'blood',
        disc: 'bronze',
        glyph: 'eye',
        glyphMat: 'blood',
        shape: 'diamond',
      }),
    'Moontide Amulet': () => D.pendant({ form: 'moon', body: 'silver', chain: 'silverFit' }),
    "Gambler's Coin": () => D.coin({ face: 'gilt', back: 'unlight' }),
    'Vanguard Crest': () =>
      D.medal({
        ribbon: 'blood',
        disc: 'silver',
        glyph: 'star',
        glyphMat: 'blood',
        shape: 'shield',
      }),
    'Diamond Medallion': () =>
      D.medal({
        ribbon: 'steel',
        disc: 'silver',
        glyph: 'diamond',
        glyphMat: 'sky',
        shape: 'diamond',
      }),
    "Hunter's Cloak": () => D.cloak({ cloth: 'verdigris', clasp: 'bronze' }),
    "Duelist's Glove": () => D.glove({ leather: 'blood', cuff: 'gilt' }),
    'Warding Charm': () =>
      D.pendant({ form: 'oval', body: 'silver', gem: 'lilac', chain: 'silverFit' }),
    "Mentor's Band": () => D.band({ metal: 'gilt', inlay: 'pearl' }),
    'Mercury Sandals': () => D.boot({ leather: 'silver', trim: 'sky', wing: true }),
    'Phalanx Band': () => D.band({ metal: 'steel', inlay: 'sky' }),
  };
  return (table[n] || (() => D.pendant()))();
}

const WHET = {
  choice: ['pearl', true],
  might: ['blood'],
  crit: ['ember'],
  hit: ['pearl'],
  weight: ['sky'],
};
export function whetstoneSpec(w) {
  const [streak, silver] = WHET[w.forgeStat] || ['blood'];
  return D.whetstone({ streak, silver: !!silver });
}

const IMBUE_MAT = {
  vampiric: 'blood',
  armorbane: 'steel',
  keen: 'ember',
  venom: 'verdigris',
  binding: 'earth',
  warded: 'lilac',
};
export function imbueStoneSpec(imbue) {
  if (!imbue) return D.crystal({ prismatic: ['blood', 'sky', 'verdigris', 'lilac'] });
  return D.crystal({ mat: IMBUE_MAT[imbue.id] || 'pearl' });
}

// ── Spec transforms (for badges and haloes) ──────────────────────────────

function tShape(sh, k, dx, dy) {
  const P = ([x, y]) => [x * k + dx, y * k + dy];
  switch (sh.kind) {
    case 'poly':
      return { ...sh, pts: sh.pts.map(P) };
    case 'capsule':
      return { ...sh, a: P(sh.a), b: P(sh.b), r: sh.r * k };
    case 'rect':
      return { ...sh, x: sh.x * k + dx, y: sh.y * k + dy, w: sh.w * k, h: sh.h * k };
    case 'ring':
      return { ...sh, cx: sh.cx * k + dx, cy: sh.cy * k + dy, r0: sh.r0 * k, r1: sh.r1 * k };
    case 'arc':
      return { ...sh, cx: sh.cx * k + dx, cy: sh.cy * k + dy, r: sh.r * k, w: sh.w * k };
    case 'ellipse':
      return { ...sh, cx: sh.cx * k + dx, cy: sh.cy * k + dy, rx: sh.rx * k, ry: sh.ry * k };
    default:
      return { ...sh, cx: sh.cx * k + dx, cy: sh.cy * k + dy, r: sh.r * k };
  }
}

export function transformSpec(spec, k, dx = 0, dy = 0) {
  const P = (p) => (p ? [p[0] * k + dx, p[1] * k + dy] : p);
  return {
    ...spec,
    parts: spec.parts.map((p) => ({
      ...p,
      shape: tShape(p.shape, k, dx, dy),
      holes: p.holes?.map((h) => tShape(h, k, dx, dy)),
      centre: P(p.centre),
      spine0: P(p.spine0),
      halfWidth: p.halfWidth != null ? p.halfWidth * k : p.halfWidth,
      domeDepth: p.domeDepth != null ? p.domeDepth * k : p.domeDepth,
    })),
    glints: spec.glints?.map((g) =>
      Object.assign([g[0] * k + dx, g[1] * k + dy], { minSize: g.minSize }),
    ),
  };
}

/** Overlay a small badge (design space bottom-right) — growth arrow, plus, lock. */
export function withBadge(spec, kind, mat = 'ember') {
  const base = transformSpec(spec, 0.86, 0, 0);
  const parts = [...base.parts];
  if (kind === 'growth')
    parts.push({
      shape: {
        kind: 'poly',
        pts: [
          [25, 19.5],
          [31, 25.5],
          [27.6, 25.5],
          [27.6, 31],
          [22.4, 31],
          [22.4, 25.5],
          [19, 25.5],
        ],
      },
      mat,
      shade: 'bevel',
      bevel: 0.6,
      sep: true,
      spec: 1,
      emissive: true,
    });
  else if (kind === 'plus')
    parts.push({
      shape: {
        kind: 'poly',
        pts: [
          [23.4, 19.5],
          [26.6, 19.5],
          [26.6, 23.4],
          [30.5, 23.4],
          [30.5, 26.6],
          [26.6, 26.6],
          [26.6, 30.5],
          [23.4, 30.5],
          [23.4, 26.6],
          [19.5, 26.6],
          [19.5, 23.4],
          [23.4, 23.4],
        ],
      },
      mat,
      shade: 'bevel',
      bevel: 0.6,
      sep: true,
      spec: 1,
      emissive: true,
    });
  return { ...base, parts };
}

/** A boon seen through the Hollow Sun: item icon inside a corona (blessings). */
export function haloed(spec, tier = 1) {
  const halo = D.hollowSun({
    corona: tier >= 4 ? 'ember' : tier >= 3 ? 'gilt' : tier >= 2 ? 'bronze' : 'silver',
    core: 'ink',
  });
  // Corona rays only where there is room for them; small sizes keep the ring.
  const rays = halo.parts.slice(0, 12).map((p) => ({ ...p, minSize: 40 }));
  const disc = halo.parts.slice(12);
  const inner = transformSpec(spec, 0.7, 4.8, 4.8);
  return { parts: [...rays, ...disc, ...inner.parts], shadow: false, glints: inner.glints };
}

// ── Scrolls ──────────────────────────────────────────────────────────────

/**
 * Scrolls carry their sign on the wax seal: a skill scroll shows the skill's glyph on
 * violet cord (skills), a weapon-art scroll the weapon family's glyph on ember cord.
 */
export function scrollSpec(w, ctx = grammarContext()) {
  if (w.teachesWeaponArtId) {
    const art = ctx.art(w.teachesWeaponArtId);
    const type = art?.weaponType || String(w.teachesWeaponArtId).split('_')[0];
    const key = type === 'magic' ? 'Tome' : type.charAt(0).toUpperCase() + type.slice(1);
    return X.sealedScroll({
      cord: 'ember',
      wax: 'blood',
      glyphKind: WEAPON_GLYPH[key] || 'sword',
      glyphMat: 'gilt',
    });
  }
  const [glyphKind, glyphMat] = skillGlyph(ctx.skill(w.skillId));
  return X.sealedScroll({
    cord: 'unlight',
    wax: 'unlight',
    glyphKind,
    glyphMat: ['unlight', 'lilac', 'slate', 'earth'].includes(glyphMat) ? 'pearl' : glyphMat,
  });
}

export function goldSpec() {
  return D.goldPile();
}

/** Fallbacks for items the data does not list (renamed, modded, future types). */
export function genericSpecs() {
  return [
    { key: 'sword', name: 'Sword', socket: 'weapon', spec: D.sword() },
    { key: 'lance', name: 'Lance', socket: 'weapon', spec: D.lance() },
    { key: 'axe', name: 'Axe', socket: 'weapon', spec: D.axe() },
    { key: 'bow', name: 'Bow', socket: 'weapon', spec: D.bow() },
    { key: 'tome', name: 'Tome', socket: 'weapon', spec: tomeSpec('fire', 'ironFit') },
    { key: 'light', name: 'Light', socket: 'weapon', spec: lightSpec('ironFit', false) },
    { key: 'staff', name: 'Staff', socket: 'weapon', spec: D.staff() },
    { key: 'breath', name: 'Breath', socket: 'weapon', spec: D.stoneGem({ fit: 'ironFit' }) },
    {
      key: 'skill-scroll',
      name: 'Skill scroll',
      socket: 'scroll',
      rim: 'Rare',
      spec: X.sealedScroll({
        cord: 'unlight',
        wax: 'unlight',
        glyphKind: 'star',
        glyphMat: 'pearl',
      }),
    },
    {
      key: 'art-scroll',
      name: 'Weapon-art scroll',
      socket: 'scroll',
      rim: 'Rare',
      spec: X.sealedScroll({ cord: 'ember', wax: 'blood', glyphKind: 'sword', glyphMat: 'gilt' }),
    },
    { key: 'supply', name: 'Supply', socket: 'supply', spec: D.vial({ liquid: 'verdigris' }) },
    {
      key: 'accessory',
      name: 'Accessory',
      socket: 'accessory',
      spec: D.ringItem({ band: 'silver', gem: 'pearl' }),
    },
    {
      key: 'whetstone',
      name: 'Whetstone',
      socket: 'forge',
      spec: D.whetstone({ streak: 'pearl' }),
    },
    {
      key: 'imbue',
      name: 'Imbuing stone',
      socket: 'forge',
      rim: 'Rare',
      spec: D.crystal({ mat: 'pearl' }),
    },
    {
      key: 'blessing',
      name: 'Blessing',
      socket: 'blessing',
      rim: 'I',
      spec: D.hollowSun({ corona: 'gilt' }),
    },
    { key: 'upgrade', name: 'Upgrade', socket: 'upgrade', spec: D.chest() },
  ];
}

// ── Meta upgrades ────────────────────────────────────────────────────────

const STAT_FROM_ID = (id) => {
  const m = id.match(/_(hp|str|def|spd|skl|res|mag|lck)_/);
  return m ? m[1].toUpperCase() : null;
};

/**
 * Upgrades: category silhouette + stat colour + badge (plus = flat, arrow = growth).
 * Recruits wear a crested helm, lords a capped crown: the crest and the cap are big
 * enough to carry the stat colour at 16px. Skills are medallions with the skill's glyph.
 */
export function upgradeSpec(u, ctx = grammarContext()) {
  const stat = STAT_FROM_ID(`${u.id}_`);
  const growth = /growth/.test(u.id);
  const statMat = stat ? STAT_MATERIAL[stat] : null;
  const badge = (s) => (growth ? withBadge(s, 'growth') : stat ? withBadge(s, 'plus') : s);
  if (u.category === 'recruit_stats')
    return badge(X.crestHelm({ metal: 'iron', crest: statMat || 'blood' }));
  if (u.category === 'lord_bonuses') {
    if (/vision/.test(u.id)) return D.hollowSun({ corona: u.id.endsWith('3') ? 'ember' : 'gilt' });
    if (stat) return badge(X.cappedCrown({ capMat: statMat }));
    if (/heir/.test(u.id))
      return withBadge(X.cappedCrown({ capMat: 'verdigris', gem: 'blood' }), 'plus', 'leaf');
    if (/commander/.test(u.id))
      return D.banner({ cloth: 'steel', emblem: 'cross', emblemMat: 'gilt' });
    if (/partner/.test(u.id))
      return D.banner({ cloth: 'verdigris', emblem: 'star', emblemMat: 'gilt' });
    if (/legendary_lord/.test(u.id)) return X.cappedCrown({ capMat: 'unlight', gem: 'ember' });
    return X.cappedCrown({ capMat: 'unlight' });
  }
  if (u.category === 'economy') {
    const e = {
      starting_gold: () => D.chest(),
      battle_gold: () => D.goldPile(),
      starting_vulnerary: () => D.vial({ liquid: 'verdigris' }),
      loot_quality: () => D.crystal({ mat: 'gilt' }),
      studied_training: () =>
        X.sealedScroll({ cord: 'ember', wax: 'unlight', glyphKind: 'tome', glyphMat: 'gilt' }),
      trinket_collector: () => D.ringItem({ band: 'gilt', gem: 'rose' }),
      heros_call: () => X.warHorn({ horn: 'pearl', band: 'gilt' }),
      trade_contacts: () => D.pouch({ cloth: 'earth', tie: 'gilt', sparkle: 'gilt' }),
    };
    return (e[u.id] || (() => D.goldPile()))();
  }
  if (u.category === 'capacity') {
    const c = {
      deploy_limit: () => withBadge(D.banner({ cloth: 'steel', emblem: 'star' }), 'plus'),
      roster_cap: () =>
        withBadge(D.banner({ cloth: 'blood', emblem: 'cross', emblemMat: 'gilt' }), 'plus'),
      recruit_skill: () =>
        withBadge(
          X.skillMedal({ glyphKind: 'star', glyphMat: 'pearl', rim: 'steel' }),
          'plus',
          'leaf',
        ),
      recruit_field_supplies: () => withBadge(D.vial({ liquid: 'verdigris' }), 'plus', 'leaf'),
      veteran_recruits: () => withBadge(X.crestHelm({ metal: 'gilt', crest: 'blood' }), 'growth'),
      extra_starting_unit_pool: () => X.crestHelm({ metal: 'silver', crest: 'ember' }),
      lethal_armory: () =>
        D.sword({ blade: 'steel', fit: 'steelFit', grip: 'cord', gem: 'blood', variant: 'broad' }),
      lethal_armory_killer: () =>
        D.lance({
          head: 'steel',
          fit: 'steelFit',
          shaft: 'darkWood',
          tassel: 'blood',
          variant: 'barbed',
        }),
      lethal_armory_silver: () =>
        D.axe({
          head: 'silver',
          fit: 'silverFit',
          haft: 'darkWood',
          gem: 'blood',
          variant: 'bearded',
        }),
      master_of_arms: () => X.crossedBlades({ blade: 'silver', fit: 'gilt' }),
      recruit_xp: () => withBadge(X.crestHelm({ metal: 'iron', crest: 'ember' }), 'growth'),
      recruit_accessory: () =>
        withBadge(D.ringItem({ band: 'silver', gem: 'sky' }), 'plus', 'leaf'),
      recruit_weapon_forge: () => X.smithHammer({ head: 'steel', haft: 'darkWood' }),
    };
    return (c[u.id] || (() => X.crestHelm({ metal: 'gilt', crest: 'ember' })))();
  }
  if (u.category === 'starting_equipment') {
    const q = {
      weapon_forge: () => withBadge(D.anvil({ metal: 'iron' }), 'plus'),
      weapon_tier: () => D.sword({ blade: 'steel', fit: 'steelFit', grip: 'cord' }),
      weapon_tier_silver: () => D.sword({ blade: 'silver', fit: 'silverFit', grip: 'cloth' }),
      iron_arms: () => D.axe({ head: 'iron', fit: 'ironFit', haft: 'wood', variant: 'bearded' }),
      steel_arms: () =>
        D.lance({ head: 'steel', fit: 'steelFit', shaft: 'darkWood', variant: 'leaf' }),
      starting_accessory: () => D.ringItem({ band: 'gilt', gem: 'blood' }),
      staff_upgrade: () => D.staff({ fit: 'gilt', gem: 'verdigris' }),
      starting_reclass_seal: () => D.seal({ wax: 'steel', metal: 'silver', glyph: 'boot' }),
    };
    return (q[u.id] || (() => D.anvil()))();
  }
  if (u.category === 'starting_skills') {
    if (u.id === 'art_adept')
      return X.skillMedal({ glyphKind: 'sword', glyphMat: 'ember', rim: 'gilt' });
    if (u.id === 'extra_skill_slot')
      return X.skillMedal({ glyphKind: 'slot', glyphMat: 'pearl', rim: 'silver' });
    const skillId =
      (u.effects || []).map((e) => e.unlockSkill).find(Boolean) || u.id.replace(/^unlock_/, '');
    const [glyphKind, glyphMat] = skillGlyph(ctx.skill(skillId));
    return X.skillMedal({ glyphKind, glyphMat, rim: 'gilt' });
  }
  return D.chest();
}

// ── Blessings: the boon, seen through the Hollow Sun ─────────────────────

// Every boon is its own object (the study repeated tomes, banners, scrolls and anvils).
const BLESSING_BOON = {
  steady_hands: () => D.glove({ leather: 'wood', cuff: 'gilt' }),
  coin_of_fate: () => D.coin({ face: 'gilt', back: 'ember', glyph: 'star' }),
  blessed_vigor: () => X.bootPair({ leather: 'wood', trim: 'verdigris' }),
  swift_instinct: () => D.feather({ mat: 'sky' }),
  field_medic: () => X.salveJar({ clay: 'wood', salve: 'verdigris' }),
  iron_oath: () => D.shield({ face: 'steel', rim: 'ironFit' }),
  scout_blessing: () => X.lantern({ metal: 'iron', flame: 'ember' }),
  scholar_vow: () => tomeSpec('light', 'gilt', 'pearl', 'gilt'),
  rally_cry: () => X.warHorn({ horn: 'pearl', band: 'gilt' }),
  war_veteran: () => X.crestHelm({ metal: 'bronze', crest: 'ember' }),
  frugal_smith: () => X.smithHammer({ head: 'iron', haft: 'wood' }),
  arsenal_pact: () => D.sword({ blade: 'silver', fit: 'silverFit', grip: 'cloth' }),
  pilgrim_coin: () => X.shellToken({ shell: 'pearl', cord: 'wood' }),
  merchant_bane: () => D.pouch({ cloth: 'blood', tie: 'gilt', sparkle: 'gilt' }),
  nomad_pact: () => D.banner({ cloth: 'earth', emblem: 'star', emblemMat: 'gilt' }),
  terrain_mastery: () => X.oakLeaf({ mat: 'leaf', vein: 'verdigris' }),
  quartermaster_cache: () => D.vial({ shape: 'flask', liquid: 'ember', cork: 'gilt' }),
  forbidden_tome: () =>
    X.withChain(tomeSpec('dark', 'gilt', 'unlight', 'lilac'), { metal: 'iron' }),
  blood_forge: () => X.bloodAnvil(),
  war_tutelage: () => X.crossedBlades({ blade: 'silver', fit: 'gilt' }),
  armory_stash: () => D.whetstone({ streak: 'ember' }),
  scroll_archive: () =>
    X.sealedScroll({ cord: 'ember', wax: 'blood', glyphKind: 'star', glyphMat: 'gilt' }),
  focused_curriculum: () => X.hourglass({ frameMat: 'darkWood', sand: 'ember', glass: 'sky' }),
};

export function blessingBoonSpec(b) {
  return (BLESSING_BOON[b.id] || (() => D.hollowSun()))();
}

export function blessingSpec(b) {
  return haloed(blessingBoonSpec(b), b.tier || 1);
}

// ── Whole catalog ────────────────────────────────────────────────────────

/** Every icon the game can show, grouped for contact sheets. */
export function catalog(data) {
  const groups = [];
  const byType = {};
  for (const w of data.weapons) (byType[w.type] ||= []).push(w);
  const order = ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light', 'Staff', 'Breath'];
  const tierRank = { Iron: 0, Steel: 1, Silver: 2, Legend: 3, Rare: 4 };
  for (const t of order)
    groups.push({
      label: t,
      items: (byType[t] || [])
        .slice()
        .sort((a, b) => tierRank[a.tier] - tierRank[b.tier])
        .map((w) => ({ name: w.name, spec: weaponSpec(w) })),
    });
  const scrolls = byType.Scroll || [];
  groups.push({
    label: 'Scrolls',
    items: [scrolls.find((s) => !s.teachesWeaponArtId), scrolls.find((s) => s.teachesWeaponArtId)]
      .filter(Boolean)
      .map((w) => ({
        name: w.teachesWeaponArtId ? 'Weapon-art scroll' : 'Skill scroll',
        spec: weaponSpec(w),
      })),
  });
  groups.push({
    label: 'Consumables',
    items: data.consumables.map((c) => ({ name: c.name, spec: consumableSpec(c) })),
  });
  groups.push({
    label: 'Accessories',
    items: data.accessories.map((a) => ({ name: a.name, spec: accessorySpec(a) })),
  });
  groups.push({
    label: 'Forge',
    items: [
      ...data.whetstones.map((w) => ({ name: w.name, spec: whetstoneSpec(w) })),
      ...data.imbues.imbues.map((i) => ({ name: i.stone.name, spec: imbueStoneSpec(i) })),
      { name: 'Prismatic Stone', spec: imbueStoneSpec(null) },
      { name: 'Gold', spec: D.goldPile() },
    ],
  });
  groups.push({
    label: 'Blessings',
    items: data.blessings.blessings.map((b) => ({ name: b.name, spec: blessingSpec(b) })),
  });
  const mu = data.metaUpgrades.upgrades || data.metaUpgrades;
  groups.push({
    label: 'Upgrades',
    items: mu.map((u) => ({ name: u.name, spec: upgradeSpec(u) })),
  });
  return groups;
}
