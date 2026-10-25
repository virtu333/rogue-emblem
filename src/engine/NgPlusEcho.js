// NgPlusEcho.js - NG+ enemy scaling by Echo (docs/specs/ng-plus.md §13).
//
// Each Barracks member playing an NG+ run brings its Echo: the number of rides its record has
// had (a recruit kept twice is 2; a lord's kit counts the same, since that is where most of the
// carried power is). The run's Echo is the sum, counted when the member joins (run start, or
// the third lord's arrival) and saved on `run.ngPlus.echo`. Enemies are scaled by the highest
// step of difficulty.json `ngPlus.echo` the Echo reaches, read in RunManager.getBattleParams,
// so the scene, the scout and the harness all see the same battle.
//
// Pure. No Math.random.
import { DEFAULT_KEPT_FORGE_AWAKE } from './KeptForges.js';

/** What a step may change, all added to the rung's own values. */
export const ECHO_LEVERS = Object.freeze([
  'enemyLevelBonus',
  'enemyStatBonus',
  'enemyCountBonus',
  'bossStones',
]);

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const count = (v) => Math.max(0, Math.floor(Number(v) || 0));

/** A record's Echo: its rides (at least 1 once it has been kept at all). */
export function recordEcho(record) {
  const rides = count(record?.rides);
  if (rides) return rides;
  const kept = (record?.keptSkills?.length || 0) + (record?.keptItems?.length || 0);
  return kept ? 1 : 0;
}

/** The run's Echo (0 for an ordinary run). */
export function runEcho(run) {
  return count(run?.ngPlus?.echo);
}

/** The game data's NG+ block (difficulty.json `ngPlus`), or null. */
export function ngPlusConfigOf(gameData) {
  const block = gameData?.difficulty?.ngPlus;
  return isObject(block) ? block : null;
}

/** The kept-forge table to use (the data's, else the default). */
export function keptForgeAwakeTable(gameData) {
  const table = ngPlusConfigOf(gameData)?.keptForgeAwake;
  return isObject(table) ? table : DEFAULT_KEPT_FORGE_AWAKE;
}

/** The step an Echo reaches (the highest `minEcho` at or below it), or null. */
export function echoStepFor(echo, gameData) {
  const steps = ngPlusConfigOf(gameData)?.echo;
  if (!Array.isArray(steps)) return null;
  let best = null;
  for (const step of steps)
    if (isObject(step) && count(echo) >= step.minEcho && (!best || step.minEcho > best.minEcho))
      best = step;
  return best;
}

/** The enemy changes for an Echo: every lever, 0 where the step names none. */
export function echoModsFor(echo, gameData) {
  const step = echoStepFor(echo, gameData);
  const mods = {};
  for (const lever of ECHO_LEVERS) mods[lever] = count(step?.[lever]);
  return mods;
}

/** Plain phrases for what an Echo does to enemies, lower case (empty when nothing). */
export function echoEffectLines(echo, gameData) {
  const m = echoModsFor(echo, gameData);
  const lines = [];
  if (m.enemyLevelBonus)
    lines.push(`enemies +${m.enemyLevelBonus} level${m.enemyLevelBonus === 1 ? '' : 's'}`);
  if (m.enemyStatBonus) lines.push(`enemy stats +${m.enemyStatBonus}`);
  if (m.enemyCountBonus) lines.push(`+${m.enemyCountBonus} enemy per map`);
  if (m.bossStones)
    lines.push(`bosses +${m.bossStones} Revival Stone${m.bossStones === 1 ? '' : 's'}`);
  return lines;
}

/** Validate difficulty.json `ngPlus` (absent is valid). */
export function validateNgPlusConfig(block) {
  const errors = [];
  if (block === undefined) return { valid: true, errors };
  if (!isObject(block)) return { valid: false, errors: ['ngPlus must be an object'] };
  if (!Array.isArray(block.echo)) errors.push('ngPlus.echo must be a list of steps');
  else {
    const seen = new Set();
    block.echo.forEach((step, i) => {
      if (!isObject(step)) return errors.push(`ngPlus.echo[${i}] must be an object`);
      if (!Number.isInteger(step.minEcho) || step.minEcho < 1)
        errors.push(`ngPlus.echo[${i}].minEcho must be an integer >= 1`);
      if (seen.has(step.minEcho)) errors.push(`ngPlus.echo[${i}].minEcho repeats`);
      seen.add(step.minEcho);
      for (const key of Object.keys(step)) {
        if (key === 'minEcho') continue;
        if (!ECHO_LEVERS.includes(key)) errors.push(`ngPlus.echo[${i}].${key} is not a lever`);
        else if (!Number.isInteger(step[key]) || step[key] < 0 || step[key] > 10)
          errors.push(`ngPlus.echo[${i}].${key} must be an integer 0-10`);
      }
    });
    // Steps only ever add: a higher Echo is never easier than a lower one.
    const sorted = block.echo.filter(isObject).sort((a, b) => a.minEcho - b.minEcho);
    for (let i = 1; i < sorted.length; i++)
      for (const lever of ECHO_LEVERS)
        if (count(sorted[i][lever]) < count(sorted[i - 1][lever]))
          errors.push(`ngPlus.echo step ${sorted[i].minEcho} lowers ${lever}`);
  }
  if (block.keptForgeAwake !== undefined) {
    if (!isObject(block.keptForgeAwake)) errors.push('ngPlus.keptForgeAwake must be an object');
    else
      for (const [act, limit] of Object.entries(block.keptForgeAwake))
        if (!/^act[1-4]$/.test(act) || !Number.isInteger(limit) || limit < 0)
          errors.push(`ngPlus.keptForgeAwake.${act} must be act1-act4 with an integer >= 0`);
  }
  return { valid: errors.length === 0, errors };
}

/** The boss stone kinds Echo adds to (never an elite captain's: that is the Echo's boss row). */
export const ECHO_STONE_KINDS = Object.freeze(['actBoss', 'emperor', 'lieutenant']);

/**
 * The run's Revival Stones table with Echo's boss stones added (a copy), or the table as it
 * was when Echo adds none. Null in, nothing added: null out.
 */
export function withEchoBossStones(table, bossStones) {
  const add = count(bossStones);
  if (!add) return isObject(table) ? { ...table } : (table ?? null);
  const out = isObject(table)
    ? { ...table }
    : { actBoss: 0, emperor: 0, lieutenant: 0, eliteCaptain: 0 };
  for (const kind of ECHO_STONE_KINDS) out[kind] = count(out[kind]) + add;
  return out;
}
