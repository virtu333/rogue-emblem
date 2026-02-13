const WEAPON_ART_ACT_ID_RE = /^act(\d+)$/i;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function formatWeaponArtActLabel(actId) {
  if (!actId) return 'Act 1';
  const match = String(actId).match(WEAPON_ART_ACT_ID_RE);
  if (match) return `Act ${match[1]}`;
  return String(actId);
}

export function summarizeWeaponArtEffect(art) {
  const mods = art?.combatMods || {};
  const chunks = [];
  const pushSigned = (label, value) => {
    const n = toNumber(value, 0);
    if (!n) return;
    const sign = n > 0 ? '+' : '';
    chunks.push(`${label} ${sign}${n}`);
  };

  pushSigned('Mt', mods.atkBonus);
  pushSigned('Hit', mods.hitBonus);
  pushSigned('Crit', mods.critBonus);
  pushSigned('Spd', mods.spdBonus);
  pushSigned('Avoid', mods.avoidBonus);
  pushSigned('Def', mods.defBonus);
  if (mods.targetsRES) chunks.push('Targets RES');
  if (mods.preventCounter) chunks.push('No counter');
  if (mods.vengeance) chunks.push('Vengeance dmg');
  if (mods.halfPhysicalDamage) chunks.push('Half physical taken');
  if (mods.rangeOverride) {
    const range = (typeof mods.rangeOverride === 'object')
      ? `${mods.rangeOverride.min}-${mods.rangeOverride.max}`
      : String(mods.rangeOverride);
    chunks.push(`Range = ${range}`);
  } else {
    pushSigned('Range', mods.rangeBonus);
  }
  if (mods.effectiveness?.multiplier > 1) {
    const targets = Array.isArray(mods.effectiveness.moveTypes)
      ? mods.effectiveness.moveTypes.join('/')
      : 'target';
    chunks.push(`${mods.effectiveness.multiplier}x vs ${targets}`);
  }
  if (mods.ignoreTerrainAvoid) chunks.push('Ignores terrain avoid');
  if (chunks.length > 0) return chunks.join(', ');
  if (art?.description) return art.description;
  return 'No combat modifier';
}

export function resolveWeaponArtStatus(art, options = {}) {
  const actSequence = Array.isArray(options.actSequence) && options.actSequence.length > 0
    ? options.actSequence
    : ['act1', 'act2', 'act3'];
  const currentAct = options.currentAct || actSequence[0] || 'act1';
  const unlockAct = art?.unlockAct || actSequence[0] || 'act1';
  const currentIdx = Math.max(0, actSequence.indexOf(String(currentAct)));
  const unlockIdx = actSequence.indexOf(String(unlockAct));
  const unlockedIds = new Set(Array.isArray(options.unlockedIds) ? options.unlockedIds : []);
  const metaUnlockedIds = new Set(Array.isArray(options.metaUnlockedIds) ? options.metaUnlockedIds : []);
  const actUnlockedIds = new Set(Array.isArray(options.actUnlockedIds) ? options.actUnlockedIds : []);
  const isUnlockedById = !!art?.id && unlockedIds.has(art.id);
  const isMetaUnlocked = !!art?.id && metaUnlockedIds.has(art.id);
  const isActUnlocked = !!art?.id && actUnlockedIds.has(art.id);
  const inferActUnlocked = Boolean(options.inferActUnlocked);
  const isUnlockedByAct = inferActUnlocked && unlockIdx !== -1 && unlockIdx <= currentIdx;
  const requiredRank = String(art?.requiredRank || 'Prof');
  const requirementLabel = requiredRank === 'Mast' ? 'Requires Mast' : 'Requires Prof';

  if (isMetaUnlocked) {
    return {
      label: 'Meta Unlocked',
      detail: isActUnlocked ? `Also ${formatWeaponArtActLabel(unlockAct)}` : null,
      sourceLabel: 'Meta',
      rank: 0,
      unlockIdx: Math.max(0, unlockIdx),
    };
  }
  if (isActUnlocked || isUnlockedById || isUnlockedByAct) {
    return {
      label: 'Unlocked',
      detail: null,
      sourceLabel: 'Act',
      rank: 0,
      unlockIdx: Math.max(0, unlockIdx),
    };
  }
  if (unlockIdx === -1) {
    return {
      label: 'Invalid unlock act',
      detail: null,
      sourceLabel: 'Data',
      rank: 4,
      unlockIdx: Number.MAX_SAFE_INTEGER,
    };
  }
  if (unlockIdx > currentIdx) {
    return {
      label: `Unlocks in ${formatWeaponArtActLabel(unlockAct)}`,
      detail: null,
      sourceLabel: 'Act',
      rank: 1,
      unlockIdx,
    };
  }
  return {
    label: requirementLabel,
    detail: null,
    sourceLabel: 'Rank',
    rank: requiredRank === 'Mast' ? 3 : 2,
    unlockIdx: Math.max(0, unlockIdx),
  };
}

export function buildWeaponArtVisibilityRows(arts, options = {}) {
  const list = Array.isArray(arts) ? arts : [];
  const rows = list
    .filter((art) => art?.id && art?.name)
    .map((art) => {
      const status = resolveWeaponArtStatus(art, options);
      return {
        id: art.id,
        name: art.name,
        weaponType: art.weaponType || 'Unknown',
        requiredRank: art.requiredRank || 'Prof',
        hpCost: Math.max(0, Math.trunc(toNumber(art.hpCost, 0))),
        perTurnLimit: Math.max(0, Math.trunc(toNumber(art.perTurnLimit, 0))),
        perMapLimit: Math.max(0, Math.trunc(toNumber(art.perMapLimit, 0))),
        status: status.label,
        statusDetail: status.detail || null,
        statusSource: status.sourceLabel || 'Act',
        statusRank: status.rank,
        unlockAct: art.unlockAct || 'act1',
        unlockIdx: status.unlockIdx,
        effectSummary: summarizeWeaponArtEffect(art),
      };
    });

  rows.sort((a, b) =>
    (a.statusRank - b.statusRank)
    || (a.unlockIdx - b.unlockIdx)
    || a.weaponType.localeCompare(b.weaponType)
    || a.name.localeCompare(b.name)
  );
  return rows;
}
