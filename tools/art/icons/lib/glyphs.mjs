// Glyphs: small pictograms struck on seals and medallions (skills, weapon arts,
// scroll seals). Plain signs, not runes (ART_BIBLE: no glowing runes). Each glyph is a
// list of shapes in the 32-unit design space centred on (cx, cy); `s` = 1 fills a
// radius of about 6 units. Pure data.

const cap = (a, b, r) => ({ kind: 'capsule', a, b, r });
const circ = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });
const ell = (cx, cy, rx, ry, rot = 0) => ({ kind: 'ellipse', cx, cy, rx, ry, rot });
const poly = (pts) => ({ kind: 'poly', pts });
const ring = (cx, cy, r0, r1) => ({ kind: 'ring', cx, cy, r0, r1 });
const arc = (cx, cy, r, a0, a1, w) => ({ kind: 'arc', cx, cy, r, a0, a1, w });

const PI = Math.PI;

/**
 * @returns {Array<{shape:object, holes?:object[], accent?:boolean}>} shapes; `accent`
 *   marks a secondary piece drawn one ramp level lighter.
 */
export function glyph(kind, cx, cy, s = 1) {
  const P = (pts) => poly(pts.map(([x, y]) => [cx + x * s, cy + y * s]));
  const C = (x, y, r) => circ(cx + x * s, cy + y * s, r * s);
  const K = (a, b, r) => cap([cx + a[0] * s, cy + a[1] * s], [cx + b[0] * s, cy + b[1] * s], r * s);
  const A = (x, y, r, a0, a1, w) => arc(cx + x * s, cy + y * s, r * s, a0, a1, w * s);
  const R = (x, y, r0, r1) => ring(cx + x * s, cy + y * s, r0 * s, r1 * s);
  const E = (x, y, rx, ry, rot) => ell(cx + x * s, cy + y * s, rx * s, ry * s, rot);
  const star = (n, r0, r1, rot = -PI / 2, x = 0, y = 0) =>
    P(
      Array.from({ length: n * 2 }, (_, i) => {
        const a = rot + (i * PI) / n;
        const r = i % 2 ? r1 : r0;
        return [x + Math.cos(a) * r, y + Math.sin(a) * r];
      }),
    );
  switch (kind) {
    // ── Skills ──────────────────────────────────────────────────────────
    case 'sun': // Sol
      return [
        { shape: C(0, 0, 3.2) },
        ...Array.from({ length: 8 }, (_, i) => {
          const a = (i * PI) / 4;
          return {
            shape: K(
              [Math.cos(a) * 4.6, Math.sin(a) * 4.6],
              [Math.cos(a) * 6.4, Math.sin(a) * 6.4],
              0.75,
            ),
            accent: true,
          };
        }),
      ];
    case 'moon': // Luna
      return [{ shape: C(-0.4, 0, 5.8), holes: [C(2.4, -1.6, 4.9)] }];
    case 'star': // Astra
      return [
        { shape: star(4, 6.4, 1.7) },
        { shape: star(4, 2.6, 0.8, -PI / 2, 4.2, -4.2), accent: true },
      ];
    case 'chevron': // Vantage: strike first
      return [
        {
          shape: P([
            [-6, 2.2],
            [0, -4.6],
            [6, 2.2],
            [3.6, 2.2],
            [0, -1.4],
            [-3.6, 2.2],
          ]),
        },
        {
          shape: P([
            [-6, 6.4],
            [0, -0.4],
            [6, 6.4],
            [3.6, 6.4],
            [0, 2.8],
            [-3.6, 6.4],
          ]),
          accent: true,
        },
      ];
    case 'flame': // Wrath
      return [
        {
          shape: P([
            [0.4, -6.6],
            [4.4, -1.4],
            [4.8, 2.6],
            [2.4, 5.8],
            [-2.4, 5.8],
            [-4.8, 2.6],
            [-4.2, -1.8],
            [-2.2, 0.4],
            [-1.4, -3.4],
          ]),
        },
        {
          shape: P([
            [0.4, -1],
            [2.2, 2],
            [1.4, 4.6],
            [-1.4, 4.6],
            [-2, 2.2],
          ]),
          accent: true,
        },
      ];
    case 'twin': // Adept: strike again
      return [
        {
          shape: P([
            [-6, -5],
            [-1.4, 0],
            [-6, 5],
            [-6, 1.8],
            [-4.4, 0],
            [-6, -1.8],
          ]),
        },
        {
          shape: P([
            [-1.6, -5.6],
            [4, 0],
            [-1.6, 5.6],
            [-1.6, 2.2],
            [0.6, 0],
            [-1.6, -2.2],
          ]),
          accent: true,
        },
      ];
    case 'halo': // Miracle: a halo over a heart
      return [
        { shape: E(0, -4.4, 4.4, 1.7), holes: [E(0, -4.4, 2.8, 0.7)], accent: true },
        {
          shape: P([
            [0, 6],
            [-4.8, 1.2],
            [-4.6, -1],
            [-2.6, -2.2],
            [0, -0.6],
            [2.6, -2.2],
            [4.6, -1],
            [4.8, 1.2],
          ]),
        },
      ];
    case 'shield': // Guard
      return [
        {
          shape: P([
            [-5.2, -5.6],
            [5.2, -5.6],
            [5.2, 0.4],
            [0, 6.6],
            [-5.2, 0.4],
          ]),
        },
        {
          shape: P([
            [-0.9, -4],
            [0.9, -4],
            [0.9, 3.8],
            [0, 4.8],
            [-0.9, 3.8],
          ]),
          accent: true,
        },
      ];
    case 'pavise': // Pavise: a tower shield
      return [
        {
          shape: P([
            [-4.4, -6.4],
            [4.4, -6.4],
            [5, -5],
            [5, 5],
            [0, 6.8],
            [-5, 5],
            [-5, -5],
          ]),
        },
        { shape: K([-3, -3.4], [3, -3.4], 0.7), accent: true },
        { shape: K([-3, 0], [3, 0], 0.7), accent: true },
        { shape: K([-3, 3.4], [3, 3.4], 0.7), accent: true },
      ];
    case 'aegis': // Aegis: a round ward with a star
      return [
        { shape: C(0, 0, 6.2), holes: [star(4, 3.8, 1.2)] },
        { shape: star(4, 3.2, 1), accent: true },
      ];
    case 'cross': // Cancel
      return [
        { shape: K([-4.6, -4.6], [4.6, 4.6], 1.5) },
        { shape: K([4.6, -4.6], [-4.6, 4.6], 1.5) },
      ];
    case 'heartCrack': // Desperation
      return [
        {
          shape: P([
            [0, 6.4],
            [-6, 0.4],
            [-6, -2.6],
            [-3.4, -5],
            [0, -2.8],
            [3.4, -5],
            [6, -2.6],
            [6, 0.4],
          ]),
          holes: [
            P([
              [0.2, -2.6],
              [-1.4, 0.4],
              [0.8, 1.6],
              [-0.6, 5],
              [0.4, 5],
              [1.8, 1.4],
              [-0.2, 0.2],
              [1.2, -2.8],
            ]),
          ],
        },
      ];
    case 'riposte': // Quick Riposte: a returning arrow
      return [
        { shape: A(0.6, 0.6, 4.6, PI * 0.95, PI * 2.25, 1.9) },
        {
          shape: P([
            [-7.2, -0.8],
            [-1.8, -0.8],
            [-4.4, 4.2],
          ]),
          accent: true,
        },
      ];
    case 'fang': // Death Blow: a blade point driven down
      return [
        {
          shape: P([
            [-2.2, -6.6],
            [2.2, -6.6],
            [2.2, 1],
            [0, 6.8],
            [-2.2, 1],
          ]),
        },
        { shape: K([-5, -2.6], [5, -2.6], 1.1), accent: true },
      ];
    case 'bolt': // Darting Blow
      return [
        {
          shape: P([
            [1.6, -6.8],
            [-4.4, 0.8],
            [-0.4, 0.8],
            [-2, 6.8],
            [4.6, -1.2],
            [0.6, -1.2],
          ]),
        },
      ];
    case 'push': // Shove
      return [
        { shape: K([-6.2, -5], [-6.2, 5], 1.2), accent: true },
        {
          shape: P([
            [-3.6, -1.8],
            [1.4, -1.8],
            [1.4, -5.2],
            [6.8, 0],
            [1.4, 5.2],
            [1.4, 1.8],
            [-3.6, 1.8],
          ]),
        },
      ];
    case 'hook': // Pull
      return [
        { shape: A(1.6, -0.6, 4.2, -PI * 0.5, PI * 0.72, 1.8) },
        {
          shape: P([
            [-6.6, 3.4],
            [-1, -0.8],
            [-1, 7.6],
          ]),
          accent: true,
        },
      ];
    case 'eye': // Blink
      return [
        {
          shape: P([
            [-6.8, 0],
            [-3.4, -3.6],
            [0, -4.4],
            [3.4, -3.6],
            [6.8, 0],
            [3.4, 3.6],
            [0, 4.4],
            [-3.4, 3.6],
          ]),
          holes: [C(0, 0, 2.6)],
        },
        { shape: C(0, 0, 1.4), accent: true },
      ];
    case 'horn': // Rally Cry
      return [
        {
          shape: P([
            [-6.4, -4.4],
            [-4.8, -5.6],
            [0.6, -1.8],
            [4.6, -3.6],
            [6.2, -1],
            [5.6, 3.4],
            [3.4, 5.6],
            [0.4, 1.6],
            [-5, -2.8],
          ]),
        },
        { shape: E(4.8, 1.2, 1.4, 3.4, 0.5), accent: true },
      ];
    case 'healCircle': // Healing Circle
      return [
        { shape: R(0, 0, 4.6, 6.6), accent: true },
        {
          shape: P([
            [-1.3, -3.8],
            [1.3, -3.8],
            [1.3, -1.3],
            [3.8, -1.3],
            [3.8, 1.3],
            [1.3, 1.3],
            [1.3, 3.8],
            [-1.3, 3.8],
            [-1.3, 1.3],
            [-3.8, 1.3],
            [-3.8, -1.3],
            [-1.3, -1.3],
          ]),
        },
      ];
    case 'knot': // Ensnare: two linked rings
      return [{ shape: R(-2.2, -1.2, 2.4, 4.4) }, { shape: R(2.4, 1.6, 2.4, 4.4), accent: true }];
    case 'sprout': // Renewal
      return [
        { shape: K([0, 6.6], [0, -0.6], 0.9) },
        { shape: E(-2.8, -2.6, 3.4, 1.9, -0.6) },
        { shape: E(3, -4, 3.2, 1.8, 0.7), accent: true },
      ];
    case 'slot': // Extra Skill Slot: an empty seat with a plus
      return [
        {
          shape: P([
            [-6, -6],
            [6, -6],
            [6, 6],
            [-6, 6],
          ]),
          holes: [
            P([
              [-4.2, -4.2],
              [4.2, -4.2],
              [4.2, 4.2],
              [-4.2, 4.2],
            ]),
          ],
        },
        {
          shape: P([
            [-1, -3],
            [1, -3],
            [1, -1],
            [3, -1],
            [3, 1],
            [1, 1],
            [1, 3],
            [-1, 3],
            [-1, 1],
            [-3, 1],
            [-3, -1],
            [-1, -1],
          ]),
          accent: true,
        },
      ];
    // ── Weapon families (weapon-art seals) ─────────────────────────────
    case 'sword':
      return [
        {
          shape: P([
            [-4.4, 3.4],
            [4.2, -5.2],
            [5.8, -5.8],
            [5.2, -4.2],
            [-3.4, 4.4],
          ]),
        },
        { shape: K([-5.8, 1.8], [-1.8, 5.8], 1), accent: true },
        { shape: K([-4.6, 4.6], [-6.4, 6.4], 1.1), accent: true },
      ];
    case 'lance':
      return [
        { shape: K([-6, 6], [1, -1], 0.9), accent: true },
        {
          shape: P([
            [0, -0.6],
            [3.6, -6.2],
            [6.6, -6.6],
            [6.2, -3.6],
            [0.6, 0],
          ]),
        },
      ];
    case 'axe':
      return [
        { shape: K([-5, 6.4], [3, -5.6], 0.9), accent: true },
        {
          shape: P([
            [-0.4, -3.4],
            [4, -6.6],
            [6.8, -2.6],
            [5.4, 2.4],
            [1.6, 0.2],
          ]),
        },
      ];
    case 'bow':
      return [
        { shape: A(-3.6, 3.6, 8.2, -PI * 0.5, 0, 1.4) },
        { shape: K([-3.6, -4.6], [4.6, 3.6], 0.45), accent: true },
      ];
    case 'tome':
      return [
        {
          shape: P([
            [-5, -5.6],
            [4.4, -6.4],
            [5, 5.2],
            [-4.4, 6],
          ]),
        },
        {
          shape: P([
            [0, -3.2],
            [1.8, 0],
            [0, 3.2],
            [-1.8, 0],
          ]),
          accent: true,
        },
      ];
    case 'light':
      return [{ shape: star(4, 6.6, 1.6) }, { shape: C(0, 0, 1.6), accent: true }];
    case 'plus':
      return [
        {
          shape: P([
            [-1.6, -5],
            [1.6, -5],
            [1.6, -1.6],
            [5, -1.6],
            [5, 1.6],
            [1.6, 1.6],
            [1.6, 5],
            [-1.6, 5],
            [-1.6, 1.6],
            [-5, 1.6],
            [-5, -1.6],
            [-1.6, -1.6],
          ]),
        },
      ];
    default:
      return [{ shape: C(0, 0, 3.6) }];
  }
}

/** Skill id -> glyph and its colour (material). Unknown skills get the trigger's default. */
export const SKILL_GLYPH = Object.freeze({
  sol: ['sun', 'ember'],
  luna: ['moon', 'lilac'],
  astra: ['star', 'sky'],
  vantage: ['chevron', 'leaf'],
  wrath: ['flame', 'blood'],
  adept: ['twin', 'ember'],
  miracle: ['halo', 'pearl'],
  guard: ['shield', 'steel'],
  pavise: ['pavise', 'steel'],
  aegis: ['aegis', 'lilac'],
  cancel: ['cross', 'pearl'],
  desperation: ['heartCrack', 'blood'],
  quick_riposte: ['riposte', 'sky'],
  death_blow: ['fang', 'blood'],
  darting_blow: ['bolt', 'sky'],
  shove: ['push', 'earth'],
  pull: ['hook', 'earth'],
  blink: ['eye', 'lilac'],
  rally_cry_skill: ['horn', 'ember'],
  healing_circle: ['healCircle', 'verdigris'],
  ensnare: ['knot', 'verdigris'],
  renewal: ['sprout', 'verdigris'],
});

const TRIGGER_GLYPH = {
  'on-attack': ['fang', 'ember'],
  'on-defend': ['shield', 'steel'],
  'on-combat-start': ['chevron', 'sky'],
  'on-turn-start': ['sun', 'ember'],
  action: ['push', 'verdigris'],
  passive: ['star', 'pearl'],
  'passive-aura': ['healCircle', 'verdigris'],
};

export function skillGlyph(skill) {
  if (!skill) return ['star', 'pearl'];
  return SKILL_GLYPH[skill.id] || TRIGGER_GLYPH[skill.trigger] || ['star', 'pearl'];
}

/** Weapon type -> glyph for weapon-art seals. */
export const WEAPON_GLYPH = Object.freeze({
  Sword: 'sword',
  Lance: 'lance',
  Axe: 'axe',
  Bow: 'bow',
  Tome: 'tome',
  Light: 'light',
});
