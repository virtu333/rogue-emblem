// BlessingTerms.js — the words a blessing or its price uses that need a sentence of their own
// (docs/specs/blessings-v3.md §8): a burden (Debt, Hunted, Sworn Enemy, Ill Omen, Lingering
// Injury), shadow, Vision and a pact. Surfaces show the sentence where the word appears; the
// burdens' sentences come from their own catalog (events.json `burdens`), with the rung's
// numbers. Pure.

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

function burdenSentence(id, def, rung) {
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
    const battles = burdenValue(def, rung, 'battles');
    const value = Math.abs(Number(burdenValue(def, rung, 'value')) || 2);
    return `One unit fights at -${value} to one stat${battles ? ` for ${battles} battles` : ''}. A church's Heal all mends it early.`;
  }
  return line;
}

/**
 * A twist's burden that outlasts its battles (Blood Covenant's endless Ill Omen, Hollow Sun's
 * Favor's Hunted through the next act: `permanent` / `actsAhead`, engine/Burdens.js) says so in
 * its own sentence, with the price's own numbers rather than the rung's countdown; null for any
 * other burden (the catalog's sentence stands).
 */
function twistBurdenSentence(id, def, effects) {
  const params = (Array.isArray(effects) ? effects : []).find(
    (e) => e?.type === 'burden' && e.params?.id === id,
  )?.params;
  if (!params || (params.permanent !== true && params.actsAhead === undefined)) return null;
  const line = typeof def?.line === 'string' ? def.line : '';
  const lift = 'No altar lifts it while you hold the blessing.';
  if (id === 'ill_omen') {
    const extra = Number(params.extraShadow ?? def?.extraShadow) || 1;
    return `Each victory gathers +${extra} more shadow, for the rest of the run. ${lift}`;
  }
  if (id === 'hunted') {
    const count = Array.isArray(params.wave?.count) ? params.wave.count : null;
    const foes = count ? (count[0] === count[1] ? `${count[0]}` : `${count[0]}-${count[1]}`) : '';
    const turn = params.wave?.turn;
    const wave = foes && turn ? ` Each battle brings a wave of ${foes} foes on turn ${turn}.` : '';
    const span =
      params.permanent === true
        ? ' It lasts the rest of the run.'
        : ` It lasts through the next ${params.actsAhead > 1 ? `${params.actsAhead} acts` : 'act'}.`;
    return `${line}${wave}${span} ${lift}`.replace(/\s+/g, ' ').trim();
  }
  return null;
}

/**
 * The terms a piece of blessing text uses, each with its sentence, in a fixed order.
 * @param {string|string[]} text - a price label, a description, or several
 * @param {{ burdens?: object, difficultyId?: string, pact?: boolean, effects?: object[] }} [context]
 *   `burdens`: events.json `burdens`; `pact`: the price is the blessing's pact; `effects`: the
 *   price's own effects (a twist's burden that outlasts its battles is explained from them)
 * @returns {{ term: string, text: string }[]}
 */
export function blessingTerms(
  text,
  { burdens = null, difficultyId = 'normal', pact = false, effects = null } = {},
) {
  const joined = (Array.isArray(text) ? text : [text]).filter(Boolean).join(' ');
  const out = [];
  if (pact) out.push({ term: 'Pact', text: PACT_TEXT });
  for (const { id, term, pattern } of BURDEN_TERMS) {
    if (!pattern.test(joined)) continue;
    const sentence =
      twistBurdenSentence(id, burdens?.[id], effects) ||
      burdenSentence(id, burdens?.[id], difficultyId);
    if (sentence) out.push({ term, text: sentence });
  }
  for (const { term, pattern, text: sentence } of OTHER_TERMS)
    if (pattern.test(joined)) out.push({ term, text: sentence });
  return out;
}

/** The burden ids this module explains (a test holds the burden catalog to it). */
export const EXPLAINED_BURDEN_IDS = Object.freeze(BURDEN_TERMS.map((t) => t.id));
