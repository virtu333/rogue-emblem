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
import { STAT_MATERIAL } from './palette.mjs';

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

export function weaponSpec(w) {
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
    case 'Tome': {
      const el = TOME_ELEMENT[w.name] || 'fire';
      return D.tome({
        cover: ELEMENT_COVER[el],
        fit: t.fit,
        emblem: el,
        emblemMat: ELEMENT_EMBLEM[el],
      });
    }
    case 'Light':
      return D.tome({
        cover: 'parchment',
        fit: t.fit,
        emblem: 'light',
        emblemMat: sp.crit ? 'blood' : 'gilt',
        pages: 'pearl',
      });
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
      return w.teachesWeaponArtId
        ? D.scroll({ cord: 'ember', seal: 'gilt' })
        : D.scroll({ cord: 'unlight', seal: 'unlight' });
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

// ── Meta upgrades ────────────────────────────────────────────────────────

const STAT_FROM_ID = (id) => {
  const m = id.match(/_(hp|str|def|spd|skl|res|mag|lck)_/);
  return m ? m[1].toUpperCase() : null;
};

export function upgradeSpec(u) {
  const stat = STAT_FROM_ID(`${u.id}_`);
  const growth = /growth/.test(u.id);
  const statMat = stat ? STAT_MATERIAL[stat] : null;
  const badge = (s) => (growth ? withBadge(s, 'growth') : stat ? withBadge(s, 'plus') : s);
  if (u.category === 'recruit_stats')
    return badge(D.helm({ metal: 'steel', plume: statMat || 'blood' }));
  if (u.category === 'lord_bonuses') {
    if (/vision|revelation|glimpse/.test(`${u.id} ${u.name}`.toLowerCase()))
      return D.hollowSun({ corona: 'gilt' });
    if (stat) return badge(D.crown({ metal: 'gilt', gem: statMat }));
    if (/heir|friendship/.test(u.id)) return D.banner({ cloth: 'verdigris', emblem: 'star' });
    if (/commander|partner/.test(u.id))
      return D.banner({ cloth: 'steel', emblem: 'cross', emblemMat: 'gilt' });
    return D.crown({ metal: 'gilt', gem: 'unlight' });
  }
  if (u.category === 'economy') {
    const e = {
      starting_gold: () => D.chest(),
      battle_gold: () => D.goldPile(),
      starting_vulnerary: () => D.vial({ liquid: 'verdigris' }),
      loot_quality: () => D.crystal({ mat: 'gilt' }),
      studied_training: () => D.scroll({ cord: 'ember', seal: 'gilt' }),
      trinket_collector: () => D.ringItem({ band: 'gilt', gem: 'rose' }),
      heros_call: () => D.banner({ cloth: 'blood', emblem: 'star' }),
      trade_contacts: () => D.pouch({ cloth: 'earth', tie: 'gilt', sparkle: 'gilt' }),
    };
    return (e[u.id] || (() => D.goldPile()))();
  }
  if (u.category === 'capacity') {
    if (/deploy|roster|cadre/.test(u.id)) return withBadge(D.banner({ cloth: 'steel' }), 'plus');
    if (/armory|arms|master_of_arms|forge/.test(u.id))
      return D.anvil({ metal: /silver/.test(u.id) ? 'silver' : 'iron' });
    if (/skill/.test(u.id)) return D.scroll({ cord: 'unlight', seal: 'unlight' });
    if (/supplies/.test(u.id)) return D.vial({ liquid: 'verdigris' });
    if (/accessory/.test(u.id)) return D.ringItem({ band: 'silver', gem: 'sky' });
    if (/xp/.test(u.id)) return withBadge(D.helm({ metal: 'iron', plume: 'ember' }), 'growth');
    return D.helm({ metal: 'gilt', plume: 'ember' });
  }
  if (u.category === 'starting_equipment') {
    if (/silver/.test(u.id)) return D.sword({ blade: 'silver', fit: 'silverFit', grip: 'cloth' });
    if (/tier/.test(u.id)) return D.sword({ blade: 'steel', fit: 'steelFit', variant: 'rapier' });
    if (/staff/.test(u.id)) return D.staff({ fit: 'gilt', gem: 'verdigris' });
    if (/accessory/.test(u.id)) return D.ringItem({ band: 'gilt', gem: 'blood' });
    if (/reclass/.test(u.id)) return D.seal({ wax: 'steel', metal: 'silver', glyph: 'boot' });
    return D.anvil();
  }
  if (u.category === 'starting_skills')
    return D.scroll({
      cord: /art/.test(u.id) ? 'ember' : 'unlight',
      seal: /art/.test(u.id) ? 'gilt' : 'unlight',
    });
  return D.chest();
}

// ── Blessings: the boon, seen through the Hollow Sun ─────────────────────

const BLESSING_BOON = {
  steady_hands: () => D.glove({ leather: 'wood', cuff: 'gilt' }),
  coin_of_fate: () => D.coin({ face: 'gilt', back: 'ember', glyph: 'star' }),
  blessed_vigor: () => D.robe({ cloth: 'verdigris' }),
  swift_instinct: () => D.feather(),
  field_medic: () => D.vial({ liquid: 'verdigris' }),
  iron_oath: () => D.shield({ face: 'steel', rim: 'ironFit' }),
  scout_blessing: () => D.banner({ cloth: 'steel' }),
  scholar_vow: () => D.tome({ cover: 'pearl', fit: 'gilt', emblem: 'light', emblemMat: 'gilt' }),
  rally_cry: () => D.banner({ cloth: 'blood', emblem: 'star' }),
  war_veteran: () => D.helm({ metal: 'bronze', plume: 'ember' }),
  frugal_smith: () => D.anvil(),
  arsenal_pact: () => D.sword({ blade: 'silver', fit: 'silverFit', grip: 'cloth' }),
  pilgrim_coin: () => D.pouch({ cloth: 'earth', tie: 'gilt', sparkle: 'gilt' }),
  merchant_bane: () => D.goldPile(),
  nomad_pact: () => D.boot({ wing: false }),
  terrain_mastery: () => D.pendant({ form: 'leaf', body: 'leaf', chain: 'wood', gem: 'verdigris' }),
  quartermaster_cache: () => D.vial({ shape: 'flask', liquid: 'ember', cork: 'gilt' }),
  forbidden_tome: () =>
    D.tome({ cover: 'unlight', fit: 'gilt', emblem: 'dark', emblemMat: 'lilac' }),
  blood_forge: () => D.anvil({ metal: 'blackened' }),
  war_tutelage: () => D.scroll({ cord: 'blood', seal: 'blood' }),
  armory_stash: () => D.whetstone({ streak: 'ember' }),
  scroll_archive: () => D.scroll({ cord: 'ember', seal: 'gilt' }),
  focused_curriculum: () =>
    D.tome({ cover: 'sky', fit: 'silverFit', emblem: 'thunder', emblemMat: 'pearl' }),
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
