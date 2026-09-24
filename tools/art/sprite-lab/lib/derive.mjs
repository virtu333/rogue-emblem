// Approach (b): "procedural treatment" of existing art. Takes a finished 64px
// texture (e.g. the approved rebuilt Edric) and converts it into the lab's
// indexed (slot, shade) form by nearest-ramp classification, so the same
// faction recolour, corruption grade, outline and rim passes apply to it.
//
//   derive(img, candidates, { majority }) -> Figure
//
// `candidates` = { slot: rampName } — which ramps this character may use
// (Edric: teal cloth, brown hair, warm skin, leather, umber, blade, gold).
import { Figure } from './figure.mjs';
import { RAMPS } from './palette.mjs';

// Perceptual-ish distance (redmean).
function dist(a, b) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

export function derive(img, candidates, { majority = true, inkBelow = 34, calm = 0 } = {}) {
  const f = new Figure(img.w, img.h);
  const pid = f.begin('derived', { rim: true });
  const entries = Object.entries(candidates).flatMap(([slot, ramp]) =>
    RAMPS[ramp].map((c, shade) => ({ slot, shade, c })),
  );
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const [r, g, b, a] = img.get(x, y);
      if (a < 128) continue;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      // Near-black source pixels are the generator's contour: keep them as ink
      // so the silhouette stays; the lab's own outline is added outside.
      if (l < inkBelow) {
        f.px(x, y, 'ink', 0, pid);
        continue;
      }
      let best = null,
        bd = Infinity;
      for (const e of entries) {
        const d = dist([r, g, b], e.c);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      f.px(x, y, best.slot, best.shade, pid);
    }
  if (majority) cleanSpeckles(f);
  if (calm) calmShades(f, calm);
  return f;
}

// "Calm" pass: a pixel whose shade differs from all four same-slot neighbours
// takes the most common neighbouring shade — removes the one-pixel sparkle that
// nearest-neighbour downscaling leaves, without touching shapes or slots.
function calmShades(f, passes = 1) {
  for (let p = 0; p < passes; p++) {
    const shade = Int8Array.from(f.shade);
    for (let y = 1; y < f.h - 1; y++)
      for (let x = 1; x < f.w - 1; x++) {
        const i = y * f.w + x;
        const s = f.slot[i];
        if (!s || s === 'ink') continue;
        const nb = [i - 1, i + 1, i - f.w, i + f.w].filter((k) => f.slot[k] === s);
        if (nb.length < 3 || nb.some((k) => shade[k] === shade[i])) continue;
        const count = {};
        for (const k of nb) count[shade[k]] = (count[shade[k]] || 0) + 1;
        const [top] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
        f.shade[i] = +top;
      }
  }
}

// Candidate ramps for the approved rebuilt art (what each character may use).
export const DERIVE_SETS = {
  lord_edric: {
    main: 'teal',
    hair: 'hairBrown',
    skin: 'skinWarm',
    leather: 'leather',
    sub: 'umber',
    metal: 'bladeP',
    trim: 'gold',
  },
  lord_sera: {
    main: 'plum',
    hair: 'hairAuburn',
    skin: 'skinFair',
    linen: 'bone',
    leather: 'leather',
    sub: 'charcoal',
    trim: 'gold',
  },
  enemy_myrmidon: {
    main: 'lacquer',
    hair: 'hairBlack',
    skin: 'skinWarm',
    leather: 'leather',
    sub: 'charcoal',
    metal: 'bladeE',
    linen: 'linen',
  },
};

// Rebuilt texture -> indexed into the lab ramps -> resolved (the "treated" lord).
export async function treatedRebuilt(key, alias = {}, opts = {}) {
  const { loadRebuilt } = await import('./rebuilt.mjs');
  const { resolve } = await import('./resolve.mjs');
  const { Img } = await import('./image.mjs');
  const f = derive(await loadRebuilt(key), DERIVE_SETS[key], { calm: opts.calm ?? 0 });
  return Img.from(
    64,
    64,
    resolve(f, { ...DERIVE_SETS[key], ...alias }, { outline: null, ...opts }),
  );
}

// Replace isolated single pixels whose slot differs from all 4 neighbours by
// the most common neighbour slot (removes the downscale "confetti").
function cleanSpeckles(f) {
  const snap = f.slot.slice();
  const shade = Int8Array.from(f.shade);
  for (let y = 1; y < f.h - 1; y++)
    for (let x = 1; x < f.w - 1; x++) {
      const i = y * f.w + x;
      const s = snap[i];
      if (!s || s === 'ink' || s === 'eye') continue;
      const ns = [snap[i - 1], snap[i + 1], snap[i - f.w], snap[i + f.w]].filter(Boolean);
      if (ns.length < 4 || ns.includes(s)) continue;
      const count = {};
      for (const n of ns) count[n] = (count[n] || 0) + 1;
      const [top, c] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      if (c >= 3 && top !== 'ink') {
        f.slot[i] = top;
        const j = [i - 1, i + 1, i - f.w, i + f.w].find((k) => snap[k] === top);
        f.shade[i] = shade[j];
      }
    }
}
