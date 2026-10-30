// SurvivorsConfig.js — validation of data/survivors.json (Darkest Before Dawn) against the
// rest of the game's data: every weapon, class, boss and lord it names must exist, and every
// number the rules divide or loop by must be sane. Run by `npm run validate:data`. Pure.
import { GROWN_STATS } from './SurvivorsUnits.js';

export const WEAPON_PATTERNS = Object.freeze([
  'arc',
  'thrust',
  'boomerang',
  'arrow',
  'bolt',
  'aura',
]);
const PATTERN_FIELDS = {
  arc: ['reach', 'arc', 'swings'],
  thrust: ['length', 'width', 'thrusts'],
  boomerang: ['range', 'speed', 'count', 'radius'],
  arrow: ['speed', 'count', 'pierce'],
  bolt: ['speed', 'count', 'burst'],
  aura: ['radius'],
};
const BOSS_TIER_CLASSES = new Set(['Entity', 'Grasping Limb', 'Iron Guardian']);

const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function validateSurvivorsConfig(config, gameData) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!config || typeof config !== 'object') return { ok: false, errors: ['survivors: missing'] };
  const weaponNames = new Set((gameData.weapons || []).map((w) => w.name));
  const classNames = new Set((gameData.classes || []).map((c) => c.name));
  const lordNames = new Set((gameData.lords || []).map((l) => l.name));
  const terrainNames = new Set((gameData.terrain || []).map((t) => t.name));

  if (!positive(config.durationSec)) err('durationSec must be a positive number');
  const f = config.field || {};
  if (!(f.cols >= 16 && f.rows >= 16)) err('field: cols and rows must be at least 16');
  for (const blob of f.blobs || []) {
    if (!terrainNames.has(blob.terrain)) err(`field: unknown terrain ${blob.terrain}`);
    if (!(blob.minCells >= 1 && blob.maxCells >= blob.minCells))
      err(`field: bad blob size for ${blob.terrain}`);
  }
  for (const key of [
    'hpScale',
    'speedBase',
    'radius',
    'invulnSec',
    'pickupRadius',
    'maxWeapons',
    'maxPassives',
  ])
    if (!positive(config.player?.[key])) err(`player.${key} must be positive`);
  for (const key of ['speedBase', 'radius', 'rangedEverySec', 'rangedSpeed', 'despawnScale'])
    if (!positive(config.enemy?.[key])) err(`enemy.${key} must be positive`);
  if (!positive(config.xp?.first) || !positive(config.xp?.perLevel))
    err('xp: first and perLevel must be positive');
  if (!(config.offerCount >= 1)) err('offerCount must be at least 1');

  const weapons = config.weapons || {};
  if (!Object.keys(weapons).length) err('weapons: none');
  for (const [id, def] of Object.entries(weapons)) {
    if (!WEAPON_PATTERNS.includes(def.pattern))
      err(`weapons.${id}: unknown pattern ${def.pattern}`);
    if (!['STR', 'MAG'].includes(def.stat)) err(`weapons.${id}: stat must be STR or MAG`);
    if (!def.name || !def.description) err(`weapons.${id}: needs a name and a description`);
    if (!Array.isArray(def.levels) || !def.levels.length) {
      err(`weapons.${id}: needs levels`);
      continue;
    }
    def.levels.forEach((lvl, i) => {
      const where = `weapons.${id}.levels[${i}]`;
      if (!weaponNames.has(lvl.weapon)) err(`${where}: unknown weapon ${lvl.weapon}`);
      if (!positive(lvl.cooldown)) err(`${where}: cooldown must be positive`);
      if (!lvl.note) err(`${where}: needs a note`);
      for (const key of PATTERN_FIELDS[def.pattern] || [])
        if (!positive(lvl[key])) err(`${where}: ${key} must be positive`);
    });
  }
  for (const [type, id] of Object.entries(config.startWeaponByType || {}))
    if (!weapons[id]) err(`startWeaponByType.${type}: unknown weapon ${id}`);
  for (const [lord, id] of Object.entries(config.startWeaponByLord || {})) {
    if (!lordNames.has(lord)) err(`startWeaponByLord: unknown lord ${lord}`);
    if (!weapons[id]) err(`startWeaponByLord.${lord}: unknown weapon ${id}`);
  }

  for (const [id, def] of Object.entries(config.passives || {})) {
    if (!def.name || !def.description) err(`passives.${id}: needs a name and a description`);
    if (!(def.maxLevel >= 1)) err(`passives.${id}: maxLevel must be at least 1`);
    if (def.stat && (!GROWN_STATS.includes(def.stat) || !positive(def.perLevel)))
      err(`passives.${id}: stat must be a grown stat with a positive perLevel`);
    if (def.cooldownSec && def.cooldownSec.length !== def.maxLevel)
      err(`passives.${id}: cooldownSec needs one entry a level`);
  }

  const waves = config.waves || [];
  if (!waves.length || waves[0].fromSec !== 0) err('waves: the first wave must start at 0');
  waves.forEach((w, i) => {
    const where = `waves[${i}]`;
    if (i && !(w.fromSec > waves[i - 1].fromSec)) err(`${where}: fromSec must rise`);
    if (!positive(w.spawnPerSec) || !(w.maxAlive >= 1))
      err(`${where}: spawnPerSec and maxAlive must be positive`);
    if (!Array.isArray(w.level) || !(w.level[0] >= 1) || !(w.level[1] >= w.level[0]))
      err(`${where}: bad level range`);
    if (!Array.isArray(w.classes) || !w.classes.length) err(`${where}: needs classes`);
    for (const c of w.classes || []) {
      if (!classNames.has(c)) err(`${where}: unknown class ${c}`);
      if (BOSS_TIER_CLASSES.has(c)) err(`${where}: ${c} is a boss-tier class`);
    }
  });
  for (const at of config.elites?.atSec || [])
    if (!(at > 0 && at < config.durationSec)) err(`elites: ${at} is outside the night`);

  for (const [i, def] of (config.bosses || []).entries()) {
    const where = `bosses[${i}]`;
    const entry = (gameData.enemies?.bosses?.[def.act] || []).find((b) => b.name === def.name);
    if (!entry) err(`${where}: no boss ${def.name} in enemies.json bosses.${def.act}`);
    if (!(def.atSec > 0 && def.atSec < config.durationSec))
      err(`${where}: atSec is outside the night`);
    if (!positive(def.hpScale)) err(`${where}: hpScale must be positive`);
    const c = def.charge;
    if (
      c &&
      !(
        positive(c.everySec) &&
        positive(c.windupSec) &&
        positive(c.dashSec) &&
        positive(c.dashSpeedScale)
      )
    )
      err(`${where}: charge needs positive everySec, windupSec, dashSec, dashSpeedScale`);
  }
  return { ok: errors.length === 0, errors };
}
