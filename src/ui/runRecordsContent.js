// runRecordsContent — the words and numbers of the Victory Records screen (pure: no DOM,
// no Phaser). RunRecordsMenu renders what this returns; records come from
// mergeRunRecords (src/engine/RunRecords.js), so every field here is already clean.

import { RECORD_STAT_NAMES, RUN_RECORD_VERSION } from '../engine/RunRecords.js';
import { titledName } from '../engine/DeedTitles.js';
import { actLabel } from './ceremonyContent.js';
import { shadowSummary } from './eclipseContent.js';
import { slotDifficulty } from './slotCardModel.js';
import { eclipsePhase } from '../engine/EclipseSystem.js';

/** v2 records carry per-unit detail and the fallen; v1 records render as plain rows. */
export function isDetailedRecord(record) {
  return Number(record?.v) >= RUN_RECORD_VERSION;
}

/** `{ id, label, color }` of a record's difficulty (color from difficulty.json, or null). */
export function recordDifficulty(gameData, difficultyId) {
  const mode = slotDifficulty(gameData, difficultyId) || { id: 'normal', label: 'First Light' };
  const color = gameData?.difficulty?.modes?.[mode.id]?.color;
  return {
    ...mode,
    color: typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color) ? color : null,
  };
}

export function recordDate(record) {
  const at = Number(record?.endedAt);
  return at > 0 ? new Date(at).toLocaleDateString() : 'Undated';
}

/** The lords of a record's surviving roster ("Edric & Sera"), or '' when none survived. */
export function recordLordNames(record) {
  return (record?.roster || [])
    .filter((u) => u.isLord)
    .map((u) => u.name)
    .join(' & ');
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "4 acts · 70 turns · 12 survivors · 2 fallen" (only what the record knows). */
export function recordListMeta(record) {
  const parts = [plural(record.actsCleared || 0, 'act', 'acts')];
  if (record.totalTurns != null) parts.push(plural(record.totalTurns, 'turn', 'turns'));
  parts.push(plural(record.roster?.length || 0, 'survivor', 'survivors'));
  if (isDetailedRecord(record) && record.fallen?.length)
    parts.push(`${record.fallen.length} fallen`);
  return parts.join(' · ');
}

/** The list row's accessible name: everything the row shows, in reading order. */
export function recordListLabel(record, gameData, slot) {
  const lords = recordLordNames(record);
  return [
    recordDate(record),
    recordDifficulty(gameData, record.difficulty).label,
    ...(record.noMetaMode === true ? ['No Meta Victory'] : []),
    ...(lords ? [lords] : []),
    recordListMeta(record),
    `Slot ${slot}`,
  ].join(' · ');
}

/** Header facts: `[{ key, label, value }]`. */
export function recordFacts(record, gameData) {
  const facts = [{ key: 'acts', label: 'Acts cleared', value: String(record.actsCleared || 0) }];
  if (record.totalTurns != null)
    facts.push({ key: 'turns', label: 'Turns', value: String(record.totalTurns) });
  if (record.shadow != null)
    facts.push({
      key: 'eclipse',
      label: 'Eclipse',
      value: shadowSummary(record.shadow, gameData?.eclipse),
      phase: eclipsePhase(record.shadow, gameData?.eclipse).id,
    });
  facts.push({ key: 'seed', label: 'Seed', value: String(record.seed ?? 'unknown') });
  return facts;
}

/** The v1 detail row text, unchanged since records began ("Sera · Light Priestess · Lv 15 · Lord"). */
export function plainUnitLine(unit) {
  return `${unitTitle(unit)} · ${unit.className} · Lv ${unit.level}${unit.isLord ? ' · Lord' : ''}`;
}

/** The unit's name with its earned title ("Ottoline, Bane of the Archmage"). */
export function unitTitle(unit) {
  return unit.epithet
    ? titledName(unit.name, { text: unit.epithet, form: unit.epithetForm })
    : unit.name;
}

/** "Great Lord · Lv 9" */
export function unitClassLine(unit) {
  return `${unit.className || 'Unknown'} · Lv ${unit.level}`;
}

/** `[{ label, value }]` in stat order, or [] for a unit recorded without stats. */
export function recordStatRows(unit) {
  if (!Array.isArray(unit?.stats) || unit.stats.length !== RECORD_STAT_NAMES.length) return [];
  return RECORD_STAT_NAMES.map((label, i) => ({ label, value: unit.stats[i] }));
}

/** "14 kills · 2 bosses · 3 crits · 120 HP healed · 9 battles" ('' when none). */
export function recordTallyText(tally) {
  if (!tally || typeof tally !== 'object') return '';
  const parts = [];
  if (tally.kills) parts.push(plural(tally.kills, 'kill', 'kills'));
  if (tally.bossKills) parts.push(plural(tally.bossKills, 'boss', 'bosses'));
  if (tally.crits) parts.push(plural(tally.crits, 'crit', 'crits'));
  if (tally.healed) parts.push(`${tally.healed} HP healed`);
  if (tally.battles) parts.push(plural(tally.battles, 'battle', 'battles'));
  return parts.join(' · ');
}

/** "Fell in Act II · battle 7" (as much as the record knows). */
export function fellAtText(fellAt) {
  const act = actLabel(fellAt?.act);
  const battle = Number.isFinite(fellAt?.battle) ? `battle ${fellAt.battle}` : '';
  if (act && battle) return `Fell in ${act} · ${battle}`;
  if (act) return `Fell in ${act}`;
  if (battle) return `Fell in ${battle}`;
  return 'Fell on the march';
}

const humanize = (id) =>
  String(id)
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** Skill chips: `[{ id, name, description }]` from skills.json (an unknown id reads as words). */
export function recordSkills(unit, skillsData) {
  const list = Array.isArray(skillsData) ? skillsData : [];
  return (unit?.skills || []).map((id) => {
    const skill = list.find((s) => s?.id === id);
    return {
      id,
      name: typeof skill?.name === 'string' ? skill.name : humanize(id),
      description: typeof skill?.description === 'string' ? skill.description : '',
    };
  });
}

/** Deed chips: `[{ id, name, lore }]` from deeds.json. */
export function recordDeeds(unit, deedsData) {
  const list = Array.isArray(deedsData?.deeds) ? deedsData.deeds : [];
  return (unit?.deeds || []).map((id) => {
    const deed = list.find((d) => d?.id === id);
    return {
      id,
      name: typeof deed?.name === 'string' ? deed.name : humanize(id),
      lore: typeof deed?.lore === 'string' ? deed.lore : '',
    };
  });
}

/** Gear chips, the equipped weapon first: `[{ name, kind: 'weapon'|'item'|'accessory' }]`. */
export function recordGear(unit) {
  return [
    ...(unit?.weapon ? [{ name: unit.weapon, kind: 'weapon' }] : []),
    ...(unit?.items || []).map((name) => ({ name, kind: 'item' })),
    ...(unit?.accessory ? [{ name: unit.accessory, kind: 'accessory' }] : []),
  ];
}

/** Lords first, then the order the record keeps. */
export function lordsFirst(units) {
  const list = Array.isArray(units) ? units : [];
  return [...list.filter((u) => u.isLord), ...list.filter((u) => !u.isLord)];
}
