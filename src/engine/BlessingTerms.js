// BlessingTerms.js — the words a blessing or its price uses that need a sentence of their own
// (docs/specs/blessings-v3.md §8): a burden (Debt, Hunted, Sworn Enemy, Ill Omen, Lingering
// Injury), shadow, Vision and a pact. Surfaces show the sentence where the word appears; the
// burdens' sentences come from their own catalog (events.json `burdens`), with the rung's
// numbers. Pure.

import { CLEANSE_REFUSALS } from './Burdens.js';

const BURDEN_TERMS = [
  { id: 'debt', term: 'Debt', pattern: /\bdebt\b/i },
  { id: 'hunted', term: 'Hunted', pattern: /\bhunted\b/i },
  { id: 'sworn_enemy', term: 'Sworn Enemy', pattern: /\bsworn enemy\b/i },
  { id: 'ill_omen', term: 'Ill Omen', pattern: /\bill omen\b/i },
  { id: 'wounded', term: 'Lingering Injury', pattern: /\blingering injury\b/i },
];

const OTHER_TERMS = [
  {
    term: 'Shadow',
    pattern: /\bshadow\b/i,
    text: "The Eclipse's measure, the run's clock. More shadow raises enemy levels and lets route nodes fall to the dark.",
  },
  {
    term: 'Vision',
    pattern: /\bvision\b/i,
    text: 'A Vision charge rewinds a battle to an earlier turn. Each act boss you defeat grants one more.',
  },
];

const PACT_TEXT = 'A pact is a fixed price: this blessing always costs exactly this.';

/** The rung's value of a burden field (events.json `burdens.<id>.onRung.<rung>` over the base). */
function burdenValue(def, rung, key) {
  const onRung = def?.onRung?.[rung];
  return onRung && onRung[key] !== undefined ? onRung[key] : def?.[key];
}

/**
 * A price that names its own count for a burden ("Lingering Injury on your commander for 5
 * battles": a start gift's catch) is held to it; the catalog's count is the rung's default. The
 * count belongs to the burden's own clause: the search stops at a full stop, a semicolon or a
 * "·" (the next price of a pair: "Lingering Injury · Hunted for 3 battles" names no injury count).
 */
function namedBattles(text, pattern) {
  const source = pattern.source.replace(/^\\b|\\b$/g, '');
  const match = new RegExp(`${source}[^.;\u00b7]*?\\bfor (\\d+) battles\\b`, 'i').exec(text);
  return match ? Number(match[1]) : null;
}

function burdenSentence(id, def, rung, named = null) {
  const line = typeof def?.line === 'string' ? def.line : '';
  if (id === 'debt') {
    const share = Number(burdenValue(def, rung, 'garnish')) || 0.5;
    const part =
      share === 0.5 ? 'Half' : share === 0.25 ? 'A quarter' : `${Math.round(share * 100)}%`;
    return `${part} of each victory's battle gold goes to the lender until it's paid. A church can't lift it.`;
  }
  if (id === 'ill_omen') {
    const battles = burdenValue(def, rung, 'battles');
    const extra = burdenValue(def, rung, 'extraShadow');
    return `${line} ${battles ? `${battles} victories,` : ''} ${extra ? `+${extra} shadow each.` : ''}`
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (id === 'wounded') {
    const battles = named ?? burdenValue(def, rung, 'battles');
    const value = Math.abs(Number(burdenValue(def, rung, 'value')) || 2);
    return `One unit fights at -${value} to one stat${battles ? ` for ${battles} battles` : ''}. A church's Heal all mends it early.`;
  }
  return line;
}

/** What the terms say of a twist's burden no altar lifts: the altar's own refusal. */
const TWIST_REFUSAL = CLEANSE_REFUSALS.twist;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The run's record of burden `id` read for its countdown: a plain record's own, or the `event`
 * part a twist's record carries (engine/Burdens.js); null when nothing is counting down.
 */
function passingCountdown(held, id) {
  const record = (Array.isArray(held) ? held : []).find((b) => b?.id === id);
  if (!record) return null;
  const twist = record.permanent === true || typeof record.untilAct === 'string';
  const countdown = twist ? record.event : record;
  return Number(countdown?.battles) > 0 ? countdown : null;
}

/**
 * A twist's burden that outlasts its battles (Blood Covenant's endless Ill Omen, Hollow Sun's
 * Favor's Hunted through the next act: `permanent` / `actsAhead`, engine/Burdens.js) says so in
 * its own sentence, with the price's own numbers rather than the rung's countdown; null for any
 * other burden (the catalog's sentence stands).
 *
 * `held` (the run's burdens) adds what the record holds now: a passing countdown of the same
 * burden (an event's omen or hunt) keeps its own count beside the twist, the larger of the two
 * acting until it ends (said on the pick before the take, and in the held list after); `taken`
 * (the blessing is held) lets the held list say a hunt whose act has begun has ended.
 */
function twistBurdenSentence(id, def, effects, { held = null, taken = false } = {}) {
  const params = (Array.isArray(effects) ? effects : []).find(
    (e) => e?.type === 'burden' && e.params?.id === id,
  )?.params;
  if (!params || (params.permanent !== true && params.actsAhead === undefined)) return null;
  const line = typeof def?.line === 'string' ? def.line : '';
  const lift = TWIST_REFUSAL;
  const passing = passingCountdown(held, id);
  if (id === 'ill_omen') {
    const extra = Number(params.extraShadow ?? def?.extraShadow) || 1;
    const merge = passing
      ? ` You carry a passing Ill Omen (+${passing.extraShadow}, ${plural(passing.battles, 'more battle')}): it keeps its own count, and until it ends each victory takes the larger. An altar can lift the passing one.`
      : '';
    return `Each victory gathers +${extra} more shadow, for the rest of the run. ${lift}${merge}`;
  }
  if (id === 'hunted') {
    const count = Array.isArray(params.wave?.count) ? params.wave.count : null;
    const foes = count ? (count[0] === count[1] ? `${count[0]}` : `${count[0]}–${count[1]}`) : '';
    const turn = params.wave?.turn;
    const wave = foes && turn ? ` Each battle brings a wave of ${foes} foes on turn ${turn}.` : '';
    const acts = params.actsAhead > 1 ? `${params.actsAhead} acts` : 'act';
    // Held, the record is the truth: a span whose act has begun is gone.
    const record = (Array.isArray(held) ? held : []).find((b) => b?.id === 'hunted');
    const spanHeld = record?.permanent === true || typeof record?.untilAct === 'string';
    if (taken && !spanHeld)
      return `${line}${wave} It lasted through the next ${acts}: that hunt has ended.`
        .replace(/\s+/g, ' ')
        .trim();
    const span =
      params.permanent === true
        ? ' It lasts the rest of the run.'
        : ` It lasts through the next ${acts}.`;
    const merge = passing
      ? ` You carry a passing Hunted (${plural(passing.battles, 'more battle')}): it keeps its own count, and until it ends the bigger wave comes. An altar can lift the passing one.`
      : '';
    return `${line}${wave}${span} ${lift}${merge}`.replace(/\s+/g, ' ').trim();
  }
  return null;
}

/**
 * The terms a piece of blessing text uses, each with its sentence, in a fixed order.
 * @param {string|string[]} text - a price label, a description, or several
 * @param {{ burdens?: object, difficultyId?: string, pact?: boolean, effects?: object[],
 *   held?: object[]|null, taken?: boolean }} [context]
 *   `burdens`: events.json `burdens`; `pact`: the price is the blessing's pact; `effects`: the
 *   price's own effects (a twist's burden that outlasts its battles is explained from them);
 *   `held`: the run's burdens (what a twist's burden merges with, and whether it still runs);
 *   `taken`: the blessing is held (the held list), not offered
 * @returns {{ term: string, text: string }[]}
 */
export function blessingTerms(
  text,
  {
    burdens = null,
    difficultyId = 'normal',
    pact = false,
    effects = null,
    held = null,
    taken = false,
  } = {},
) {
  const joined = (Array.isArray(text) ? text : [text]).filter(Boolean).join(' ');
  const out = [];
  if (pact) out.push({ term: 'Pact', text: PACT_TEXT });
  for (const { id, term, pattern } of BURDEN_TERMS) {
    if (!pattern.test(joined)) continue;
    const sentence =
      twistBurdenSentence(id, burdens?.[id], effects, { held, taken }) ||
      burdenSentence(id, burdens?.[id], difficultyId, namedBattles(joined, pattern));
    if (sentence) out.push({ term, text: sentence });
  }
  for (const { term, pattern, text: sentence } of OTHER_TERMS)
    if (pattern.test(joined)) out.push({ term, text: sentence });
  return out;
}

/** The burden ids this module explains (a test holds the burden catalog to it). */
export const EXPLAINED_BURDEN_IDS = Object.freeze(BURDEN_TERMS.map((t) => t.id));
