// eventMenuModel.js — the words of the Event page (docs/specs/event-nodes.md §10), as
// plain data. Pure: no Phaser, no DOM, no randomness, no game rules. The engine
// (EventCommands / EventEffects) decides what happened and hands back plain result
// records; this file only says them, one line per record, so the menu can draw a line
// with a chip, a tone and a detail without knowing what a "shadow" is.
//
// Result records it reads are listed in src/engine/EventEffects.js. Records that are
// bookkeeping rather than news (`flag`, `battle`) draw no line: the Fight button already
// says a fight is owed, and a story flag is the story's own memory.

import { wearDisplay } from '../engine/WeaponWear.js';
import { describeBurdens } from '../engine/Burdens.js';
import { describeContract } from '../engine/Contracts.js';

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
});

const MINUS = '−';
const num = (value) => Math.trunc(Number(value) || 0);
const signed = (n) => (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`);
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

/** One clause as a sentence: first letter up, a full stop at the end (none doubled). */
export function sentence(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const up = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(up) ? up : `${up}.`;
}

/** What a route node is called on the map (the loom's own words: a shop is a Village). */
const ROUTE_PLACE = Object.freeze({
  battle: 'battle',
  shop: 'village',
  church: 'church',
  boss: 'boss battle',
  ruins: 'ruins',
  recruit: 'recruit',
  colosseum: 'colosseum',
  event: 'event',
});
const placeName = (type) => ROUTE_PLACE[type] || String(type || 'place');
const withArticle = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

/** "150 G" for a gold cost (the seal on a choice), '' for a free one. */
export function eventCostSeal(cost) {
  const n = num(cost);
  return n > 0 ? `${n} G` : '';
}

/** The skill's display name from the catalog (the id itself when it is unknown). */
function skillName(gameData, id) {
  return (
    (gameData?.skills || []).find((skill) => skill?.id === id)?.name || String(id || 'a skill')
  );
}

/** "Dulled −1 Might · Bent −5 Hit": the wear steps an item arrived with, by name. */
export function wornText(stats) {
  const list = Array.isArray(stats) ? stats : [];
  if (!list.length) return '';
  const info = wearDisplay({ _wear: list.map((stat) => ({ stat })) });
  return info.steps.map((step) => `${step.label} ${step.effect}`).join(' · ');
}

function hpLine(record) {
  const heal = record.mode === 'heal';
  const units = Array.isArray(record.units) ? record.units : [];
  const total = num(record.total);
  if (total <= 0 || !units.length)
    return {
      tone: 'plain',
      text: heal ? 'No one needed healing.' : 'No one was hurt.',
    };
  const verb = heal ? 'recovers' : 'loses';
  if (units.length === 1 && record.scope !== 'all')
    return { tone: heal ? 'good' : 'bad', text: `${units[0].name} ${verb} ${total} HP` };
  return {
    tone: heal ? 'good' : 'bad',
    text: heal ? `The army recovers ${total} HP` : `The army loses ${total} HP`,
    detail: units.map((u) => `${u.name} ${heal ? '+' : MINUS}${num(u.amount)}`).join(' · '),
  };
}

function goldLine(record) {
  const value = num(record.value);
  if (value > 0) return { tone: 'good', text: `Gained ${value} G` };
  if (value < 0)
    return { tone: 'bad', text: `${record.cost ? 'Paid' : 'Lost'} ${Math.abs(value)} G` };
  return num(record.requested) < 0
    ? { tone: 'plain', text: 'Nothing was taken: the purse was empty.' }
    : null;
}

function shadowLine(record) {
  // The meter and the act's own pressure can differ at the cap; say whichever moved.
  const n = num(record.value) || num(record.actValue);
  if (!n) return null;
  const fell = Array.isArray(record.fell) ? record.fell.length : 0;
  return {
    tone: n > 0 ? 'bad' : 'good',
    text:
      n > 0 ? `The Hollow Sun darkens: +${n} shadow` : `The shadow lifts: ${MINUS}${Math.abs(n)}`,
    ...(fell
      ? {
          detail: `${fell} ${plural(fell, 'place')} on the road ${plural(fell, 'falls', 'fall')} to the dark.`,
        }
      : {}),
  };
}

function itemLine(record) {
  const where = record.toConvoy ? ' sent to the convoy' : record.unit ? ` to ${record.unit}` : '';
  const worn = wornText(record.worn);
  return {
    tone: 'good',
    text: `${record.name}${where}`,
    ...(worn ? { detail: `Worn: ${worn}` } : {}),
    item: { name: record.name, tier: record.tier || undefined, type: record.itemType || undefined },
  };
}

function skillLine(record, gameData) {
  const name = skillName(gameData, record.skillId);
  const detail = [
    record.from ? `Taught by ${record.from}'s memory.` : '',
    record.benched ? 'No free slot: benched. Swap it in from Roster.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    tone: 'good',
    text: `${record.unit} learned ${name}`,
    ...(detail ? { detail } : {}),
  };
}

function counterLine(record) {
  const label = String(record.label || record.key || 'Counter');
  const delta = num(record.delta);
  const value = Math.max(0, num(record.value));
  if (!delta)
    return {
      tone: 'plain',
      text: `${label}: none to spend`,
    };
  return {
    tone: delta > 0 ? 'good' : 'plain',
    text: `${label} ${signed(delta)}`,
    detail: `${value} left`,
  };
}

function joinLine(record) {
  const level = Math.max(1, num(record.level) || 1);
  return {
    tone: 'good',
    text: `${record.name} joins the army`,
    detail: [record.className, `Lv ${level}`].filter(Boolean).join(' · '),
    unit: { uid: record.unitUid || null, name: record.name },
  };
}

function contractLine(record) {
  const kept = Array.isArray(record.reward) ? record.reward.filter(Boolean) : [];
  const broken = Array.isArray(record.penalty) ? record.penalty.filter(Boolean) : [];
  return {
    tone: 'plain',
    text: `${record.label || 'Contract'}: ${record.short || 'next battle'}`,
    detail: [
      sentence(record.line),
      kept.length ? `Kept: ${kept.join(', ')}.` : '',
      broken.length ? `Broken: ${broken.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

function routeLine(record) {
  const row = Number.isFinite(Number(record.row))
    ? ` Row ${num(record.row) + 1} of the route.`
    : '';
  if (record.op === 'addRoad')
    return {
      tone: 'good',
      text: `A new road opens to ${withArticle(placeName(record.type))}`,
      detail: `The route map shows it.${row}`.trim(),
    };
  const to = placeName(record.type);
  return {
    tone: record.type === 'battle' ? 'bad' : 'good',
    text: `A place ahead is now ${withArticle(to)}`,
    detail: `It was ${withArticle(placeName(record.fromType))}.${row}`.trim(),
  };
}

function burdenLine(record) {
  return {
    tone: 'bad',
    text: `Burden: ${record.label}`,
    detail: [sentence(record.line), sentence(record.detail)].filter(Boolean).join(' '),
  };
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
    if (!record || typeof record !== 'object') continue;
    let line;
    switch (record.kind) {
      case 'gold':
        line = goldLine(record);
        break;
      case 'item':
        line = itemLine(record);
        break;
      case 'skill':
        line = skillLine(record, gameData);
        break;
      case 'hp':
        line = hpLine(record);
        break;
      case 'shadow':
        line = shadowLine(record);
        break;
      case 'vision': {
        const n = num(record.value);
        line = n ? { tone: n > 0 ? 'good' : 'bad', text: `Vision ${signed(n)}` } : null;
        break;
      }
      case 'blessing':
        line = {
          tone: 'good',
          text: `Blessing: ${record.name}`,
          ...(record.description ? { detail: record.description } : {}),
        };
        break;
      case 'burden':
        line = burdenLine(record);
        break;
      case 'counter':
        line = counterLine(record);
        break;
      case 'join':
        line = joinLine(record);
        break;
      case 'contract':
        line = contractLine(record);
        break;
      case 'route':
        line = routeLine(record);
        break;
      case 'layToRest':
        line = {
          tone: 'plain',
          text: `${record.name} is laid to rest`,
          detail: 'They can no longer be revived.',
        };
        break;
      case 'consume': {
        const uses = Math.max(1, num(record.uses));
        const holder = record.holder === 'convoy' || !record.holder ? 'the convoy' : record.holder;
        line = {
          tone: 'plain',
          text: `Spent ${uses === 1 ? 'a use' : `${uses} uses`} of ${record.name} (${holder})`,
        };
        break;
      }
      case 'stat':
        line = {
          tone: num(record.value) >= 0 ? 'good' : 'bad',
          text: `${record.unit}: ${signed(num(record.value))} ${record.stat}`,
        };
        break;
      case 'note':
        line = record.text ? { tone: 'plain', text: String(record.text) } : null;
        break;
      default:
        line = null; // flag, battle: bookkeeping, not news
    }
    if (line) lines.push({ kind: record.kind, chip: RESULT_CHIPS[record.kind] || '', ...line });
  }
  return lines;
}

/** The header button's word for a page (Close keeps the event open; Continue leaves it). */
export function eventCloseLabel(view) {
  if (!view) return 'Close';
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
 * The pause menu's list of what weighs on the run: every burden (Burdens.describeBurdens) and the
 * open contract, each { id, label, short, line?, detail?, text? } (`text` replaces `line detail.`).
 * @param {object} run - RunManager
 * @param {object} [catalog] - the events catalog (burden definitions)
 */
export function pauseBurdenEntries(run, catalog = null) {
  const burdens = describeBurdens(run, catalog);
  const contract = contractChipModel(describeContract(run));
  return contract
    ? [
        ...burdens,
        { id: 'contract', label: contract.label, short: contract.short, text: contract.terms },
      ]
    : burdens;
}
