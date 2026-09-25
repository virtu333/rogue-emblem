// Rewind destinations as the player thinks about them: "Before <unit>'s
// <action>". Pure: reads a hydrated BattleTimeline and returns display rows.
//
// The timeline stores the settled state AFTER each completed player action
// (and at each player-turn start). The state immediately before an action is
// therefore the previous settled point, and each destination is labelled by
// the first thing that happened after it. A destination is never the live
// state itself ("you are here") and never a point where the enemy phase is
// already committed to start.

import { canRewindToEntry, resolveRewindGranularity } from './BattleTimeline.js';

/** Beat types recorded by observeHistoryAction, mapped to one action noun. */
const VERBS = {
  attacked: 'attack',
  healed: 'heal',
  cured: 'cure',
  relocated: 'warp',
  rallied: 'rally',
  rooted: 'ensnare',
  'danced for': 'dance',
  refreshed: 'refresh',
  shoved: 'shove',
  pulled: 'pull',
  'swapped with': 'swap',
  'traded with': 'trade',
  used: 'item',
  escaped: 'escape',
  'visited the village': 'visit',
  'captured a ballista': 'ballista',
  recruited: 'talk',
  promoted: 'promotion',
  reclassed: 'reclass',
  'broke terrain': 'break',
  'created terrain': 'terrain',
  waited: 'wait',
  'finished their action': 'wait',
  'changed equipment': 'equip',
};
// When one activation contains several beats, the most consequential names it.
const PRIORITY = [
  'attack',
  'heal',
  'cure',
  'warp',
  'rally',
  'ensnare',
  'dance',
  'refresh',
  'shove',
  'pull',
  'swap',
  'talk',
  'promotion',
  'reclass',
  'ballista',
  'visit',
  'escape',
  'break',
  'terrain',
  'item',
  'trade',
  'equip',
  'wait',
];
export const ACTION_NOUNS = Object.freeze({
  attack: 'attack',
  heal: 'heal',
  cure: 'cure',
  warp: 'staff',
  rally: 'rally',
  ensnare: 'ensnare',
  dance: 'dance',
  refresh: 'gambit',
  shove: 'shove',
  pull: 'pull',
  swap: 'swap',
  trade: 'trade',
  item: 'item',
  escape: 'escape',
  visit: 'village visit',
  ballista: 'ballista',
  talk: 'talk',
  promotion: 'promotion',
  reclass: 'reclass',
  break: 'wall break',
  terrain: 'terrain',
  wait: 'wait',
  equip: 'equipment change',
  move: 'move',
  endTurn: 'end turn',
});
const text = (value, max = 64) => (typeof value === 'string' ? value.slice(0, max) : '');
const detailOf = (label) => {
  const match = /· (.+)\.$/.exec(String(label || ''));
  return match ? match[1].slice(0, 64) : '';
};

/**
 * Structured summary of one player activation from its visibility-filtered
 * history beats. Returns a plain fact for the timeline, or null.
 * @param {Array} beats scene._historyBeats at record time
 * @param {string|null} actorId the acting unit's battleEntityId
 * @param {(id: string) => {name?: string, className?: string}|null} lookup
 */
export function summarizeActionFact(beats, actorId, lookup = () => null) {
  if (!actorId || !Array.isArray(beats)) return null;
  const actor = lookup(actorId);
  if (!actor?.name) return null;
  let verb = null;
  let primary = null;
  let moved = false;
  const outcome = { hits: 0, misses: 0, crits: 0, damage: 0, taken: 0, healed: 0 };
  const ko = [];
  let fell = false;
  for (const beat of beats) {
    if (!beat || typeof beat.type !== 'string') continue;
    if (beat.type === 'moved' && beat.actorId === actorId) moved = true;
    const noun = VERBS[beat.type];
    if (noun && beat.actorId === actorId) {
      if (!verb || PRIORITY.indexOf(noun) < PRIORITY.indexOf(verb)) {
        verb = noun;
        primary = beat;
      }
      if (noun === 'heal' && Number.isFinite(beat.outcome?.amount))
        outcome.healed += beat.outcome.amount;
    }
    if (['hit', 'missed', 'critically hit'].includes(beat.type) && beat.outcome) {
      if (beat.actorId === actorId) {
        if (beat.outcome.miss) outcome.misses++;
        else {
          outcome.hits++;
          if (beat.outcome.critical) outcome.crits++;
          outcome.damage += Number(beat.outcome.damage) || 0;
        }
      } else if (beat.targetId === actorId && !beat.outcome.miss)
        outcome.taken += Number(beat.outcome.damage) || 0;
    }
    if (beat.type === 'defeated' && beat.actorId === actorId && beat.targetId) {
      const name = lookup(beat.targetId)?.name;
      if (name && ko.length < 4) ko.push(text(name));
    }
    if (
      (beat.type === 'defeated' && beat.targetId === actorId) ||
      (beat.type === 'fell' && beat.actorId === actorId)
    )
      fell = true;
  }
  if (!verb) verb = moved ? 'move' : null;
  if (!verb) return null;
  if (verb === 'wait' && moved) verb = 'move';
  const target = primary?.targetId ? lookup(primary.targetId) : null;
  const fact = {
    type: 'action',
    actorId,
    actor: text(actor.name),
    verb,
  };
  if (actor.className) fact.className = text(actor.className);
  if (target?.name) {
    fact.target = text(target.name);
    fact.targetId = primary.targetId;
  }
  const detail = detailOf(primary?.label);
  if (detail && !['heal'].includes(verb)) fact.detail = detail;
  const kept = Object.fromEntries(Object.entries(outcome).filter(([, v]) => v > 0));
  if (Object.keys(kept).length) fact.outcome = kept;
  if (ko.length) fact.ko = ko;
  if (fell) fact.fell = true;
  return fact;
}

/** Primary action fact of a timeline entry (fragments merge several). */
export function entryActionFact(entry) {
  const facts = (entry?.facts || []).filter((f) => f && f.type === 'action' && f.verb);
  if (!facts.length) return null;
  return facts.reduce((best, fact) => {
    const rank = (f) => (PRIORITY.includes(f.verb) ? PRIORITY.indexOf(f.verb) : PRIORITY.length);
    return rank(fact) < rank(best) ? fact : best;
  });
}

const possessive = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** Short outcome chips for an action fact: e.g. ["Missed"], ["Hit 7", "KO"]. */
export function actionOutcomeChips(fact) {
  if (!fact) return [];
  const chips = [];
  const o = fact.outcome || {};
  if (fact.verb === 'attack') {
    if (o.hits || o.misses) {
      if (!o.hits) chips.push({ text: 'Missed', tone: 'miss' });
      else
        chips.push({
          text: `${o.crits ? 'Crit' : 'Hit'} ${o.damage ? o.damage : '· no dmg'}${o.misses ? ` · ${o.misses} miss` : ''}`,
          tone: o.crits ? 'crit' : 'hit',
        });
    }
    if (o.taken) chips.push({ text: `Took ${o.taken}`, tone: 'taken' });
  }
  if (o.healed) chips.push({ text: `+${o.healed} HP`, tone: 'heal' });
  if (fact.ko?.length) chips.push({ text: 'KO', tone: 'ko' });
  if (fact.fell) chips.push({ text: 'Fell', tone: 'fell' });
  return chips;
}

/** "Before Edric’s attack on Knight" (never includes hidden information). */
export function describeBefore(fact, fallbackTitle = '') {
  if (!fact) {
    const fell = /^(.+) fell$/.exec(fallbackTitle);
    if (fell) return `Before ${fell[1]} fell`;
    return fallbackTitle ? `Before: ${fallbackTitle}` : 'Before the next action';
  }
  // The thing used names the action when it is known: an art, staff, item
  // or ability ("Before Edric’s Wrath Strike on Knight").
  const named = ['attack', 'warp', 'item', 'rally'].includes(fact.verb) && fact.detail;
  const noun = named ? fact.detail : ACTION_NOUNS[fact.verb] || fact.verb;
  const target =
    fact.target &&
    !['wait', 'move', 'escape', 'visit', 'item', 'rally', 'promotion', 'reclass'].includes(
      fact.verb,
    )
      ? ` ${['trade', 'swap'].includes(fact.verb) ? 'with' : 'on'} ${fact.target}`
      : '';
  const detail =
    ['promotion', 'reclass'].includes(fact.verb) && fact.detail ? ` (${fact.detail})` : '';
  return `Before ${possessive(fact.actor)} ${noun}${target}${detail}`;
}

function nextEvent(entries, index) {
  for (let i = index + 1; i < entries.length; i++) {
    if (entries[i].kind !== 'rewind') return entries[i];
  }
  return null;
}

function stringFacts(entry) {
  return (entry?.facts || []).filter((f) => typeof f === 'string');
}
const GENERIC =
  /^(player turn begins|player action completed|enemy action completed|action resolved|battle update)\.?$/i;
function fallbackTitle(entry) {
  const facts = stringFacts(entry).filter((f) => !GENERIC.test(f.trim()));
  return (facts.find((f) => / fell\.$| defeated /.test(f)) || facts[0] || '').replace(/\.$/, '');
}

/**
 * Display rows for the rewind picker, newest first.
 * @param {object} history hydrated BattleTimeline
 * @param {{ currentEntryId?: number|null, difficulty?: string, granularity?: string }} options
 * @returns {{ rows: Array, currentTurn: number, granularity: string, earlierUnavailable: boolean }}
 */
export function listRewindDestinations(
  history,
  { currentEntryId = null, difficulty = 'normal', granularity = undefined } = {},
) {
  const entries = Array.isArray(history?.entries) ? history.entries : [];
  const resolved = resolveRewindGranularity(difficulty, granularity);
  const rows = [];
  const currentTurn = entries.at(-1)?.turnNumber || history?.currentTurn || 1;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.phase !== 'player' || !['turn_start', 'player_action'].includes(entry.kind)) continue;
    const next = nextEvent(entries, index);
    // The live state is not a destination ("you are here").
    if (!next || entry.id === currentEntryId) continue;
    // Enemies move next from here: returning would only replay the enemy phase.
    if (entry.preview?.enemiesActNext || next.phase === 'enemy') continue;
    if (next.turnNumber !== entry.turnNumber) continue;
    // A re-recorded turn start (e.g. after an interrupted turn-start) supersedes this one.
    if (next.kind === 'turn_start' && next.destination) continue;
    const fact = entryActionFact(next);
    const endTurn = !fact && stringFacts(next).some((f) => /^End Turn\./.test(f));
    const stored = Boolean(entry.destination && entry.snapshotId);
    const eligible = canRewindToEntry(history, entry.id, {
      difficulty,
      granularity: resolved,
      allowPlayerActions: true,
    });
    let reason = '';
    if (!eligible)
      reason = !stored
        ? 'Too far back. This moment is no longer stored.'
        : resolved === 'turn' && entry.kind !== 'turn_start'
          ? 'Turn starts only on this difficulty.'
          : 'This moment cannot be restored.';
    rows.push({
      id: entry.id,
      turnNumber: entry.turnNumber,
      kind: entry.kind === 'turn_start' ? 'turn_start' : 'action',
      title: endTurn ? 'Before ending the turn' : describeBefore(fact, fallbackTitle(next)),
      turnStart: entry.kind === 'turn_start',
      action: fact
        ? {
            actor: fact.actor,
            actorId: fact.actorId,
            className: fact.className || '',
            verb: fact.verb,
            target: fact.target || '',
            detail: fact.detail || '',
          }
        : null,
      chips: actionOutcomeChips(fact),
      nextEntryId: next.id,
      available: eligible,
      reason,
      currentTurn: entry.turnNumber === currentTurn,
    });
  }
  rows.reverse();
  return {
    rows,
    currentTurn,
    granularity: resolved,
    earlierUnavailable: Boolean(history?.earlierHistoryUnavailable),
  };
}

/** Rewind granularity for a run: difficulty data first, then the difficulty's default. */
export function rewindGranularityForRun(run) {
  const configured = run?.difficultyModifiers?.rewindGranularity;
  return resolveRewindGranularity(run?.difficultyId || 'normal', configured);
}
