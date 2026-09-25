// Treatments: palette operations on a traced sprite (faction, NPC, corruption, acted,
// recruit identity) plus the corruption split and hit flash on the resolved RGBA.
// Every state is a ramp swap or grade of the same indexed drawing, so the class
// silhouette and the person stay identical across states. Pure.
import { SLOT } from './slots.mjs';
import { BIBLE_RAMPS, INK } from './ramps.mjs';
import { mix, luma, hex } from './color.mjs';
import { Raster } from './raster.mjs';

/** Faction ramp swaps (slot -> Bible ramp). `keepMain` keeps a lord's identity cloth. */
export const FACTIONS = {
  player: { main: 'steelCloth', trim: 'gold', metal: 'bladeP', armor: 'silver' },
  enemy: { main: 'lacquer', trim: 'ironTrim', metal: 'bladeE', armor: 'iron' },
  npc: { main: 'verdigris', trim: 'gold', metal: 'bladeP', armor: 'silver' },
  // corrupted: the enemy kit, then the unlight grade drains it
  corrupted: {
    main: 'lacquer',
    trim: 'ironTrim',
    metal: 'bladeE',
    armor: 'iron',
    glow: 'glowUnlight',
  },
};

/**
 * Build a render palette for a state.
 * base: { ramps: {slot: ramp}, eye } from traceNative.
 * opts: { faction, keepMain, keep: [slot names the faction swap leaves alone (a named
 * boss's gold trim or plate)], identity: { hair, skin, accent } (ramp names), grade }
 */
export function paletteFor(
  base,
  { faction = null, keepMain = false, keep = null, identity = null, grade = null } = {},
) {
  const ramps = { ...base.ramps };
  const f = faction && FACTIONS[faction];
  if (f)
    for (const [slot, name] of Object.entries(f)) {
      if (slot === 'main' && keepMain) continue;
      if (keep?.includes(slot) && ramps[SLOT[slot]]) continue;
      if (slot === 'glow' || ramps[SLOT[slot]] || slot === 'main')
        ramps[SLOT[slot]] = BIBLE_RAMPS[name];
    }
  if (identity) {
    if (identity.hair) ramps[SLOT.hair] = BIBLE_RAMPS[identity.hair] || identity.hair;
    if (identity.skin) ramps[SLOT.skin] = BIBLE_RAMPS[identity.skin] || identity.skin;
    if (identity.accent) ramps[SLOT.accent] = BIBLE_RAMPS[identity.accent] || identity.accent;
  }
  // identity-less generic enemies: plate/iron eyes stay dark
  return { ramps, eye: base.eye ? mix(base.eye, INK, 0.35) : null, grade };
}

// --- grades --------------------------------------------------------------------------

/**
 * Acted state as a palette operation (possible because sprites are indexed): colour
 * drains to 35% saturation and value drops ~14%, so the unit reads as spent without
 * sinking into the ground. (The game's current acted state is a 0xb8b8b8 multiply.)
 */
export function actedGrade() {
  return (c) => {
    const l = luma(c);
    return mix(c, [l, l, l], 0.65).map((v) => v * 0.86 + 6);
  };
}

const UNLIGHT = ['#170c24', '#2c1645', '#4a2270', '#763aa0', '#a863cc', '#dcaaf0'].map(hex);
const UL = UNLIGHT.map(luma);

/**
 * Corruption ("unlight"): colour drains toward violet-black at the same value, the
 * faction cloth keeps a wine undertone (still the empire), no warm highlight survives.
 */
export function unlightGrade(strength = 0.55) {
  return (c, slot, shade) => {
    if (slot === SLOT.glow) return c;
    const l = luma(c);
    const g = mix(c, [l, l, l], slot === SLOT.main ? 0.4 : 0.75);
    let k = 0;
    while (k < UNLIGHT.length - 2 && UL[k + 1] < l) k++;
    const t = Math.max(0, Math.min(1, (l - UL[k]) / (UL[k + 1] - UL[k] || 1)));
    const u = mix(UNLIGHT[k], UNLIGHT[k + 1], t);
    const w = strength * (l < 70 ? 1.2 : 0.8) * (slot === SLOT.main ? 0.45 : 1);
    let out = mix(g, u, Math.min(1, w));
    const target = l * (shade >= 4 ? 0.82 : 0.94);
    const ol = luma(out) || 1;
    out = out.map((v) => Math.max(0, Math.min(255, (v * target) / ol)));
    if (slot === SLOT.eye) return hex('#dcaaf0');
    return out;
  };
}

// --- RGBA effects --------------------------------------------------------------------

/**
 * "The image splits": two thin horizontal slices of the figure slide sideways with a
 * lit unlight tear, and a faint violet after-image trails a pixel behind. Seeded.
 */
export function splitImage(img, seed = 1) {
  const { w, h } = img;
  let st = (seed * 7919 + 13) >>> 0;
  const rnd = () => {
    st = (st + 0x6d2b79f5) >>> 0;
    let t = st;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const b = img.alphaBounds(0);
  const out = new Raster(w, h);
  const ghost = UNLIGHT[2];
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w; x++) if (img.d[(y * w + x) * 4 + 3]) out.set(x - 1, y, [...ghost, 110]);
  const span = b.height;
  const bands = [
    [b.y + Math.floor(span * (0.28 + rnd() * 0.1)), 2, 1],
    [b.y + Math.floor(span * (0.58 + rnd() * 0.12)), 2, -1],
  ];
  const shiftOf = (y) => {
    for (const [by, bh, dx] of bands) if (y >= by && y < by + bh) return dx;
    return 0;
  };
  for (let y = 0; y < h; y++) {
    const dx = shiftOf(y);
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= w) continue;
      const s = (y * w + sx) * 4;
      if (!img.d[s + 3]) continue;
      out.set(x, y, [img.d[s], img.d[s + 1], img.d[s + 2], 255]);
    }
    if (dx) {
      for (let x = dx > 0 ? 0 : w - 1; dx > 0 ? x < w : x >= 0; x += dx > 0 ? 1 : -1) {
        const i = (y * w + x) * 4;
        if (out.d[i + 3] === 255) {
          out.set(x, y, [...UNLIGHT[4], 255]);
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Hit flash: the figure turns paper white; its outermost ring (the outline) turns
 * crimson so the silhouette survives the flash on pale ground.
 */
export function hitFlash(img) {
  const { w, h } = img;
  const out = new Raster(w, h);
  const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img.d[(y * w + x) * 4 + 3]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!a(x, y)) continue;
      const edge = !a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1) || !a(x, y + 1);
      out.set(x, y, edge ? [110, 26, 40, 255] : [244, 236, 219, 255]);
    }
  return out;
}

/** The game's current acted state: multiplicative tint 0xb8b8b8. */
export const multiplyActed = ([r, g, b, a]) => [
  (r * 0xb8) / 255,
  (g * 0xb8) / 255,
  (b * 0xb8) / 255,
  a,
];
