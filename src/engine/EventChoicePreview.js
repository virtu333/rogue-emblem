// EventChoicePreview.js — what an event choice can do, said before it is made (owner decision
// 2026-10-10, docs/specs/event-nodes.md §10 "Choice previews"). The page shows every result a
// choice can have on this run's rung, from the event data itself, so the words can never
// disagree with what the engine applies. WHICH result the seed will roll stays hidden, but the odds
// of a weighted choice are said (owner decision 2026-10-10): each outcome's chance on this rung,
// read through `outcomeWeight`, the roller's own weight, as whole percentages that sum to 100. A
// check's chance and a tell's tilt are never said (they depend on the unit). Outcomes with no
// weight on this rung (Black Sun's lying strangers elsewhere) are left out, because they cannot
// happen here.
//
//   choicePreview(run, choice, { catalog, event, state }) ->
//     [{ lead, text, details: [string] }]
//   lead: ''      the choice's own effects (spent whatever the outcome), or its only outcome
//         '70%' ...  the outcomes of a choice that has several: one of them happens, with this
//                    chance (largest-remainder rounding, so the leads sum to 100)
//         'Test'  a check: whose stats are read (higher is better; no number is shown)
//         'Pass' / 'Fail'  the check's two outcomes
//   text: the outcome's effects as short phrases joined by ' · ' ("Nothing happens" for an
//         outcome that does nothing when the choice has others); an outcome's fallback rides in
//         brackets ("if that can't happen: ..."); `details` explain a blessing, a burden, a contract
//
// Amounts are the ones the planner would use now: gold for the run's act (a cost's rung scale is
// the seal's, not a reward's), HP and Injury figures for the rung, a weapon's tier for the act. A
// shadow change is said only while the Eclipse runs (otherwise it does nothing). Story flags are
// the story's own memory and are never said. Pure: no Phaser, no DOM, no randomness.

import { actLabel, romanNumeral } from '../utils/actNames.js';
import { FORGE_BONUSES } from '../utils/constants.js';
import { burdenPreview } from './Burdens.js';
import { CONTRACT_GOAL_LINES } from './Contracts.js';
import { accessoryTableActFor, eventWeaponTier } from './EventEffects.js';
import { placeName, withArticle } from './EventResultWords.js';
import { byRungValue, counterLabel, outcomeWeight, resolveAmount } from './EventSystem.js';

const MINUS = '−';
const num = (value) => Math.trunc(Number(value) || 0);
const signed = (n) => (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`);
const upper = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '');
const lower = (text) => (text ? text[0].toLowerCase() + text.slice(1) : '');

/** Said once under any line that hurts: an event's damage never fells anyone. */
export const NEVER_FATAL = 'Event damage never takes a unit below 1 HP.';

/** "A", "A or B", "A, B or C". */
export function orList(items) {
  const list = (items || []).filter(Boolean).map(String);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`;
}

const FORGE_WORDS = Object.freeze({ might: 'Might', crit: 'Crit', hit: 'Hit', weight: 'Wt' });
const forgeStep = (stat) => `${signed(Number(FORGE_BONUSES[stat]) || 0)} ${FORGE_WORDS[stat]}`;
const FORGE_STATS = Object.freeze(['might', 'hit', 'crit', 'weight']);
/** One wear step is the negation of a forge step of its stat (WeaponWear.js). */
const wearStep = (stat) => `${signed(-(Number(FORGE_BONUSES[stat]) || 0))} ${FORGE_WORDS[stat]}`;

/** Who an `hp` effect's scope reaches, as a singular subject. */
const HP_SUBJECTS = Object.freeze({
  target: 'Chosen unit',
  all: 'Each unit',
  commander: 'Your commander',
  randomUnit: 'A random unit',
});

/** Who a `stat` effect's scope reaches. */
const STAT_SUBJECTS = Object.freeze({
  target: 'Chosen unit',
  lowestLevel: 'Your lowest-level unit',
});

function skillName(gameData, id) {
  return (gameData?.skills || []).find((skill) => skill?.id === id)?.name || String(id || '');
}

function blessingOf(gameData, id) {
  return (gameData?.blessings?.blessings || []).find((b) => b?.id === id) || null;
}

/**
 * One effect as { text, details } ('' text for an effect that says nothing to the player).
 * @param {object} effect - an event effect definition (events.json), never a result record
 * @param {object} ctx - { run, catalog, event, state, choice }
 */
export function effectPreview(effect, ctx) {
  const { run, catalog, event, state } = ctx;
  const gameData = run?.gameData;
  const act = run?.currentAct;
  const say = (text, details = []) => ({ text, details: details.filter(Boolean) });
  switch (effect?.type) {
    case 'gold': {
      if (effect.refund === true) return say('Your gold back');
      const value = resolveAmount(effect.value, act);
      return value ? say(`${signed(value)} G`) : say('');
    }
    case 'item': {
      if (effect.pool?.kind === 'accessory') {
        const table = actLabel(accessoryTableActFor(run, effect.pool.tierOffset));
        return say(`An accessory${table ? ` from ${table} loot` : ''}`);
      }
      if (effect.pool) {
        const tier = eventWeaponTier(act, effect.pool.tierOffset);
        const steps = Math.max(0, num(effect.wear));
        const who =
          effect.pool.weaponTypes === '$target' ? 'for the chosen unit' : 'someone can use';
        const weapon = steps > 0 ? `A worn ${tier} weapon` : `${withArticle(tier)} weapon`;
        const worn = steps > 0 ? ` (${steps} wear ${steps === 1 ? 'step' : 'steps'})` : '';
        return say(`${upper(weapon)} ${who}${worn}`);
      }
      return say(effect.name ? upper(withArticle(effect.name)) : '');
    }
    case 'learnSkill': {
      if (typeof effect.skillId === 'string')
        return say(`Chosen unit learns ${skillName(gameData, effect.skillId)}`);
      if (Array.isArray(effect.pool))
        return say(
          `Chosen unit learns one of: ${orList(effect.pool.map((id) => skillName(gameData, id)))}`,
        );
      const types = Object.keys(effect.poolByType || {}).map((t) => t.toLowerCase());
      return say(`Chosen unit learns ${withArticle(orList(types))} skill (by their weapon)`);
    }
    case 'fallenSkill':
      return say(`Chosen unit learns one of ${state?.fallen?.name || 'the fallen'}'s skills`);
    case 'hp': {
      const who = HP_SUBJECTS[effect.scope] || 'A unit';
      if (effect.mode !== 'heal' && Number.isFinite(Number(effect.to)))
        return say(`${who} drops to ${Math.max(1, num(effect.to))} HP`);
      const percent = Number(byRungValue(effect.percentByRung, run?.difficultyId, effect.percent));
      const amount = Number.isFinite(Number(effect.value))
        ? `${Math.abs(num(effect.value))} HP`
        : Number.isFinite(percent)
          ? `${percent}% of max HP`
          : 'to full HP';
      if (effect.mode === 'heal')
        return say(amount === 'to full HP' ? `${who} heals to full` : `${who} heals ${amount}`);
      return say(`${who} loses ${amount}`, [NEVER_FATAL]);
    }
    case 'shadow': {
      const value = num(effect.value);
      if (!value || !run?.isEclipseActive?.()) return say('');
      return say(`${signed(value)} shadow`);
    }
    case 'vision': {
      const value = num(effect.value);
      return value ? say(`${signed(value)} Vision`) : say('');
    }
    case 'rite': {
      // The court circle's words (engine/Rite.js): "The rite: −1 word", "The rite: +2 words".
      const delta = num(effect.delta);
      return delta
        ? say(`The rite: ${signed(delta)} ${Math.abs(delta) === 1 ? 'word' : 'words'}`)
        : say('');
    }
    case 'blessing': {
      const tier = romanNumeral(effect.tier);
      return say(`A random ${tier ? `Tier ${tier} ` : ''}blessing`);
    }
    case 'earnedBlessing': {
      const blessing = blessingOf(gameData, effect.id);
      return say(`Earned blessing: ${blessing?.name || effect.id}`, [blessing?.description]);
    }
    case 'burden': {
      const params = { ...(effect.params || {}) };
      if (params.owed !== undefined) params.owed = resolveAmount(params.owed, act);
      const words = burdenPreview(effect.id, params, {
        catalog,
        difficultyId: run?.difficultyId,
      });
      // A Debt names what it owes in the line itself: two outcomes owing different sums differ.
      const owed = effect.id === 'debt' && params.owed > 0 ? ` (${params.owed} G)` : '';
      return say(`Burden: ${words.label}${owed}`, [`${words.label}: ${upper(words.detail)}.`]);
    }
    case 'layToRest':
      return say(`${state?.fallen?.name || 'The fallen'} is laid to rest (can never be revived)`);
    case 'consume': {
      const uses = Math.max(1, num(effect.uses) || 1);
      return say(`Spends ${uses === 1 ? 'a use' : `${uses} uses`} of ${effect.name}`);
    }
    case 'stat': {
      const who = STAT_SUBJECTS[effect.scope] || 'Chosen unit';
      const value = num(effect.value);
      const stats = Array.isArray(effect.stat) ? effect.stat : [effect.stat];
      const stat =
        stats.length === 1 && stats[0] === 'best'
          ? 'to their highest stat'
          : orList(stats.map((s) => (s === 'HP' ? 'max HP' : s)));
      if (value >= 0) return say(`${who} gains +${value} ${stat}`);
      return say(`${who} loses ${Math.abs(value)} ${stat}`);
    }
    case 'counter': {
      const delta = num(effect.delta);
      return delta ? say(`${counterLabel(event, effect.key)} ${signed(delta)}`) : say('');
    }
    case 'join': {
      const classes = effect.class ? [effect.class] : effect.classPool || [];
      return say(`${upper(withArticle(orList(classes) || 'stranger'))} joins the army`);
    }
    case 'contract': {
      const goal = CONTRACT_GOAL_LINES[effect.goal];
      const terms = (list) =>
        (list || [])
          .map((e) => {
            // A burden reads by its name here ("Debt (350 G)"): the clause already says it is the cost.
            const text = effectPreview(e, ctx).text;
            return e?.type === 'burden' ? text.replace(/^Burden: /, '') : lower(text);
          })
          .filter(Boolean)
          .join(', ');
      const kept = terms(effect.reward);
      const broken = terms(effect.penalty);
      const burdenNotes = (effect.penalty || [])
        .filter((e) => e?.type === 'burden')
        .flatMap((e) => effectPreview(e, ctx).details);
      return say(`Contract: ${goal?.short || 'next battle'}`, [
        goal?.line || '',
        [kept ? `If kept: ${kept}.` : '', broken ? `If broken: ${broken}.` : ''].join(' ').trim(),
        ...burdenNotes,
      ]);
    }
    case 'routeEdit':
      return effect.op === 'addRoad'
        ? say('A new road opens from here')
        : say(`A place ahead becomes ${withArticle(placeName(effect.toType))}`);
    case 'forge': {
      const stat = effect.stat && effect.stat !== 'random' ? effect.stat : null;
      return say(
        stat
          ? `Chosen unit's equipped weapon gets a free forge: ${forgeStep(stat)}`
          : `Chosen unit's equipped weapon gets a free forge on a random stat`,
        stat ? [] : [`One of ${orList(FORGE_STATS.map(forgeStep))}.`],
      );
    }
    case 'wear':
      return say(`Chosen unit's equipped weapon takes a wear step`, [
        `A wear step is one of ${orList(FORGE_STATS.map(wearStep))}; a smith or a village forge repairs it.`,
      ]);
    case 'mend':
      return say('Repairs every worn weapon the chosen unit carries');
    case 'battle': {
      const bonus = num(effect.enemyLevelBonus);
      const fight = `${effect.elite === true ? 'An elite fight' : 'A fight'}${
        bonus > 0 ? ` (foes +${bonus} ${bonus === 1 ? 'level' : 'levels'})` : ''
      }`;
      const recruit = effect.recruit
        ? `${withArticle(orList(effect.recruit.class ? [effect.recruit.class] : effect.recruit.classPool || []) || 'stranger')} to Talk into joining`
        : '';
      const spoils = (effect.afterVictory || []).map((e) => effectPreview(e, ctx));
      const won = spoils.map((s) => lower(s.text)).filter(Boolean);
      return say(
        [fight, recruit, won.length ? `win: ${won.join(', ')}` : ''].filter(Boolean).join(' · '),
        spoils.flatMap((s) => s.details),
      );
    }
    default:
      // flag: the story's memory, not news.
      return say('');
  }
}

/** A list of effects as one phrase ('' when none says anything) and their details. */
function effectsPreview(effects, ctx) {
  const parts = (effects || []).map((effect) => effectPreview(effect, ctx));
  return {
    text: parts
      .map((p) => p.text)
      .filter(Boolean)
      .join(' · '),
    details: parts.flatMap((p) => p.details),
  };
}

/**
 * When an outcome's fallback stands in (EventCommands: an effect that has nothing to work on),
 * in the words of the effect that comes up empty.
 */
function fallbackCondition(effects) {
  for (const effect of effects || []) {
    if (effect?.type === 'learnSkill' || effect?.type === 'fallenSkill')
      return 'if nothing is left to learn';
    if (effect?.type === 'routeEdit')
      return effect.op === 'addRoad' ? 'if no road can be added' : 'if no place ahead can change';
    if (effect?.type === 'wear') return "if the weapon can't wear";
    if (effect?.type === 'forge') return "if the weapon can't take more";
    if (effect?.type === 'mend') return 'if nothing is worn';
  }
  return "if that can't happen";
}

/**
 * An outcome's fallback as its bracket ("if nothing is left to learn: each unit heals 20% of max
 * HP"; "…: just a Steel weapon for the chosen unit" when it is only part of what the outcome
 * gives). Null for an empty fallback (nothing happens instead: the outcome's line already reads
 * as what it can do at most).
 */
function fallbackPreview(outcome, ctx) {
  const fallback = (outcome.fallback || []).map((effect) => effectPreview(effect, ctx));
  const parts = fallback.map((p) => p.text).filter(Boolean);
  if (!parts.length) return null;
  const main = new Set((outcome.effects || []).map((effect) => effectPreview(effect, ctx).text));
  const subset = parts.every((part) => main.has(part));
  const what = lower(parts.join(' · '));
  return {
    text: `${fallbackCondition(outcome.effects)}: ${subset ? `just ${what}` : what}`,
    details: fallback.flatMap((p) => p.details),
  };
}

const NOTHING = 'Nothing happens';
const GOES_ON = 'more choices follow';

/**
 * Whole percentages for weights, summing to exactly 100 (largest remainder; ties go to the
 * earlier entry). A lone weight is 100.
 */
export function percentShares(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return weights.map(() => 0);
  const exact = weights.map((w) => (w / total) * 100);
  const shares = exact.map(Math.floor);
  let left = 100 - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--)
    shares[order[k].i]++;
  return shares;
}

/** One outcome as a line's text and details. */
function outcomePreview(outcome, ctx, { alone }) {
  const main = effectsPreview(outcome?.effects, ctx);
  const opensBattle = (outcome?.effects || []).some((e) => e?.type === 'battle');
  const next = typeof outcome?.next === 'string' && outcome.next && !opensBattle;
  let text = [main.text, next ? (main.text ? GOES_ON : upper(GOES_ON)) : '']
    .filter(Boolean)
    .join(' · ');
  if (!text && alone) return null;
  if (!text) text = NOTHING;
  const fallback = Array.isArray(outcome?.fallback) ? fallbackPreview(outcome, ctx) : null;
  if (fallback?.text) text = `${text} (${fallback.text})`;
  return { text, details: [...main.details, ...(fallback?.details || [])] };
}

/** "the chosen unit's SKL + SPD" / "your army's best LCK". */
function checkWords(check) {
  const stats = (check?.stats || []).join(' + ');
  return check?.of === 'bestInArmy'
    ? `your army's best ${stats} (higher is better)`
    : `the chosen unit's ${stats} (higher is better)`;
}

/**
 * What a choice can do, as lines (see the header). Empty for a choice that does nothing
 * besides its price (a toll paid, leaving).
 * @param {object} run - RunManager
 * @param {object} choice - the choice's definition (the face and page in play)
 * @param {{ catalog?: object, event?: object, state?: object }} [context]
 * @returns {{ lead: string, text: string, details: string[] }[]}
 */
export function choicePreview(run, choice, { catalog = null, event = null, state = null } = {}) {
  if (!choice) return [];
  const ctx = { run, catalog: catalog || run?.gameData?.events || null, event, state, choice };
  const lines = [];
  const push = (lead, entry) => {
    if (!entry) return;
    const details = [...new Set(entry.details.filter(Boolean))];
    lines.push({ lead, text: entry.text, details });
  };
  const own = effectsPreview(choice.effects, ctx);
  if (own.text) push('', own);
  const outcomes = Array.isArray(choice.outcomes) ? choice.outcomes : [];
  if (choice.check) {
    lines.push({ lead: 'Test', text: upper(checkWords(choice.check)), details: [] });
    for (const id of ['pass', 'fail']) {
      const outcome = outcomes.find((o) => o?.id === id);
      if (outcome)
        push(id === 'pass' ? 'Pass' : 'Fail', outcomePreview(outcome, ctx, { alone: false }));
    }
    return lines;
  }
  const possible = outcomes.filter((outcome) => outcomeWeight(run, outcome) > 0);
  const alone = possible.length <= 1;
  const entries = [];
  const seen = new Map();
  for (const outcome of possible) {
    const entry = outcomePreview(outcome, ctx, { alone });
    const key = entry ? `${entry.text}\n${entry.details.join('\n')}` : '';
    if (!entry) continue;
    // Outcomes that read the same are one line, and their chances add.
    if (seen.has(key)) {
      seen.get(key).weight += outcomeWeight(run, outcome);
      continue;
    }
    const merged = { ...entry, weight: outcomeWeight(run, outcome) };
    seen.set(key, merged);
    entries.push(merged);
  }
  // One outcome is simply what the choice does; several lead with their chance.
  if (entries.length === 1) push('', entries[0]);
  else {
    const shares = percentShares(entries.map((entry) => entry.weight));
    entries.forEach((entry, index) => push(`${shares[index]}%`, entry));
  }
  return lines;
}

/** The preview as one plain paragraph (the confirmation's words, a screen reader's). */
export function choicePreviewText(lines) {
  return (lines || []).map((line) => `${line.lead ? `${line.lead}: ` : ''}${line.text}.`).join(' ');
}
