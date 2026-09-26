// Item keywords: the short tags an item card shows beside its name ("Crit",
// "Strikes twice", "Beats Axes", "x3 vs Armored"), plus the base line that says
// what the item is ("Silver Lance", "Relic Sword"; a relic says so there, not in a
// tag). Pure.
//
// Names carry flavour; keywords carry the rules. Every keyword is read from the
// same weapon fields the engine reads (Combat.js parses `special`), so a tag can
// never promise something combat doesn't do. The help glossary explains each
// keyword once (src/data/helpContent.js, "Keywords").

import { getWeaponStatBonuses } from './Combat.js';
import { WEAPON_TRIANGLE } from '../utils/constants.js';

const TIER_WORDS = new Set(['Iron', 'Steel', 'Silver']);

const TYPE_NOUN = {
  Sword: 'Sword',
  Lance: 'Lance',
  Axe: 'Axe',
  Bow: 'Bow',
  Tome: 'Tome',
  Light: 'Light Tome',
  Staff: 'Staff',
  Breath: 'Breath',
};

const PLURAL = { Sword: 'Swords', Lance: 'Lances', Axe: 'Axes' };

/** Keyword ids, in display order. `tone` picks the chip colour. */
export const KEYWORDS = {
  crit: { tone: 'crit', label: 'Crit' },
  brave: { tone: 'twice', label: 'Strikes twice' },
  reaver: { tone: 'reverse', label: 'Beats' },
  effective: { tone: 'effective', label: 'vs' },
  magicSword: { tone: 'magic', label: 'Magic sword' },
  sunder: { tone: 'plain', label: 'Halves DEF' },
  poison: { tone: 'poison', label: 'Poison' },
  drain: { tone: 'poison', label: 'Drains HP' },
  thrown: { tone: 'thrown', label: 'Thrown' },
  closeBow: { tone: 'thrown', label: 'Close range' },
  longRange: { tone: 'thrown', label: 'Long range' },
  noDisadvantage: { tone: 'reverse', label: 'No triangle penalty' },
  counter: { tone: 'plain', label: 'Counter' },
  alone: { tone: 'plain', label: 'Alone' },
  equipped: { tone: 'plain', label: 'Equipped' },
  siege: { tone: 'thrown', label: 'Siege' },
};

function specialOf(item) {
  return typeof item?.special === 'string' ? item.special : '';
}

/** True for things that fight: weapons, tomes and breath (not staves, scrolls or supplies). */
export function isCombatWeapon(item) {
  return Boolean(item && TYPE_NOUN[item.type] && item.type !== 'Staff');
}

/**
 * The weapon type a triangle-reversing weapon beats: the type that normally
 * beats its own type (a reversed lance beats axes). Null for anything else.
 */
export function reaverBeats(item) {
  if (!specialOf(item).includes('Reverses weapon triangle')) return null;
  const { matchups } = WEAPON_TRIANGLE;
  const counter = Object.keys(matchups).find((winner) => matchups[winner] === item.type);
  return counter || null;
}

function effectiveness(special) {
  if (/Effective vs dark/i.test(special)) return { targets: ['Dark'], multiplier: 3 };
  const match = special.match(/Effective vs ([^()]+)\s*\((\d+)x\)/i);
  if (!match) return null;
  const targets = match[1]
    .split(/[/,]| and /i)
    .map((t) => t.trim())
    .filter(Boolean);
  return { targets, multiplier: Number(match[2]) };
}

/**
 * The keyword tags for an item, in display order. Each tag is
 * `{ id, tone, text, title }`: `text` is what the chip shows, `title` the full
 * rule. Items without combat rules (staves, supplies, accessories) return [].
 */
export function itemKeywords(item) {
  if (!isCombatWeapon(item)) return [];
  const special = specialOf(item);
  const tags = [];
  const add = (id, text, title) => tags.push({ id, tone: KEYWORDS[id].tone, text, title });

  if (special.includes('Critical specialist'))
    add('crit', `Crit ${item.crit ?? ''}`.trim(), 'Built for critical hits (3x damage).');
  if (special.includes('twice consecutively'))
    add(
      'brave',
      'Strikes twice',
      'Each of its attacks strikes twice in a row, attacking or countering.',
    );
  const beats = reaverBeats(item);
  if (beats) {
    const loses = WEAPON_TRIANGLE.matchups[item.type];
    add(
      'reaver',
      `Beats ${PLURAL[beats]}`,
      `Reverses the weapon triangle: beats ${PLURAL[beats]}, loses to ${PLURAL[loses]}.`,
    );
  }
  const eff = effectiveness(special);
  if (eff)
    add(
      'effective',
      `x${eff.multiplier} vs ${eff.targets.join(', ')}`,
      `Deals ${eff.multiplier}x might against ${eff.targets.join(' and ')} enemies.`,
    );
  if (special.includes('Magic sword'))
    add('magicSword', 'Uses MAG', `Strikes with MAG against RES, at range ${item.range}.`);
  if (special.includes('Halves target DEF'))
    add('sunder', 'Halves DEF', "Halves the target's DEF in combat.");
  const poison = special.match(/Poison: target loses (\d+) HP after combat/i);
  if (poison)
    add('poison', `Poison ${poison[1]}`, `The target loses ${poison[1]} HP after combat.`);
  if (/Drains HP/i.test(special)) add('drain', 'Drains HP', 'Heals the wielder for damage dealt.');
  if (special.includes('Throwable')) add('thrown', 'Thrown', `Attacks at range ${item.range}.`);
  if (special.includes('Close-range bow'))
    add('closeBow', 'Close range', `A bow that also shoots adjacent foes (range ${item.range}).`);
  if (special.includes('Extended range'))
    add(
      'longRange',
      `Range ${item.range}`,
      `Shoots farther than other bows (range ${item.range}).`,
    );
  if (special.includes('Ignores weapon triangle disadvantage'))
    add('noDisadvantage', 'No triangle penalty', 'Never suffers weapon-triangle disadvantage.');
  const counter = special.match(/\+(\d+)\s+(STR|MAG|SKL|SPD|DEF|RES|LCK) when counterattacking/i);
  if (counter) add('counter', `+${counter[1]} ${counter[2]} on counter`, special);
  if (/if no adjacent allies/i.test(special))
    add('alone', 'Alone: ' + special.replace(/\s*if no adjacent allies/i, ''), special);
  for (const { stat, value } of getWeaponStatBonuses(item))
    add('equipped', `+${value} ${stat}`, `+${value} ${stat} while equipped.`);
  if (special.includes('Siege magic'))
    add('siege', `Range ${item.range}`, `Siege magic: strikes from range ${item.range}.`);
  return tags;
}

/**
 * What the item is, in plain words: "Silver Lance", "Relic Sword", "Light Tome".
 * Null for anything that isn't a combat weapon or staff.
 */
export function itemBaseLine(item) {
  const noun = TYPE_NOUN[item?.type];
  if (!noun) return null;
  if (item.tier === 'Legend') return `Relic ${noun}`;
  if (item.tier === 'Rare') return `Rare ${noun}`;
  if (TIER_WORDS.has(item.tier) && ['Sword', 'Lance', 'Axe', 'Bow'].includes(item.type))
    return `${item.tier} ${noun}`;
  return noun;
}

/**
 * The base line to show under an item's name, or null when the name already
 * says it ("Iron Sword +2" needs no "Iron Sword" beneath it).
 */
export function itemBaseLineFor(item, displayName = item?.name) {
  const line = itemBaseLine(item);
  if (!line) return null;
  const name = String(displayName || '').toLowerCase();
  return name.includes(line.toLowerCase()) ? null : line;
}
