// eventMenuModel.js — the words of the Event page (docs/specs/event-nodes.md §10), as
// plain data. Pure: no Phaser, no DOM, no randomness, no game rules. The engine
// (EventCommands / EventEffects) decides what happened and hands back plain result
// records; this file only says them, one line per record, so the menu can draw a line
// with a chip, a tone and a detail without knowing what a "shadow" is. The words of one
// record are `engine/EventResultWords.describeResult` (shared with the contract band); this
// file adds the chip and the kind.
//
// Result records it reads are listed in src/engine/EventEffects.js. Records that are
// bookkeeping rather than news (`flag`, `battle`) draw no line: the Fight button already
// says a fight is owed, and a story flag is the story's own memory.

import { describeBurdens } from '../engine/Burdens.js';
import { describeContract, describeOwedContract } from '../engine/Contracts.js';
import { describeResult, num, plural, sentence, wornText } from '../engine/EventResultWords.js';

// The words of a result record live in the engine (EventResultWords), shared with the
// contract's victory band; these two are re-exported for the pages that already import them.
export { sentence, wornText };

/** Every chip the page can wear, by result kind (short pixel words; the line says the rest). */
export const RESULT_CHIPS = Object.freeze({
  gold: 'GOLD',
  item: 'ITEM',
  skill: 'SKILL',
  hp: 'HP',
  shadow: 'SHADOW',
  vision: 'VISION',
  blessing: 'BLESSING',
  burden: 'BURDEN',
  layToRest: 'CAIRN',
  consume: 'USED',
  stat: 'STAT',
  note: 'NOTE',
  counter: 'COUNT',
  join: 'JOIN',
  contract: 'CONTRACT',
  route: 'ROAD',
  forge: 'FORGE',
  wear: 'WEAR',
  mend: 'MEND',
});

/** "150 G" for a gold cost (the seal on a choice), '' for a free one. */
export function eventCostSeal(cost) {
  const n = num(cost);
  return n > 0 ? `${n} G` : '';
}

/**
 * What a battle record says on the Fight page, as plain sentences (the record itself is
 * bookkeeping and draws no result line): an elite fight, a recruit to be talked into joining.
 * @param {object[]} results
 * @returns {string[]}
 */
export function eventBattleNotes(results) {
  const notes = [];
  for (const record of Array.isArray(results) ? results : []) {
    if (record?.kind !== 'battle') continue;
    if (record.elite === true) notes.push('An elite fight: harder foes, better spoils.');
    if (record.recruit && typeof record.recruit === 'object') {
      const who = record.recruit.name || `A ${record.recruit.className || 'stranger'}`;
      notes.push(`${who} fights among them. Reach them with a lord and Talk to bring them in.`);
    }
  }
  return notes;
}

/**
 * One line per result record: [{ kind, chip, tone, text, detail?, item?, unit? }]. `tone` is
 * 'good' | 'bad' | 'plain' (the result's colour), `item` the subject for an item icon, `unit` the
 * unit whose face leads a join line ({ uid, name }).
 * Records that say nothing to the player are dropped.
 * @param {object[]} results - EventCommands result records
 * @param {{ gameData?: object }} [context]
 */
export function eventResultLines(results, { gameData = null } = {}) {
  const lines = [];
  for (const record of Array.isArray(results) ? results : []) {
    const line = describeResult(record, { gameData });
    if (line) lines.push({ kind: record.kind, chip: RESULT_CHIPS[record.kind] || '', ...line });
  }
  return lines;
}

/** The header button's word for a page (Close keeps the event open; Continue leaves it). */
export function eventCloseLabel(view) {
  if (!view) return 'Close';
  if (view.spoilsOwed) return 'Back to map';
  return view.phase === 'choosing' || view.canFight ? 'Close' : 'Continue';
}

/** The picker's confirm word for a choice: its price when it has one. */
export function eventConfirmLabel(choice) {
  const seal = eventCostSeal(choice?.cost);
  return seal ? `Choose · ${seal}` : 'Choose';
}

/** A target row's second line in the picker: class and level, the reason when it is greyed. */
export function eventTargetLine(candidate) {
  if (candidate?.ok === false) return candidate.reason || '';
  const unit = candidate?.unit;
  if (!unit) return '';
  const level = unit.level != null ? `Lv ${unit.level}` : '';
  return [unit.className, level].filter(Boolean).join(' · ');
}

// ── Pages: the trail, the counters, the tells ──────────────────────────────

/** "1 step", "3 steps". */
const stepsWord = (n) => `${n} ${plural(n, 'step')}`;

/** "You chose: Go deeper · Hale": the line over one finished step. */
export function eventChosenLine(step) {
  const who = step?.targetName ? ` · ${step.targetName}` : '';
  return `You chose: ${step?.choiceLabel || 'something'}${who}`;
}

/**
 * The trail of earlier steps, as the page draws it: the steps the player has not just
 * taken sit behind a toggle (collapsed), and the one just taken (`justNow`) is told in full
 * above the new page, so no step's news is ever only a tap away.
 * @param {object[]} trail - eventView().trail
 * @param {{ justNow?: boolean, gameData?: object }} [options] - `justNow`: the last step
 *   was taken in this sitting, on the page before the one now showing
 * @returns {{ steps: object[], recent: object|null, toggle: string }} each step:
 *   { page, chosen, text, lines }; `toggle` the closed disclosure's words ('' for none)
 */
export function eventTrailModel(trail, { justNow = false, gameData = null } = {}) {
  const list = Array.isArray(trail) ? trail : [];
  const shape = (step) => ({
    page: step.page,
    chosen: eventChosenLine(step),
    text: step.text || '',
    lines: eventResultLines(step.results, { gameData }),
  });
  const recent = justNow && list.length ? shape(list[list.length - 1]) : null;
  const steps = (recent ? list.slice(0, -1) : list).map(shape);
  return {
    steps,
    recent,
    toggle: steps.length ? `Earlier on this road · ${stepsWord(steps.length)}` : '',
  };
}

/**
 * A counter as the page shows it: "Torches 2/3" and a pip per point of its starting value,
 * lit while it lasts. A counter that grew past its start lights every pip it has.
 * @param {{ key: string, label: string, value: number, max: number }} counter
 */
export function eventCounterModel(counter) {
  const value = Math.max(0, num(counter?.value));
  const max = Math.max(value, num(counter?.max));
  const label = String(counter?.label || counter?.key || 'Counter');
  return {
    key: counter?.key || '',
    label,
    text: `${label} ${value}/${max}`,
    speech: `${label}: ${value} of ${max}`,
    value,
    max,
    // A long counter stays readable as a number: pips only while they fit a line.
    pips: max <= 8 ? Array.from({ length: max }, (_, i) => i < value) : [],
    empty: value === 0,
  };
}

/**
 * A roster tell under a choice: the voice's line, and the name to show beside the face when
 * the line does not already say who is speaking (the engine fills `{name}` into the line).
 * @param {{ speaker?: { uid?: string, name?: string }, line?: string }} tell
 * @returns {{ uid: string|null, name: string, line: string, caption: string }|null}
 */
export function eventTellModel(tell) {
  const line = String(tell?.line ?? '').trim();
  const name = String(tell?.speaker?.name ?? '').trim();
  if (!line) return null;
  return {
    uid: tell.speaker?.uid || null,
    name,
    line,
    caption: name && !line.includes(name) ? name : '',
  };
}

/**
 * What a page says when its commit found the page had moved on (a second tap, another
 * window): it re-reads itself and tells the player to look again.
 */
export const PAGE_MOVED_ON_LINE = 'The page has moved on. Choose again.';

// ── The route an event changed ─────────────────────────────────────────────

/**
 * What the route map should show of an event's route edits (the `route` result records): the
 * nodes to ring ({ nodeIds }) and the one line that says it ({ text }). Empty for no edit.
 * @param {object[]} results - EventCommands result records
 * @returns {{ nodeIds: string[], text: string }}
 */
export function routeChangeModel(results) {
  const nodeIds = [];
  let road = false;
  let place = false;
  for (const record of Array.isArray(results) ? results : []) {
    if (record?.kind !== 'route') continue;
    const id = record.op === 'addRoad' ? record.to : record.node;
    if (typeof id === 'string' && id && !nodeIds.includes(id)) nodeIds.push(id);
    if (record.op === 'addRoad') road = true;
    else place = true;
  }
  const text =
    road && place
      ? 'A new road opens, and a place ahead has changed.'
      : road
        ? 'A new road opens ahead.'
        : place
          ? 'A place ahead has changed.'
          : '';
  return { nodeIds, text };
}

// ── The open contract (the route map's chip, the pause list) ───────────────

/**
 * The words of an open contract (Contracts.describeContract): the chip's name and figure, and
 * the full terms for its tap line, title and the pause list.
 * @param {object|null} contract - describeContract(run)
 * @returns {{ id: 'contract', label: string, short: string, line: string, detail: string,
 *   terms: string }|null} `terms`: the goal, what keeping it pays and what breaking it costs
 */
export function contractChipModel(contract) {
  if (!contract) return null;
  const kept = (contract.reward || []).filter(Boolean);
  const broken = (contract.penalty || []).filter(Boolean);
  const detail = [
    kept.length ? `Kept: ${kept.join(', ')}.` : '',
    broken.length ? `Broken: ${broken.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    id: 'contract',
    label: contract.label || 'Contract',
    short: contract.short || '',
    line: sentence(contract.line),
    detail,
    terms: [sentence(contract.line), detail].filter(Boolean).join(' '),
  };
}

/**
 * The words of a contract settlement that is earned and not yet delivered
 * (Contracts.describeOwedContract), for the route map's chip and the pause list: it reads
 * "Reward waiting" (or "Penalty waiting") and the terms say what is owed and why it waits.
 * @param {object|null} owed - describeOwedContract(run)
 * @returns {{ id: 'contract', owed: true, label: string, short: string, line: string,
 *   detail: string, terms: string }|null}
 */
export function owedContractChipModel(owed) {
  if (!owed) return null;
  const what = owed.owed.length
    ? `${owed.kept ? 'Owed' : 'To be applied'}: ${owed.owed.join(', ')}.`
    : '';
  const line = owed.kept
    ? 'The contract was kept and its reward is not delivered yet.'
    : 'The contract was broken and its penalty is not applied yet.';
  const detail = [what, sentence(owed.reason)].filter(Boolean).join(' ');
  return {
    id: 'contract',
    owed: true,
    label: owed.label || 'Contract',
    short: owed.short || '',
    line,
    detail,
    terms: [line, detail].filter(Boolean).join(' '),
  };
}

/**
 * The pause menu's list of what weighs on the run: every burden (Burdens.describeBurdens) and the
 * open contract, each { id, label, short, line?, detail?, text? } (`text` replaces `line detail.`).
 * @param {object} run - RunManager
 * @param {object} [catalog] - the events catalog (burden definitions)
 */
export function pauseBurdenEntries(run, catalog = null) {
  const burdens = describeBurdens(run, catalog);
  const contract =
    contractChipModel(describeContract(run)) || owedContractChipModel(describeOwedContract(run));
  return contract
    ? [
        ...burdens,
        { id: 'contract', label: contract.label, short: contract.short, text: contract.terms },
      ]
    : burdens;
}
