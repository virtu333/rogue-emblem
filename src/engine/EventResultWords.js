// EventResultWords.js — the words of an event's result records, in one place (the Event page
// and the contract's victory band both read them; docs/specs/event-nodes.md §10).
//
// The engine (EventCommands / EventEffects) decides what happened and hands back plain result
// records (listed in EventEffects.js); `describeResult` says one record as a plain line:
//   { tone: 'good' | 'bad' | 'plain', text, detail?, item?, unit? } or null for a record that
// says nothing to the player (a flag, a battle: bookkeeping, not news; a zero gold change).
// The page (ui/eventMenuModel.js) puts a chip and a kind on the line and draws it; the band
// (Contracts.settlementLines) takes the `text`. Neither phrases a record itself, so the two
// cannot disagree. Pure: no Phaser, no DOM, no randomness, no game rules.

import { wearDisplay } from './WeaponWear.js';
import { FORGE_BONUSES } from '../utils/constants.js';

const MINUS = '−';
export const num = (value) => Math.trunc(Number(value) || 0);
const signed = (n) => (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`);
export const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

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
  // An accessory goes to the army's pool (no one carries it until it is equipped from the Roster).
  const where = record.pooled
    ? ' to the accessory pool'
    : record.toConvoy
      ? ' sent to the convoy'
      : record.unit
        ? ` to ${record.unit}`
        : '';
  const worn = wornText(record.worn);
  return {
    tone: 'good',
    text: `${record.display || record.name}${where}`,
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

const FORGE_WORDS = Object.freeze({ might: 'Might', crit: 'Crit', hit: 'Hit', weight: 'Wt' });

/** One forge step in words: "+1 Might", "+5 Crit", "−1 Wt" (the sizes are FORGE_BONUSES). */
function forgeEffect(stat) {
  const bonus = Number(FORGE_BONUSES[stat]);
  const word = FORGE_WORDS[stat] || String(stat || '');
  return Number.isFinite(bonus) ? `${signed(bonus)} ${word}` : word;
}

function forgeLine(record) {
  return {
    tone: 'good',
    text: `${record.unit}'s ${record.weapon} is forged`,
    detail: [
      forgeEffect(record.stat),
      record.name && record.name !== record.weapon ? `now ${record.name}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

function wearLine(record) {
  const worn = wornText([record.stat]);
  return {
    tone: 'bad',
    text: `${record.unit}'s ${record.weapon} is worn`,
    detail: [worn, record.name && record.name !== record.weapon ? `now ${record.name}` : '']
      .filter(Boolean)
      .join(' · '),
  };
}

function mendLine(record) {
  const steps = Math.max(0, num(record.steps));
  const weapons = Array.isArray(record.weapons) ? record.weapons : [];
  return {
    tone: 'good',
    text: `${record.unit}'s ${weapons.length === 1 ? 'weapon is' : 'weapons are'} mended`,
    detail: [
      `${steps} ${plural(steps, 'wear step')} repaired`,
      ...weapons.map((w) => (w.to && w.to !== w.from ? `${w.from} → ${w.to}` : w.from)),
    ]
      .filter(Boolean)
      .join(' · '),
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

/** A stat change: a loss the planner clamped to nothing (a stat already at its floor) is not "−0". */
function statLine(record) {
  const value = num(record.value);
  if (value === 0) return { tone: 'plain', text: `${record.unit}: ${record.stat} unchanged` };
  return {
    tone: value > 0 ? 'good' : 'bad',
    text: `${record.unit}: ${signed(value)} ${record.stat}`,
  };
}

/**
 * A note: the planner's own words for something that was skipped. An item with nowhere to go
 * (`noRoom`) says what was missed, by `name` when the item is known ("No room for Steel
 * Lance"; "No room for the item" when the pick found no room before choosing one); the
 * planner's sentence rides as the detail. Any other note is its own text.
 */
function noteLine(record) {
  const text = record.text ? String(record.text) : '';
  if (record.noRoom === true)
    return {
      tone: 'plain',
      text: `No room for ${record.name || 'the item'}`,
      ...(text ? { detail: text } : {}),
    };
  return text ? { tone: 'plain', text } : null;
}

/**
 * One result record as a line, or null when it says nothing.
 * @param {object} record - an EventCommands / EventEffects result record
 * @param {{ gameData?: object }} [context] - the catalog a skill's name is read from
 */
export function describeResult(record, { gameData = null } = {}) {
  if (!record || typeof record !== 'object') return null;
  switch (record.kind) {
    case 'gold':
      return goldLine(record);
    case 'item':
      return itemLine(record);
    case 'skill':
      return skillLine(record, gameData);
    case 'hp':
      return hpLine(record);
    case 'shadow':
      return shadowLine(record);
    case 'vision': {
      const n = num(record.value);
      return n ? { tone: n > 0 ? 'good' : 'bad', text: `Vision ${signed(n)}` } : null;
    }
    case 'blessing':
      return {
        tone: 'good',
        text: `Blessing: ${record.name}`,
        ...(record.description ? { detail: record.description } : {}),
      };
    case 'earnedBlessing':
      return {
        tone: 'good',
        text: `Earned blessing: ${record.name}`,
        ...(record.description ? { detail: record.description } : {}),
      };
    case 'burden':
      return burdenLine(record);
    case 'forge':
      return forgeLine(record);
    case 'wear':
      return wearLine(record);
    case 'mend':
      return mendLine(record);
    case 'counter':
      return counterLine(record);
    case 'join':
      return joinLine(record);
    case 'contract':
      return contractLine(record);
    case 'route':
      return routeLine(record);
    case 'layToRest':
      return {
        tone: 'plain',
        text: `${record.name} is laid to rest`,
        detail: 'They can no longer be revived.',
      };
    case 'consume': {
      const uses = Math.max(1, num(record.uses));
      const holder = record.holder === 'convoy' || !record.holder ? 'the convoy' : record.holder;
      return {
        tone: 'plain',
        text: `Spent ${uses === 1 ? 'a use' : `${uses} uses`} of ${record.name} (${holder})`,
      };
    }
    case 'stat':
      return statLine(record);
    case 'note':
      return noteLine(record);
    default:
      return null; // flag, battle: bookkeeping, not news
  }
}
