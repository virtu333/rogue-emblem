// EventValidation.js — semantic checks of data/events.json (docs/specs/event-nodes.md §2),
// run by `npm run validate:data` (tools/validateSchemas.js) after the AJV shape check
// (schemas/events.schema.json), and by tests that plant one bad entry of each kind.
// Pure: no Phaser, no randomness.
//
// What it refuses (each is one error line, prefixed `events.json:<event>[.<choice>[.<outcome>]]`):
//   structure   duplicate ids (events, choices, outcomes); a check without pass and fail
//               outcomes; weights that are missing or not positive; text over its length limit
//               (intro 260, label 32, outcome / fallback / victory text 200, hint 110)
//   effects     an unknown effect type; an effect missing or misusing a field; a
//               skill, item or burden id the game does not have; a battle inside a battle's
//               spoils; a learnSkill outcome with no `fallback`
//   skills      a lord's personal skill, an enemy-only class's innate, or an unknown id in a
//               learnSkill pool
//   blessings   a blessing tier (an effect's or `requires.blessingTier`) with no
//               mid-run-safe blessing (EventSystem.SAFE_BLESSING_BOON_TYPES)
//   targets     an unsatisfiable filter (no class can match it), a `to: target` /
//               `scope: target` effect or a target-reading check on a choice with no `target`
//   {fallen}    the token (or a fallenSkill / layToRest effect) in an event that does not
//               require a fallen ally
//   requires    an unknown key, rung, phase or act
//   playability an event with no choice that is always available (no requirement, cost,
//               target, item room or consumable needed) would soft-lock the route map, as
//               would a missing or demanding fallback event
//   tables      costScale and burdens (every rung priced; the two burdens defined)

import { EVENT_EFFECT_TYPES, EVENT_WEAPON_TYPES, eventWeaponCatalog } from './EventEffects.js';
import {
  EVENT_ACTS,
  FILTER_KEYS,
  REQUIRES_KEYS,
  ROSTER_REQUIRES_KEYS,
  SAFE_BLESSING_BOON_TYPES,
  choiceMayGrantItem,
  isSafeEventBlessing,
  isTeachableSkill,
} from './EventSystem.js';
import { BURDEN_IDS } from './Burdens.js';
import { DIFFICULTY_IDS } from './DifficultyEngine.js';
import { ENEMY_ONLY_CLASS_NAMES, parseWeaponProficiencies } from './UnitManager.js';
import {
  BASE_CLASS_LEVEL_CAP,
  PROMOTED_CLASS_LEVEL_CAP,
  WEAR_MAX_STEPS,
  XP_STAT_NAMES,
} from '../utils/constants.js';

export const EVENT_TEXT_LIMITS = Object.freeze({
  intro: 260,
  label: 32,
  outcome: 200,
  hint: 110,
});

const HP_SCOPES = ['target', 'all', 'commander', 'randomUnit'];
const ITEM_DESTINATIONS = ['target', 'auto', 'convoy'];
const ALL_WEAPON_TYPES = [...EVENT_WEAPON_TYPES, 'Staff', 'Breath'];
const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = (value) => Number.isInteger(value);

/** Flatten an outcome's every effect list (effects, fallback, spoils) with where it sits. */
function effectLists(outcome) {
  const lists = [{ where: 'effects', phase: 'o', effects: outcome.effects || [] }];
  if (Array.isArray(outcome.fallback))
    lists.push({ where: 'fallback', phase: 'o', effects: outcome.fallback });
  for (const effect of [...(outcome.effects || []), ...(outcome.fallback || [])])
    if (effect?.type === 'battle' && Array.isArray(effect.afterVictory))
      lists.push({ where: 'afterVictory', phase: 'a', effects: effect.afterVictory });
  return lists;
}

/** True when some class an army can field (not an enemy-only line or a boss) wields any of the types. */
function someClassWields(classes, types) {
  return (classes || [])
    .filter((cls) => cls.tier !== 'boss' && !ENEMY_ONLY_CLASS_NAMES.has(cls.name))
    .some((cls) =>
      parseWeaponProficiencies(cls.weaponProficiencies).some((p) => types.includes(p.type)),
    );
}

/**
 * Validate an events config against the game data.
 * @param {object} config - data/events.json
 * @param {{ skills, weapons, consumables, classes, blessings, eclipse, lootTables }} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEventsConfig(config, data = {}) {
  const errors = [];
  const err = (where, message) => errors.push(`events.json:${where}: ${message}`);

  if (!isObject(config)) return { valid: false, errors: ['events.json: must be an object'] };
  const events = Array.isArray(config.events) ? config.events : null;
  if (!events) return { valid: false, errors: ['events.json: `events` must be an array'] };

  const skillsById = new Map((data.skills || []).map((s) => [s.id, s]));
  const consumableNames = new Set((data.consumables || []).map((c) => c.name));
  const weaponNames = new Set((data.weapons || []).map((w) => w.name));
  const phaseIds = (data.eclipse?.phases || []).map((p) => p.id);
  const classes = data.classes || [];
  const eventWeapons = eventWeaponCatalog(data);

  // ── Tables ────────────────────────────────────────────────────────────
  for (const rung of DIFFICULTY_IDS) {
    const scale = config.costScale?.[rung];
    if (!(typeof scale === 'number' && scale > 0))
      err('costScale', `needs a positive number for "${rung}"`);
  }
  for (const id of Object.keys(config.costScale || {}))
    if (!DIFFICULTY_IDS.includes(id)) err('costScale', `unknown rung "${id}"`);
  for (const id of BURDEN_IDS) {
    const def = config.burdens?.[id];
    if (!isObject(def)) {
      err('burdens', `burden "${id}" is not defined`);
      continue;
    }
    if (typeof def.label !== 'string' || !def.label) err(`burdens.${id}`, 'needs a label');
    for (const rung of Object.keys(def.onRung || {}))
      if (!DIFFICULTY_IDS.includes(rung)) err(`burdens.${id}`, `unknown rung "${rung}" in onRung`);
  }
  if (isObject(config.burdens))
    for (const id of Object.keys(config.burdens))
      if (!BURDEN_IDS.includes(id)) err('burdens', `unknown burden "${id}"`);

  // ── Blessing tiers an event may ask for ───────────────────────────────
  const safeTiers = new Set(
    (data.blessings?.blessings || []).filter(isSafeEventBlessing).map((b) => b.tier),
  );
  const needsTier = (where, tier) => {
    if (!isInt(tier) || tier < 1 || tier > 4) err(where, `blessing tier "${tier}" must be 1-4`);
    else if (!safeTiers.has(tier))
      err(
        where,
        `blessing tier ${tier} has no mid-run-safe blessing (allow-list: ${SAFE_BLESSING_BOON_TYPES.join(', ')})`,
      );
  };

  // ── Requirement blocks ────────────────────────────────────────────────
  const checkRequires = (where, requires) => {
    if (requires === undefined) return;
    if (!isObject(requires)) return err(where, '`requires` must be an object');
    for (const [key, value] of Object.entries(requires)) {
      if (key === 'reason') {
        if (typeof value !== 'string') err(where, '`requires.reason` must be text');
        continue;
      }
      if (!REQUIRES_KEYS.includes(key)) {
        err(where, `unknown requirement "${key}"`);
        continue;
      }
      if (key === 'acts') {
        if (!Array.isArray(value) || value.some((a) => !EVENT_ACTS.includes(a)))
          err(where, '`requires.acts` must list act1-act4');
      } else if (key === 'difficultyAtLeast' || key === 'difficultyAtMost') {
        if (!DIFFICULTY_IDS.includes(value)) err(where, `unknown rung "${value}" in ${key}`);
      } else if (key === 'phaseAtLeast' || key === 'phaseAtMost') {
        if (!phaseIds.includes(value)) err(where, `unknown Eclipse phase "${value}" in ${key}`);
      } else if (key === 'consumable') {
        if (!consumableNames.has(value)) err(where, `unknown consumable "${value}"`);
      } else if (key === 'notBurden') {
        if (!BURDEN_IDS.includes(value)) err(where, `unknown burden "${value}" in notBurden`);
      } else if (key === 'blessingTier') {
        needsTier(where, value);
      } else if (key === 'roster') {
        if (!isObject(value)) err(where, '`requires.roster` must be an object');
        else
          for (const [k, v] of Object.entries(value)) {
            if (!ROSTER_REQUIRES_KEYS.includes(k)) err(where, `unknown roster requirement "${k}"`);
            else if (k === 'weaponTypes') {
              if (!Array.isArray(v) || v.some((t) => !ALL_WEAPON_TYPES.includes(t)))
                err(where, 'roster.weaponTypes must list weapon types');
              else if (!someClassWields(classes, v)) err(where, `no class wields ${v.join('/')}`);
            }
          }
      } else if (key === 'fallen') {
        if (typeof value !== 'boolean') err(where, '`requires.fallen` must be true or false');
      } else if (['flag', 'notFlag'].includes(key)) {
        if (typeof value !== 'string' || !value)
          err(where, `\`requires.${key}\` must be a flag key`);
      } else if (['minRow', 'maxRow', 'goldAtLeast'].includes(key)) {
        if (key === 'goldAtLeast' ? !isAmount(value) : !isInt(value)) err(where, `bad ${key}`);
      }
    }
  };

  function isAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    return (
      isObject(value) && Number.isFinite(value.base ?? 0) && Number.isFinite(value.perAct ?? 0)
    );
  }

  // ── A target filter must be satisfiable by some class ─────────────────
  const checkFilter = (where, filter, event) => {
    if (!isObject(filter)) return err(where, '`target.filter` must be an object');
    for (const key of Object.keys(filter))
      if (!FILTER_KEYS.includes(key)) err(where, `unknown filter "${key}"`);
    if (filter.weaponTypes !== undefined) {
      if (
        !Array.isArray(filter.weaponTypes) ||
        filter.weaponTypes.some((t) => !ALL_WEAPON_TYPES.includes(t))
      )
        err(where, 'filter.weaponTypes must list weapon types');
      else if (!someClassWields(classes, filter.weaponTypes))
        err(where, `unsatisfiable filter: no class wields ${filter.weaponTypes.join('/')}`);
    }
    if (filter.magic && !someClassWields(classes, ['Tome', 'Light']))
      err(where, 'unsatisfiable filter: no class casts');
    if (filter.staff && !someClassWields(classes, ['Staff']))
      err(where, 'unsatisfiable filter: no class uses a staff');
    if (filter.minLevel !== undefined) {
      if (!isInt(filter.minLevel) || filter.minLevel < 1)
        err(where, 'filter.minLevel must be a whole number');
      else if (filter.minLevel > Math.max(BASE_CLASS_LEVEL_CAP, PROMOTED_CLASS_LEVEL_CAP))
        err(where, `unsatisfiable filter: no unit reaches level ${filter.minLevel}`);
    }
    if (filter.learnsFromFallen && event.requires?.fallen !== true)
      err(where, 'filter.learnsFromFallen needs an event that requires a fallen ally');
  };

  // ── Effects ───────────────────────────────────────────────────────────
  const checkAmount = (where, label, value) => {
    if (!isAmount(value)) err(where, `${label} must be a number or { base, perAct }`);
  };

  const checkSkillIds = (where, ids) => {
    if (!Array.isArray(ids) || ids.length === 0)
      return err(where, 'skill pool must be a non-empty list');
    for (const id of ids) {
      const skill = skillsById.get(id);
      if (!skill) err(where, `unknown skill "${id}"`);
      else if (!isTeachableSkill(skill))
        err(
          where,
          `skill "${id}" is a lord's personal or an enemy-only skill and cannot be taught`,
        );
    }
  };

  const checkEffect = (where, effect, { event, choice, phase }) => {
    if (!isObject(effect) || typeof effect.type !== 'string')
      return err(where, 'an effect needs a type');
    if (!EVENT_EFFECT_TYPES.includes(effect.type))
      return err(where, `unknown effect type "${effect.type}"`);
    const needsTarget = () => {
      if (!choice.target)
        err(where, `${effect.type} reads the chosen unit but the choice has no target`);
    };
    switch (effect.type) {
      case 'gold':
        checkAmount(where, 'gold value', effect.value);
        break;
      case 'item': {
        if (effect.to !== undefined && !ITEM_DESTINATIONS.includes(effect.to))
          err(where, `item.to must be one of ${ITEM_DESTINATIONS.join(', ')}`);
        if (effect.to === 'target') needsTarget();
        if (
          effect.wear !== undefined &&
          !(isInt(effect.wear) && effect.wear >= 0 && effect.wear <= WEAR_MAX_STEPS)
        )
          err(where, `item.wear must be a whole number 0-${WEAR_MAX_STEPS}`);
        if (effect.name !== undefined) {
          if (!weaponNames.has(effect.name) && !consumableNames.has(effect.name))
            err(where, `unknown item "${effect.name}"`);
        } else if (isObject(effect.pool)) {
          const pool = effect.pool;
          if (pool.kind !== 'weapon') err(where, 'item.pool.kind must be "weapon"');
          if (pool.weaponTypes === '$target') needsTarget();
          else if (pool.weaponTypes !== '$army') {
            if (
              !Array.isArray(pool.weaponTypes) ||
              pool.weaponTypes.some((t) => !EVENT_WEAPON_TYPES.includes(t))
            )
              err(
                where,
                'item.pool.weaponTypes must be "$target", "$army" or a list of weapon types',
              );
          }
          if (
            !(
              isInt(pool.tierOffset ?? 0) &&
              (pool.tierOffset ?? 0) >= 0 &&
              (pool.tierOffset ?? 0) <= 2
            )
          )
            err(where, 'item.pool.tierOffset must be 0-2');
          // A pool of listed types must hold at least one event weapon.
          if (
            Array.isArray(pool.weaponTypes) &&
            !eventWeapons.some((w) => pool.weaponTypes.includes(w.type))
          )
            err(where, `no event weapon exists for ${pool.weaponTypes.join('/')}`);
        } else err(where, 'item needs a `name` or a `pool`');
        break;
      }
      case 'learnSkill': {
        needsTarget();
        if (effect.to !== undefined && effect.to !== 'target')
          err(where, 'learnSkill.to must be "target"');
        const forms = ['skillId', 'pool', 'poolByType'].filter((k) => effect[k] !== undefined);
        if (forms.length !== 1)
          err(where, 'learnSkill needs exactly one of skillId, pool, poolByType');
        else if (effect.skillId !== undefined) checkSkillIds(where, [effect.skillId]);
        else if (effect.pool !== undefined) checkSkillIds(where, effect.pool);
        else if (isObject(effect.poolByType)) {
          for (const [type, ids] of Object.entries(effect.poolByType)) {
            if (!ALL_WEAPON_TYPES.includes(type))
              err(where, `unknown weapon type "${type}" in poolByType`);
            checkSkillIds(`${where}.${type}`, ids);
          }
        } else err(where, 'poolByType must be an object');
        break;
      }
      case 'fallenSkill':
        needsTarget();
        if (event.requires?.fallen !== true)
          err(where, 'fallenSkill needs an event that requires a fallen ally');
        break;
      case 'layToRest':
        if (event.requires?.fallen !== true)
          err(where, 'layToRest needs an event that requires a fallen ally');
        break;
      case 'hp': {
        if (!['damage', 'heal'].includes(effect.mode)) err(where, 'hp.mode must be damage or heal');
        if (!HP_SCOPES.includes(effect.scope))
          err(where, `hp.scope must be one of ${HP_SCOPES.join(', ')}`);
        if (effect.scope === 'target') needsTarget();
        const forms = ['percent', 'value', 'to'].filter((k) => effect[k] !== undefined);
        if (forms.length !== 1) err(where, 'hp needs exactly one of percent, value, to');
        if (
          effect.percent !== undefined &&
          !(Number.isFinite(effect.percent) && effect.percent > 0 && effect.percent <= 100)
        )
          err(where, 'hp.percent must be 1-100');
        if (effect.value !== undefined && !(isInt(effect.value) && effect.value > 0))
          err(where, 'hp.value must be a positive whole number');
        if (
          effect.to !== undefined &&
          !(isInt(effect.to) && effect.to >= 1 && effect.mode === 'damage')
        )
          err(where, 'hp.to must be a whole number >= 1 and only with damage');
        for (const [rung, p] of Object.entries(effect.percentByRung || {})) {
          if (!DIFFICULTY_IDS.includes(rung)) err(where, `unknown rung "${rung}" in percentByRung`);
          if (!(Number.isFinite(p) && p > 0 && p <= 100))
            err(where, 'percentByRung values must be 1-100');
        }
        break;
      }
      case 'shadow':
        if (!isInt(effect.value) || effect.value === 0)
          err(where, 'shadow.value must be a non-zero whole number');
        break;
      case 'vision':
        if (!isInt(effect.value) || effect.value === 0)
          err(where, 'vision.value must be a non-zero whole number');
        break;
      case 'blessing':
        needsTier(where, effect.tier);
        break;
      case 'burden':
        if (!BURDEN_IDS.includes(effect.id)) err(where, `unknown burden "${effect.id}"`);
        else if (effect.id === 'debt') {
          if (effect.params?.owed === undefined) err(where, 'debt needs params.owed');
          else checkAmount(where, 'debt owed', effect.params.owed);
        } else if (effect.id === 'ill_omen') {
          for (const key of ['battles', 'extraShadow'])
            if (
              effect.params?.[key] !== undefined &&
              !(isInt(effect.params[key]) && effect.params[key] > 0)
            )
              err(where, `ill_omen.${key} must be a positive whole number`);
        }
        break;
      case 'flag':
        if (typeof effect.key !== 'string' || !effect.key) err(where, 'flag needs a key');
        if (
          effect.value !== undefined &&
          !['string', 'number', 'boolean'].includes(typeof effect.value)
        )
          err(where, 'flag.value must be text, a number or true/false');
        break;
      case 'consume':
        if (!consumableNames.has(effect.name)) err(where, `unknown consumable "${effect.name}"`);
        if (effect.uses !== undefined && !(isInt(effect.uses) && effect.uses >= 1))
          err(where, 'consume.uses must be a whole number >= 1');
        if (choice.requires?.consumable !== effect.name)
          err(where, `consume "${effect.name}" needs the choice to require that consumable`);
        break;
      case 'stat': {
        const stats = Array.isArray(effect.stat) ? effect.stat : [effect.stat];
        if (stats.length === 0 || stats.some((s) => !XP_STAT_NAMES.includes(s)))
          err(where, `stat must be one or more of ${XP_STAT_NAMES.join(', ')}`);
        if (!isInt(effect.value) || effect.value === 0)
          err(where, 'stat.value must be a non-zero whole number');
        if (!['target', 'lowestLevel'].includes(effect.scope))
          err(where, 'stat.scope must be target or lowestLevel');
        if (effect.scope === 'target') needsTarget();
        break;
      }
      case 'battle':
        if (phase !== 'o')
          err(where, 'a battle cannot start inside a battle or a choice-level effect list');
        if (
          !isInt(effect.enemyLevelBonus ?? 0) ||
          (effect.enemyLevelBonus ?? 0) < 0 ||
          (effect.enemyLevelBonus ?? 0) > 5
        )
          err(where, 'battle.enemyLevelBonus must be 0-5');
        if (!Array.isArray(effect.afterVictory ?? []))
          err(where, 'battle.afterVictory must be a list');
        if (typeof effect.victoryText !== 'string' || !effect.victoryText)
          err(where, 'battle needs a victoryText');
        else if (effect.victoryText.length > EVENT_TEXT_LIMITS.outcome)
          err(where, `victoryText is over ${EVENT_TEXT_LIMITS.outcome} characters`);
        break;
      default:
    }
  };

  const textCheck = (where, text, limit, label) => {
    if (typeof text !== 'string' || !text.trim()) return err(where, `${label} is missing`);
    if (text.length > limit) err(where, `${label} is ${text.length} characters (limit ${limit})`);
  };

  // ── Events ────────────────────────────────────────────────────────────
  const eventIds = new Set();
  let fallbackCount = 0;
  for (const event of events) {
    const ew = isObject(event) && typeof event.id === 'string' ? event.id : '(no id)';
    if (!isObject(event)) {
      err(ew, 'an event must be an object');
      continue;
    }
    if (!ID_PATTERN.test(event.id || '')) err(ew, 'id must be lower_snake_case');
    if (eventIds.has(event.id)) err(ew, 'duplicate event id');
    eventIds.add(event.id);
    textCheck(ew, event.title, 60, 'title');
    textCheck(ew, event.intro, EVENT_TEXT_LIMITS.intro, 'intro');
    if (!(Number.isFinite(event.weight) && event.weight >= 0))
      err(ew, 'weight must be a number >= 0');
    if (event.fallback !== true && !(event.weight > 0))
      err(ew, 'a normal event needs a positive weight');
    if (
      event.acts !== undefined &&
      (!Array.isArray(event.acts) ||
        event.acts.length === 0 ||
        event.acts.some((a) => !EVENT_ACTS.includes(a)))
    )
      err(ew, '`acts` must list act1-act4');
    if (event.oncePerRun !== undefined && typeof event.oncePerRun !== 'boolean')
      err(ew, 'oncePerRun must be true or false');
    checkRequires(ew, event.requires);
    const eventText = JSON.stringify(event);
    if (eventText.includes('{fallen}') && event.requires?.fallen !== true)
      err(ew, '{fallen} is only for an event that requires a fallen ally');

    if (event.fallback === true) {
      fallbackCount++;
      if (event.weight !== 0) err(ew, 'the fallback event must have weight 0');
      if (event.oncePerRun !== false) err(ew, 'the fallback event must not be once-per-run');
      if (event.requires || event.acts)
        err(ew, 'the fallback event must be eligible in every act with no requirements');
    }

    if (!Array.isArray(event.choices) || event.choices.length === 0) {
      err(ew, 'needs at least one choice');
      continue;
    }
    const choiceIds = new Set();
    let hasFreeChoice = false;
    for (const choice of event.choices) {
      const cw = `${ew}.${isObject(choice) ? choice.id : '(no id)'}`;
      if (!isObject(choice)) {
        err(cw, 'a choice must be an object');
        continue;
      }
      if (!ID_PATTERN.test(choice.id || '')) err(cw, 'id must be lower_snake_case');
      if (choiceIds.has(choice.id)) err(cw, 'duplicate choice id');
      choiceIds.add(choice.id);
      textCheck(cw, choice.label, EVENT_TEXT_LIMITS.label, 'label');
      if (choice.hint !== undefined) textCheck(cw, choice.hint, EVENT_TEXT_LIMITS.hint, 'hint');
      checkRequires(cw, choice.requires);
      if (choice.target !== undefined) {
        if (!isObject(choice.target)) err(cw, '`target` must be an object');
        else {
          textCheck(cw, choice.target.prompt, 60, 'target.prompt');
          checkFilter(cw, choice.target.filter ?? {}, event);
        }
      }
      if (choice.cost !== undefined) {
        if (!isObject(choice.cost) || !isAmount(choice.cost.gold))
          err(cw, '`cost` must be { gold }');
        else if (resolveFirst(choice.cost.gold) <= 0) err(cw, 'cost.gold must be positive');
      }
      for (const [i, effect] of (choice.effects || []).entries())
        checkEffect(`${cw}.effects[${i}]`, effect, { event, choice, phase: 'c' });

      // Outcomes
      const outcomes = Array.isArray(choice.outcomes) ? choice.outcomes : [];
      if (outcomes.length === 0) err(cw, 'needs at least one outcome');
      const outcomeIds = new Set();
      if (choice.check !== undefined) {
        const check = choice.check;
        if (!isObject(check)) err(cw, '`check` must be an object');
        else {
          if (
            !Array.isArray(check.stats) ||
            check.stats.length === 0 ||
            check.stats.some((s) => !XP_STAT_NAMES.includes(s))
          )
            err(cw, `check.stats must list stats (${XP_STAT_NAMES.join(', ')})`);
          if (!['target', 'bestInArmy'].includes(check.of))
            err(cw, 'check.of must be target or bestInArmy');
          if (check.of === 'target' && !choice.target)
            err(cw, 'a check of the target needs a choice target');
          for (const key of ['base', 'perPoint', 'against'])
            if (!Number.isFinite(check[key])) err(cw, `check.${key} must be a number`);
          for (const key of ['min', 'max'])
            if (
              check[key] !== undefined &&
              !(Number.isFinite(check[key]) && check[key] >= 0 && check[key] <= 1)
            )
              err(cw, `check.${key} must be 0-1`);
          for (const rung of Object.keys(check.byRung || {}))
            if (!DIFFICULTY_IDS.includes(rung)) err(cw, `unknown rung "${rung}" in check.byRung`);
        }
        const ids = outcomes.map((o) => o?.id).sort();
        if (ids.length !== 2 || ids[0] !== 'fail' || ids[1] !== 'pass')
          err(cw, 'a check needs exactly a "pass" and a "fail" outcome');
        for (const o of outcomes)
          if (o?.weight !== undefined || o?.weightByRung !== undefined)
            err(cw, "a check choice's outcomes carry no weights");
      }
      for (const outcome of outcomes) {
        const ow = `${cw}.${isObject(outcome) ? outcome.id : '(no id)'}`;
        if (!isObject(outcome)) {
          err(ow, 'an outcome must be an object');
          continue;
        }
        if (!ID_PATTERN.test(outcome.id || '')) err(ow, 'id must be lower_snake_case');
        if (outcomeIds.has(outcome.id)) err(ow, 'duplicate outcome id');
        outcomeIds.add(outcome.id);
        textCheck(ow, outcome.text, EVENT_TEXT_LIMITS.outcome, 'text');
        if (outcome.fallbackText !== undefined)
          textCheck(ow, outcome.fallbackText, EVENT_TEXT_LIMITS.outcome, 'fallbackText');
        if (choice.check === undefined) {
          if (!(Number.isFinite(outcome.weight) && outcome.weight > 0))
            err(ow, 'weight must be a positive number');
          for (const [rung, w] of Object.entries(outcome.weightByRung || {})) {
            if (!DIFFICULTY_IDS.includes(rung)) err(ow, `unknown rung "${rung}" in weightByRung`);
            if (!(Number.isFinite(w) && w > 0)) err(ow, 'weightByRung values must be positive');
          }
        }
        if (!Array.isArray(outcome.effects)) err(ow, '`effects` must be a list (empty for none)');
        for (const { where, phase, effects } of effectLists(outcome))
          for (const [i, effect] of effects.entries())
            checkEffect(`${ow}.${where}[${i}]`, effect, { event, choice, phase });
        const teaching = (outcome.effects || []).some((e) => e?.type === 'learnSkill');
        if (teaching && !Array.isArray(outcome.fallback))
          err(ow, 'an outcome that teaches a skill needs a `fallback` (the pool can be empty)');
        if (
          outcome.fallback !== undefined &&
          !teaching &&
          !(outcome.effects || []).some((e) => e?.type === 'fallenSkill')
        )
          err(ow, '`fallback` is only for outcomes that teach a skill');
        const battles = (outcome.effects || []).filter((e) => e?.type === 'battle').length;
        if (battles > 1) err(ow, 'at most one battle per outcome');
      }
      // Weights of a normal choice must leave something to roll.
      if (choice.check === undefined && outcomes.length > 0 && !outcomes.some((o) => o?.weight > 0))
        err(cw, 'no outcome has a positive weight');

      // Always-available: nothing required, nothing to pay or pick, nothing to carry.
      const unconditional =
        !choice.requires &&
        !choice.cost &&
        !choice.target &&
        !choiceMayGrantItem(choice) &&
        !(choice.effects || []).some((e) => e?.type === 'consume') &&
        !outcomes.some((o) =>
          (o?.effects || []).some((e) => ['blessing', 'consume'].includes(e?.type)),
        );
      if (unconditional) hasFreeChoice = true;
    }
    if (!hasFreeChoice)
      err(
        ew,
        'no choice is always available (no requirement, cost, target, item or blessing): the road would soft-lock',
      );
  }
  if (fallbackCount !== 1)
    err('events', `expected exactly one fallback event, found ${fallbackCount}`);

  function resolveFirst(value) {
    return typeof value === 'number'
      ? value
      : (Number(value?.base) || 0) + (Number(value?.perAct) || 0);
  }

  return { valid: errors.length === 0, errors };
}
