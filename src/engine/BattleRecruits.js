// Units that joined the army mid-battle (Talk recruits).
//
// A roster unit that falls is recorded from the run roster as it entered the
// battle (RunManager.completeBattle diffs the roster against the survivors).
// A mid-battle recruit has no roster entry yet, so the battle keeps the same
// kind of record for it: the unit as it joined the army. The list is part of
// the battle world state (BattleSnapshotState), so suspend/resume keeps it and
// every rewind restores it together with the units — a rewind to before the
// recruitment forgets the recruit, a rewind to before the death keeps the
// record while the unit lives again.
//
// Records are matched by unit identity (`unitUid`, UnitIdentity.js), never by the
// name alone: a mercenary can share a recruit's name (legacy saves), and a living
// namesake must not hide the recruit's death.
//
// Pure: no RNG, no scene access beyond the arrays it is handed.
import { serializeUnit } from './RunManager.js';
import { matchUnitsToSurvivors, unitUidOf } from './UnitIdentity.js';

const MAX_BATTLE_RECRUITS = 32;

function copyWithoutBattleDeltas(unit) {
  const data = structuredClone({
    ...unit,
    graphic: null,
    label: null,
    hpBar: null,
    factionIndicator: null,
    _conditionIcons: null,
    affixPips: null,
    _lastAiDecision: null,
  });
  // Mirror BattleScene.clearBattleScopedDeltas: battle-scoped stat changes
  // never reach the roster (serializeUnit reverts timed weapon-art buffs).
  if (data._battleDeltas && data.stats && typeof data.stats === 'object') {
    for (const [stat, delta] of Object.entries(data._battleDeltas)) {
      if (!Number.isFinite(delta) || delta === 0) continue;
      data.stats[stat] = (data.stats[stat] || 0) - delta;
      data.stats[stat] =
        stat === 'MOV' ? Math.max(1, data.stats[stat]) : Math.max(0, data.stats[stat]);
    }
    if (Number.isFinite(data.stats.MOV)) data.mov = data.stats.MOV;
  }
  delete data._battleDeltas;
  // Status conditions are battle-scoped; structuredClone keeps weapon ===
  // inventory[i], which serializeUnit relies on to relink the equipped item.
  data._conditions = [];
  return data;
}

function validEntry(entry) {
  return Boolean(
    entry &&
    typeof entry === 'object' &&
    typeof entry.name === 'string' &&
    entry.name &&
    entry.unit &&
    typeof entry.unit === 'object' &&
    entry.unit.name === entry.name &&
    entry.unit.stats &&
    typeof entry.unit.stats === 'object',
  );
}

/** Normalized copy of a stored list (legacy snapshots/checkpoints have none). */
export function normalizeBattleRecruits(value) {
  if (!Array.isArray(value)) return [];
  return structuredClone(value.filter(validEntry).slice(0, MAX_BATTLE_RECRUITS));
}

/** Does a stored record describe `unit`? uid, then battle entity, then (legacy) name. */
function recordIsUnit(entry, unit) {
  const a = unitUidOf(entry.unit);
  const b = unitUidOf(unit);
  if (a && b) return a === b;
  const entityId = typeof unit?.battleEntityId === 'string' ? unit.battleEntityId : null;
  if (entry.entityId && entityId) return entry.entityId === entityId;
  return entry.name === unit?.name;
}

/**
 * Record a unit that just joined the player army. Returns the new list; a record
 * for the same unit (same identity) is replaced by the newer one.
 */
export function recordBattleRecruit(list, unit) {
  const current = normalizeBattleRecruits(list);
  if (!unit || typeof unit.name !== 'string' || !unit.name || !unit.stats) return current;
  const entry = {
    name: unit.name,
    entityId: typeof unit.battleEntityId === 'string' ? unit.battleEntityId : null,
    unit: serializeUnit(copyWithoutBattleDeltas(unit)),
  };
  return [...current.filter((e) => !recordIsUnit(e, unit)), entry].slice(-MAX_BATTLE_RECRUITS);
}

/**
 * Serialized recruits that joined during this battle and are not among the
 * survivors (deployed, escaped or benched) — they fell after joining.
 *
 * `roster` is the run roster as the battle began: its units are matched to the
 * survivors first, one survivor per unit (UnitIdentity.matchUnitsToSurvivors), so a
 * surviving roster unit that shares a recruit's name does not count as the recruit.
 */
export function fallenBattleRecruits(list, survivors = [], roster = []) {
  const records = normalizeBattleRecruits(list);
  const entrants = (Array.isArray(roster) ? roster : []).filter((u) => u && typeof u === 'object');
  const units = records.map((entry) => entry.unit);
  const { unmatched } = matchUnitsToSurvivors([...entrants, ...units], survivors);
  const fallen = new Set(unmatched);
  return units.filter((unit) => fallen.has(unit));
}
