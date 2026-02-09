// musicConfig.js — Centralized music track configuration

export const MUSIC = {
  title: 'music_title',
  homeBase: 'music_home_base',

  nodeMap: {
    act1: 'music_explore_act1',
    act2: 'music_explore_act2',
    act3: 'music_explore_act3',
    finalBoss: 'music_explore_act3',
  },

  battle: {
    act1: ['music_battle_act1_1', 'music_battle_act1_2'],
    act2: ['music_battle_act2_1', 'music_battle_act2_2'],
    act3: ['music_battle_act3_1', 'music_battle_act3_2'],
    finalBoss: ['music_battle_act3_1', 'music_battle_act3_2'],
  },

  boss: {
    act1: 'music_boss_act1',
    act2: 'music_boss_act2',
    act3: 'music_boss_act3',
    finalBoss: 'music_boss_final',
  },

  shop: 'music_shop',
  rest: 'music_rest',
  victory: 'music_victory',
  defeat: 'music_defeat',
  runWin: 'music_run_win',
  loot: 'music_loot',
};

/** Pick a random element from an array, or return the value if it's a string. */
export function pickTrack(pool) {
  if (typeof pool === 'string') return pool;
  if (Array.isArray(pool)) return pool[Math.floor(Math.random() * pool.length)];
  return pool;
}

/** Get the correct music key for a purpose + act. */
export function getMusicKey(purpose, act) {
  const entry = MUSIC[purpose];
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const actEntry = entry[act] ?? entry.act1;
    return pickTrack(actEntry);
  }
  return entry;
}

/** Flat array of every unique track key (for BootScene preload). */
function collectKeys(obj) {
  const keys = new Set();
  for (const val of Object.values(obj)) {
    if (typeof val === 'string') {
      keys.add(val);
    } else if (Array.isArray(val)) {
      val.forEach(k => keys.add(k));
    } else if (val && typeof val === 'object') {
      for (const inner of Object.values(val)) {
        if (typeof inner === 'string') keys.add(inner);
        else if (Array.isArray(inner)) inner.forEach(k => keys.add(k));
      }
    }
  }
  return keys;
}

export const ALL_MUSIC_KEYS = [...collectKeys(MUSIC)];
