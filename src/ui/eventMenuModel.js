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
});

const MINUS = '−';
const num = (value) => Math.trunc(Number(value) || 0);
const signed = (n) => (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`);
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

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

/**
 * One line per result record: [{ kind, chip, tone, text, detail?, item? }]. `tone` is
 * 'good' | 'bad' | 'plain' (the result's colour), `item` the subject for an item icon.
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
        line = {
          tone: 'bad',
          text: `Burden: ${record.label}`,
          detail: [record.line, record.detail].filter(Boolean).join(' '),
        };
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
