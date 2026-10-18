// combatNumberStyle.js — the one look of every number that floats over a unit in battle.
//
// Pure data, no Phaser: given what happened (a strike, a crit, a blow that did nothing, a
// heal, a poison tick, lava, acid, a miss...) and its value, `combatNumberStyle` answers the
// text, colour, size, depth and motion. `ui/CombatNumberFloat.js` draws that answer and every
// float site in the battle reads it, so a heal, a hazard and a blow can never disagree on
// colour or on how reduced motion behaves. Presentation only: nothing here touches HP.
import { UI_PALETTE } from '../utils/uiStyles.js';

/** The kinds of number the battle floats. */
export const COMBAT_NUMBER_KINDS = Object.freeze([
  'strike', // a blow that landed
  'crit', // a critical blow
  'noDamage', // a blow that landed for 0
  'warded', // a blow a Vigil Voice's ward turned aside (engine/Vigil.js)
  'heal', // a heal (a staff, Fort, a skill, a renewal)
  'drain', // what a draining weapon gave back to its wielder
  'poison', // a poison tick
  'lava', // a lava burn
  'acid', // an acid tick
  'miss', // a dodge
  'thorns', // what a Thorns foe's reflection cost the striker
  'ballista', // a ballista bolt
  'deathburst', // a Deathburst's blast
  'splash', // the Entity's splash
]);

// Blows that deal damage: a value of 0 on any of these is a "No damage" float.
const DAMAGE_KINDS = new Set(['strike', 'crit', 'ballista', 'deathburst', 'splash']);

export const NO_DAMAGE_TEXT = 'No damage';
export const WARDED_TEXT = 'Warded';
export const MISS_TEXT = 'MISS';

/** Reduced motion: the number holds still, then fades. No rise, no pop, no spark growth. */
export const REDUCED_HOLD_MS = 300;
export const REDUCED_FADE_MS = 250;

const INK = UI_PALETTE.void; // the edge that keeps a number legible over bright impact frames

// Per kind: size (px), colour, how far it rises, how long it lives, depth.
// Depths and lifetimes are the ones each float site had before this model.
const KINDS = {
  strike: { size: 13, color: UI_PALETTE.text, rise: 16, duration: 600, depth: 300 },
  crit: { size: 18, color: UI_PALETTE.accentText, rise: 20, duration: 750, depth: 300 },
  noDamage: { size: 10, color: UI_PALETTE.muted, rise: 10, duration: 550, depth: 300 },
  warded: { size: 11, color: UI_PALETTE.info, rise: 10, duration: 600, depth: 300 },
  heal: { size: 13, color: UI_PALETTE.good, rise: 20, duration: 600, depth: 300 },
  drain: { size: 11, color: UI_PALETTE.good, rise: 20, duration: 600, depth: 300 },
  poison: { size: 12, color: UI_PALETTE.threatStatus, rise: 16, duration: 600, depth: 301 },
  lava: { size: 12, color: UI_PALETTE.terrainBurn, rise: 16, duration: 450, depth: 320 },
  acid: { size: 12, color: UI_PALETTE.terrainAcid, rise: 16, duration: 450, depth: 320 },
  miss: { size: 12, color: UI_PALETTE.muted, rise: 16, duration: 500, depth: 300 },
  thorns: { size: 12, color: UI_PALETTE.bad, rise: 16, duration: 600, depth: 300 },
  ballista: { size: 13, color: UI_PALETTE.warn, rise: 16, duration: 600, depth: 301 },
  deathburst: { size: 12, color: UI_PALETTE.warn, rise: 16, duration: 500, depth: 320 },
  splash: { size: 12, color: UI_PALETTE.rarityEpic, rise: 16, duration: 600, depth: 320 },
};

// The crit's quick scale pop: it starts small and springs past its size, then settles.
const CRIT_POP = Object.freeze({
  from: 0.55,
  duration: 200,
  ease: 'Back.easeOut',
  easeParams: [3],
});

// The spark of a blow that did nothing: a tiny star, long and short rays alternating.
const SPARK_RAYS = 8;
const SPARK_LONG = 8;
const SPARK_SHORT = 4;
const SPARK_INNER = 2;
const SPARK = Object.freeze({
  color: UI_PALETTE.text,
  width: 2,
  duration: 260,
  growFrom: 0.6,
  growTo: 1.25,
  // Drawn at the unit's body: this far below the number's anchor (which floats above it).
  dy: 12,
});

/** The star's rays as [x1, y1, x2, y2] segments about (0, 0). Deterministic, no randomness. */
export function sparkSegments() {
  const segments = [];
  for (let i = 0; i < SPARK_RAYS; i++) {
    const angle = (i * 2 * Math.PI) / SPARK_RAYS;
    const outer = i % 2 === 0 ? SPARK_LONG : SPARK_SHORT;
    const round = (n) => Math.round(n * 100) / 100 || 0;
    segments.push([
      round(Math.cos(angle) * SPARK_INNER),
      round(Math.sin(angle) * SPARK_INNER),
      round(Math.cos(angle) * outer),
      round(Math.sin(angle) * outer),
    ]);
  }
  return segments;
}

/** A whole, non-negative amount; anything else reads as 0. */
function amountOf(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The kind that is actually drawn: a damaging blow of 0 is "No damage", whatever it was. */
export function resolveCombatNumberKind(kind, value) {
  if (!Object.hasOwn(KINDS, kind)) return 'strike';
  if (DAMAGE_KINDS.has(kind) && amountOf(value) === 0) return 'noDamage';
  return kind;
}

function textFor(kind, amount) {
  switch (kind) {
    case 'crit':
      return `${amount}!`;
    case 'noDamage':
      return NO_DAMAGE_TEXT;
    case 'warded':
      return WARDED_TEXT;
    case 'heal':
    case 'drain':
      return `+${amount}`;
    case 'poison':
      return `Poison -${amount}`;
    case 'lava':
      return `Lava -${amount}`;
    case 'acid':
      return `Acid -${amount}`;
    case 'miss':
      return MISS_TEXT;
    case 'thorns':
      return `−${amount} Thorns`;
    case 'splash':
      return `Splash -${amount}`;
    default:
      return `${amount}`;
  }
}

/**
 * What to draw for one floating number.
 *
 * `kind`: one of COMBAT_NUMBER_KINDS (an unknown kind reads as a plain strike). `value` is the
 * amount (damage, healing, tick); a damaging kind with 0 becomes `noDamage`.
 * `reducedMotion`: no rise and no pop, a short hold and fade.
 *
 * Returns `{ kind, text, color, fontSize, style, depth, motion, spark }`:
 *   - `style`: the Phaser text style (ink edge included).
 *   - `motion`: `{ mode: 'rise' | 'pop' | 'fade', rise, duration, delay, pop }`. `rise` is the
 *     pixels the number climbs while fading over `duration` ms after `delay`; `pop` (crit only,
 *     never in reduced motion) is `{ from, duration, ease, easeParams }`, a scale from `from` to 1.
 *   - `spark`: null, or the tiny star of a blow that did nothing.
 */
export function combatNumberStyle(kind, value, { reducedMotion = false } = {}) {
  const drawn = resolveCombatNumberKind(kind, value);
  const look = KINDS[drawn];
  const amount = amountOf(value);
  const reduced = Boolean(reducedMotion);

  const motion = reduced
    ? { mode: 'fade', rise: 0, duration: REDUCED_FADE_MS, delay: REDUCED_HOLD_MS, pop: null }
    : drawn === 'crit'
      ? { mode: 'pop', rise: look.rise, duration: look.duration, delay: 0, pop: { ...CRIT_POP } }
      : { mode: 'rise', rise: look.rise, duration: look.duration, delay: 0, pop: null };

  return {
    kind: drawn,
    text: textFor(drawn, amount),
    color: look.color,
    fontSize: look.size,
    style: {
      fontFamily: 'monospace',
      fontSize: `${look.size}px`,
      color: look.color,
      fontStyle: 'bold',
      stroke: INK,
      strokeThickness: look.size >= 13 ? 3 : 2,
    },
    depth: look.depth,
    motion,
    spark:
      drawn === 'noDamage'
        ? {
            ...SPARK,
            segments: sparkSegments(),
            // A still star, held and faded like the number, when motion is reduced.
            grow: !reduced,
            delay: reduced ? REDUCED_HOLD_MS : 0,
            duration: reduced ? REDUCED_FADE_MS : SPARK.duration,
          }
        : null,
  };
}
