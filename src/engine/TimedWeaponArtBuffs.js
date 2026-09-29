// TimedWeaponArtBuffs — weapon-art buffs that last a number of phases (Tier 5 ally
// buffs, kill buffs, Recoil Guard). No Phaser deps.
//
// A unit keeps its live entries on `_battleTimedWeaponArtBuffs`. Only the strongest
// value per stat counts: core stats are applied to `unit.stats` (tracked on
// `_battleTimedWeaponArtAppliedStats` so a change can be taken back exactly), and
// HIT/CRIT/AVOID/ATK and the *_BONUS keys become combat mods
// (`_battleTimedWeaponArtAppliedCombatMods`).

export const TIMED_BUFF_CORE_STATS = new Set([
  'STR',
  'MAG',
  'SKL',
  'SPD',
  'DEF',
  'RES',
  'LCK',
  'MOV',
]);
export const TIMED_BUFF_COMBAT_MOD_BY_STAT = {
  HIT: 'hitBonus',
  CRIT: 'critBonus',
  AVOID: 'avoidBonus',
  ATK: 'atkBonus',
  DEF_BONUS: 'defBonus',
  RES_BONUS: 'resBonus',
  SPD_BONUS: 'spdBonus',
};

/** Add a buff, or refresh the one with the same key, then re-apply the strongest values. */
export function applyTimedBuffEntry(unit, entry) {
  if (!unit) return;
  if (!Array.isArray(unit._battleTimedWeaponArtBuffs)) unit._battleTimedWeaponArtBuffs = [];
  const key = String(entry?.key || '');
  if (key) {
    const existing = unit._battleTimedWeaponArtBuffs.find((buff) => buff?.key === key);
    if (existing) {
      existing.stats = { ...(entry.stats || {}) };
      existing.expiryPhase = entry.expiryPhase;
      existing.expiryTurn = entry.expiryTurn;
      existing.artId = entry.artId || null;
      existing.sourceName = entry.sourceName || null;
      existing.sourceFaction = entry.sourceFaction || null;
      recomputeTimedBuffState(unit);
      return;
    }
  }
  unit._battleTimedWeaponArtBuffs.push({
    key: key || null,
    artId: entry?.artId || null,
    sourceName: entry?.sourceName || null,
    sourceFaction: entry?.sourceFaction || null,
    expiryPhase: entry?.expiryPhase || null,
    expiryTurn: Math.max(1, Math.trunc(Number(entry?.expiryTurn) || 1)),
    stats: { ...(entry?.stats || {}) },
  });
  recomputeTimedBuffState(unit);
}

/** Re-derive the applied stats and combat mods from the unit's live buffs. */
export function recomputeTimedBuffState(unit) {
  if (!unit) return;
  const buffs = Array.isArray(unit._battleTimedWeaponArtBuffs)
    ? unit._battleTimedWeaponArtBuffs.filter(
        (entry) => entry && entry.stats && typeof entry.stats === 'object',
      )
    : [];
  unit._battleTimedWeaponArtBuffs = buffs;

  const strongestByStat = {};
  for (const entry of buffs) {
    for (const [rawStat, rawValue] of Object.entries(entry.stats || {})) {
      const stat = String(rawStat || '')
        .trim()
        .toUpperCase();
      if (!stat) continue;
      const value = Math.trunc(Number(rawValue) || 0);
      if (value === 0) continue;
      const prev = strongestByStat[stat];
      if (!Number.isFinite(prev) || value > prev) strongestByStat[stat] = value;
    }
  }

  const prevApplied = unit._battleTimedWeaponArtAppliedStats || {};
  const nextApplied = {};
  const allCoreStats = new Set([
    ...Object.keys(prevApplied),
    ...Object.keys(strongestByStat).filter((stat) => TIMED_BUFF_CORE_STATS.has(stat)),
  ]);

  for (const stat of allCoreStats) {
    const prevValue = Math.trunc(Number(prevApplied[stat]) || 0);
    const nextValue = TIMED_BUFF_CORE_STATS.has(stat)
      ? Math.trunc(Number(strongestByStat[stat]) || 0)
      : 0;
    const delta = nextValue - prevValue;
    if (delta !== 0) {
      unit.stats[stat] = (unit.stats[stat] || 0) + delta;
      if (stat === 'MOV') unit.stats[stat] = Math.max(1, unit.stats[stat] || 1);
      else unit.stats[stat] = Math.max(0, unit.stats[stat] || 0);
      if (stat === 'MOV') unit.mov = unit.stats.MOV;
    }
    if (nextValue !== 0) nextApplied[stat] = nextValue;
  }

  const combatMods = {};
  for (const [stat, value] of Object.entries(strongestByStat)) {
    const modKey = TIMED_BUFF_COMBAT_MOD_BY_STAT[stat];
    if (!modKey) continue;
    const normalized = Math.trunc(Number(value) || 0);
    if (normalized === 0) continue;
    const prev = combatMods[modKey] || 0;
    if (normalized > prev) combatMods[modKey] = normalized;
  }

  if (Object.keys(nextApplied).length > 0) unit._battleTimedWeaponArtAppliedStats = nextApplied;
  else delete unit._battleTimedWeaponArtAppliedStats;

  if (Object.keys(combatMods).length > 0) unit._battleTimedWeaponArtAppliedCombatMods = combatMods;
  else delete unit._battleTimedWeaponArtAppliedCombatMods;

  if (unit._battleTimedWeaponArtBuffs.length <= 0) {
    delete unit._battleTimedWeaponArtBuffs;
  }
}

/** When a buff cast now by `sourceUnit` for `durationPhases` of its own phases ends. */
export function resolveTimedBuffExpiry(sourceUnit, turnNumber, durationPhases = 1) {
  const phase = sourceUnit?.faction === 'enemy' ? 'enemy' : 'player';
  const currentTurn = Math.max(1, Math.trunc(Number(turnNumber) || 1));
  const duration = Math.max(1, Math.trunc(Number(durationPhases) || 1));
  return {
    expiryPhase: phase,
    expiryTurn: currentTurn + duration,
  };
}

/** Drop every buff that ends at the start of `phase` on `turn`, and re-apply the rest. */
export function expireTimedBuffs(units, phase, turn) {
  const normalizedPhase = phase === 'enemy' ? 'enemy' : 'player';
  const normalizedTurn = Math.max(1, Math.trunc(Number(turn) || 1));
  for (const unit of units) {
    if (
      !Array.isArray(unit?._battleTimedWeaponArtBuffs) ||
      unit._battleTimedWeaponArtBuffs.length <= 0
    )
      continue;
    const previousCount = unit._battleTimedWeaponArtBuffs.length;
    unit._battleTimedWeaponArtBuffs = unit._battleTimedWeaponArtBuffs.filter((entry) => {
      const expiryPhase = entry?.expiryPhase === 'enemy' ? 'enemy' : 'player';
      const expiryTurn = Math.max(1, Math.trunc(Number(entry?.expiryTurn) || 1));
      const expiresNow = expiryPhase === normalizedPhase && normalizedTurn >= expiryTurn;
      return !expiresNow;
    });
    if (unit._battleTimedWeaponArtBuffs.length !== previousCount) {
      recomputeTimedBuffState(unit);
    }
  }
}

/** The combat mods a unit's live timed buffs give it (all keys present, 0 when none). */
export function timedBuffCombatMods(unit) {
  const mods = unit?._battleTimedWeaponArtAppliedCombatMods;
  if (!mods || typeof mods !== 'object') {
    return {
      hitBonus: 0,
      critBonus: 0,
      avoidBonus: 0,
      atkBonus: 0,
      defBonus: 0,
      resBonus: 0,
      spdBonus: 0,
    };
  }
  return {
    hitBonus: Math.trunc(Number(mods.hitBonus) || 0),
    critBonus: Math.trunc(Number(mods.critBonus) || 0),
    avoidBonus: Math.trunc(Number(mods.avoidBonus) || 0),
    atkBonus: Math.trunc(Number(mods.atkBonus) || 0),
    defBonus: Math.trunc(Number(mods.defBonus) || 0),
    resBonus: Math.trunc(Number(mods.resBonus) || 0),
    spdBonus: Math.trunc(Number(mods.spdBonus) || 0),
  };
}
