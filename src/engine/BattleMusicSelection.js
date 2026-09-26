// BattleMusicSelection.js — which track a battle plays (pure, no Phaser deps).
//
// A battle's music answers the most specific thing true of it:
//   1. a boss plays its theme (the antagonists' own, else the act's)
//   2. an escape map plays the pursuit theme
//   3. a node the Eclipse has taken, a village under attack, a recruit to
//      rescue, an elite company: each has its own theme
//   4. the map's place: castle, swamp, tundra, volcano
//   5. otherwise the act's pool
// Picks are hashed from the run seed, never rolled, so a resumed battle plays
// what it played before. Within an act the pool is walked in a per-run order
// indexed by the node's row, so the battles along one path never repeat a
// theme until the pool is spent. The run's first battle always opens on Act
// I's first theme (Ember Dusk, the main battle theme), as does the tutorial.

import { voiceHash } from './UnitVoice.js';

/**
 * Share of eligible battles a biome or situation theme takes (the rest play
 * the act pool). Keys missing here take every eligible battle.
 */
export const THEME_SHARE = Object.freeze({
  // castles are frequent in Acts II-III: the act themes keep part of them
  castle: 0.67,
  // a village the bandits race for (the ambushed village always rings its bells)
  villageRaid: 0.34,
});

function share(seed, tag, fraction) {
  return voiceHash(`${seed}|music|${tag}`) % 100 < Math.round(fraction * 100);
}

// The act a run opens in: its walk starts on its first theme, the run's first battle.
const OPENING_ACT = 'act1';

/**
 * A per-run order of `pool` (stable for one seed and act). The opening act's
 * first theme stays first, so the run opens on it and a later row can't repeat it.
 */
export function orderPool(pool, seed, act) {
  const list = Array.isArray(pool) ? pool.filter(Boolean) : pool ? [pool] : [];
  const pinned = act === OPENING_ACT && list.length ? [list[0]] : [];
  const rest = list
    .slice(pinned.length)
    .map((key, i) => ({ key, i, h: voiceHash(`${seed}|music|${act}|${key}`) }))
    .sort((a, b) => a.h - b.h || a.i - b.i)
    .map((entry) => entry.key);
  return [...pinned, ...rest];
}

/**
 * The context a battle offers music selection, from BattleScene's params.
 * @returns {object} act, objective, biome, row, seed and the situation flags
 */
export function battleMusicContext({ battleParams, battleConfig, runSeed, isElite } = {}) {
  const params = battleParams || {};
  const seedSource = Number.isFinite(Number(runSeed))
    ? Number(runSeed) >>> 0
    : Number(params.battleSeed) >>> 0;
  return {
    act: params.act || 'act1',
    objective: battleConfig?.objective || params.objective || null,
    biome: battleConfig?.biome || null,
    row: Number.isFinite(Number(params.row)) ? Number(params.row) : null,
    nodeKey: `${params.act || 'act1'}|${params.row ?? '-'}|${params.battleSeed ?? '-'}`,
    seed: seedSource,
    firstBattle: params.firstBattleFightersOnly === true || params.tutorialMode === true,
    isElite: Boolean(isElite || params.isElite),
    isAmbush: params.isAmbush === true,
    hasVillage: params.hasVillage === true,
    isRecruitBattle: params.isRecruitBattle === true,
    isEclipsed: params.isEclipsed === true,
  };
}

/**
 * The music key for a non-boss battle (bosses are chosen by the caller).
 * @param {object} ctx from battleMusicContext
 * @param {{ battle: object, escape?: string, battleBiome?: object, battleSituation?: object }} table
 * @returns {{ key: string|null, reason: string }}
 */
export function selectBattleMusic(ctx, table) {
  const c = ctx || {};
  const situation = table?.battleSituation || {};
  const biomes = table?.battleBiome || {};
  const seed = `${c.seed ?? 0}|${c.nodeKey ?? ''}`;

  if (c.objective === 'escape' && table?.escape) return { key: table.escape, reason: 'escape' };
  if (c.isEclipsed && situation.eclipsed) return { key: situation.eclipsed, reason: 'eclipsed' };
  if (c.isAmbush && situation.village) return { key: situation.village, reason: 'village' };
  if (c.isRecruitBattle && situation.rescue) return { key: situation.rescue, reason: 'rescue' };
  if (c.isElite && situation.elite) return { key: situation.elite, reason: 'elite' };
  const biomeKey = c.biome ? biomes[c.biome] : null;
  if (biomeKey && (!(c.biome in THEME_SHARE) || share(seed, c.biome, THEME_SHARE[c.biome]))) {
    return { key: biomeKey, reason: `biome:${c.biome}` };
  }
  if (c.hasVillage && situation.village && share(seed, 'village', THEME_SHARE.villageRaid)) {
    return { key: situation.village, reason: 'village' };
  }

  const pool = table?.battle?.[c.act] ?? table?.battle?.act1;
  const list = Array.isArray(pool) ? pool.filter(Boolean) : pool ? [pool] : [];
  if (!list.length) return { key: null, reason: 'none' };
  if (c.firstBattle) return { key: list[0], reason: 'first' };
  const ordered = orderPool(list, c.seed ?? 0, c.act);
  const index = Number.isFinite(c.row) ? c.row : voiceHash(seed);
  return {
    key: ordered[((index % ordered.length) + ordered.length) % ordered.length],
    reason: 'act',
  };
}
