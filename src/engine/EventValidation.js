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
//               mid-run-safe blessing (EventSystem.SAFE_BLESSING_BOON_TYPES); an `earnedBlessing`
//               effect or `requires.earnedAvailable` naming anything but an earned blessing an
//               event can give (its `sources` include `event`)
//   targets     an unsatisfiable filter (no class can match it), a `to: target` /
//               `scope: target` effect or a target-reading check on a choice with no `target`
//   {fallen}    the token (or a fallenSkill / layToRest effect) in an event that does not
//               require a fallen ally
//   requires    an unknown key, rung, phase or act
//   playability an event with no choice that is always available (no requirement, cost,
//               target, item room or consumable needed) would soft-lock the route map, as
//               would a missing or demanding fallback event
//   tables      costScale and burdens (every rung priced; every burden defined)
// Phase 2 (docs/specs/event-nodes-phase2.md §2A):
//   pages       a `pages` entry named `start` or without text and choices; an outcome's `next`
//               naming no page, or sitting beside a battle; a page nothing leads to; a page
//               with no guaranteed way out (an always-available choice whose every outcome
//               ends the event or leads on to a page that has one: the road would trap the
//               player in a loop)
//   counters    a counter that is not a whole number, a byRung table or label for a counter
//               the event does not declare, a `counter` effect or `counterAtLeast` on one it
//               does not declare, `counterAtLeast` on the event itself (it has no counters
//               before it is picked)
//   join        a class that is unknown, enemy-only, a boss, in no recruit pool, or promoted
//               and not in the pool of every act the choice can play in; both or neither of
//               `class` / `classPool`; a bad name, `levelOffset` or `trait`
//   contract    an unknown goal, an effect in its reward or penalty that needs a chosen unit
//               or is not one of CONTRACT_EFFECT_TYPES, a contract beside a battle in the same
//               choice, a contract in a battle's spoils
//   routeEdit   an unknown op or type, one at choice level or in a battle's spoils, an
//               outcome that has no `fallback` (the road may have nothing to change), more
//               than one in an outcome
//   tells       a `when` without exactly one known key or naming something that does not exist,
//               a line over its limit or with a token other than {name}, both or neither of
//               `reveals` / `tilts`, `reveals` naming an outcome the choice cannot have or
//               sitting on a check choice (a check's outcome depends on who is chosen),
//               `tilts` on a choice that is not a check or more than one `tilts` tell
//   flags       `flagAct` without `flag`, or with a value that is not earlier / current / an act
// Phase 2B (docs/specs/event-nodes-phase2.md §2B):
//   burdens     the five burdens defined, battles whole numbers from 1, a Hunted wave in range,
//               a wound a small negative; a `wounded` effect with no scope or stat
//   dark        a `dark` block (the Dark Omen face: { intro, choices, pages? }) that is not an object,
//               has an unknown key, or fails the plain face's rules (soft-locks included)

import {
  BEST_STAT_CHOICES,
  EVENT_EFFECT_TYPES,
  EVENT_WEAPON_TYPES,
  accessoryPoolFor,
  eventWeaponCatalog,
} from './EventEffects.js';
import {
  EVENT_ACTS,
  FILTER_KEYS,
  FLAG_ACT_KEYWORDS,
  REQUIRES_KEYS,
  ROSTER_REQUIRES_KEYS,
  SAFE_BLESSING_BOON_TYPES,
  START_PAGE,
  byRungValue,
  choiceMayGrantItem,
  choiceMayOpenContract,
  isSafeEventBlessing,
  isTeachableSkill,
} from './EventSystem.js';
import { CONTRACT_EFFECT_TYPES, CONTRACT_GOALS } from './Contracts.js';
import { joinClassBlock } from './EventJoin.js';
import { REDRAW_TYPES } from './RouteEdit.js';
import { TELL_WHEN_KEYS } from './EventTells.js';
import {
  BURDEN_IDS,
  HUNTED_COUNT_MAX,
  HUNTED_TURN_RANGE,
  WOUND_MAX_PENALTY,
  WOUND_STATS,
} from './Burdens.js';
import { DIFFICULTY_IDS } from './DifficultyEngine.js';
import { earnedSourcesOf } from './EarnedBlessings.js';
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
  tell: 90,
  counterLabel: 20,
});

const HP_SCOPES = ['target', 'all', 'commander', 'randomUnit'];
const ITEM_DESTINATIONS = ['target', 'auto', 'convoy'];
/** What a wound may name: a stat, `random` (seeded) or `attack` (the unit's STR or MAG). */
const WOUND_STAT_CHOICES = [...WOUND_STATS, 'random', 'attack'];
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
  const traitIds = new Set((data.traits || []).map((t) => t.id));

  /** The acts a choice can play in: its event's acts narrowed by the choice's own `requires.acts`. */
  function joinActs(event, choice) {
    const own = Array.isArray(event?.acts) && event.acts.length ? event.acts : EVENT_ACTS;
    const need = choice?.requires?.acts;
    return Array.isArray(need) ? own.filter((act) => need.includes(act)) : own;
  }

  /** Counters: whole numbers from 0, with byRung tables and labels only for declared counters. */
  function checkCounters(ew, event) {
    const declared = event.counters;
    if (declared !== undefined) {
      if (!isObject(declared)) err(ew, '`counters` must be an object');
      else
        for (const [key, value] of Object.entries(declared)) {
          if (!ID_PATTERN.test(key)) err(ew, `counter "${key}" must be lower_snake_case`);
          if (!(isInt(value) && value >= 0))
            err(ew, `counter "${key}" must be a whole number >= 0`);
        }
    }
    const names = isObject(declared) ? declared : {};
    for (const [field, check] of [
      [
        'countersByRung',
        (key, table) => {
          if (!isObject(table)) return err(ew, `countersByRung.${key} must be a byRung table`);
          for (const [rung, n] of Object.entries(table)) {
            if (!DIFFICULTY_IDS.includes(rung))
              err(ew, `unknown rung "${rung}" in countersByRung.${key}`);
            if (!(isInt(n) && n >= 0))
              err(ew, `countersByRung.${key}.${rung} must be a whole number >= 0`);
          }
        },
      ],
      [
        'counterLabels',
        (key, label) => {
          if (
            typeof label !== 'string' ||
            !label.trim() ||
            label.length > EVENT_TEXT_LIMITS.counterLabel
          )
            err(ew, `counterLabels.${key} must be 1-${EVENT_TEXT_LIMITS.counterLabel} characters`);
        },
      ],
    ]) {
      if (event[field] === undefined) continue;
      if (!isObject(event[field])) {
        err(ew, `\`${field}\` must be an object`);
        continue;
      }
      for (const [key, value] of Object.entries(event[field])) {
        if (!Object.hasOwn(names, key))
          err(ew, `${field} names a counter the event does not declare ("${key}")`);
        else check(key, value);
      }
    }
  }

  /** Roster tells: a known `when`, a short honest line, and a true `reveals` or a real `tilts`. */
  function checkTells(cw, choice, outcomes) {
    if (choice.tells === undefined) return;
    if (!Array.isArray(choice.tells)) return err(cw, '`tells` must be a list');
    const outcomeById = new Map(outcomes.filter(isObject).map((o) => [o.id, o]));
    let tilts = 0;
    for (const [i, tell] of choice.tells.entries()) {
      const tw = `${cw}.tells[${i}]`;
      if (!isObject(tell)) {
        err(tw, 'a tell must be an object');
        continue;
      }
      // when: exactly one key, naming something that exists.
      const keys = isObject(tell.when) ? Object.keys(tell.when) : [];
      if (keys.length !== 1 || !TELL_WHEN_KEYS.includes(keys[0]))
        err(tw, `when needs exactly one of ${TELL_WHEN_KEYS.join(', ')}`);
      else {
        const [key] = keys;
        const value = tell.when[key];
        const knownClass = (name) =>
          classes.some((cls) => cls.name === name && !ENEMY_ONLY_CLASS_NAMES.has(name));
        if (key === 'class' && !knownClass(value)) err(tw, `unknown class "${value}"`);
        else if (key === 'classes') {
          if (!Array.isArray(value) || value.length === 0 || !value.every(knownClass))
            err(tw, 'when.classes must list known classes');
        } else if (key === 'weaponType' && !ALL_WEAPON_TYPES.includes(value))
          err(tw, `unknown weapon type "${value}"`);
        else if (key === 'trait' && !traitIds.has(value)) err(tw, `unknown trait "${value}"`);
        else if (key === 'skill' && !skillsById.has(value)) err(tw, `unknown skill "${value}"`);
      }
      // The line: short, in {name}'s voice, no other token and no digits-as-odds.
      textCheck(tw, tell.line, EVENT_TEXT_LIMITS.tell, 'line');
      if (typeof tell.line === 'string') {
        const tokens = tell.line.match(/\{[^}]*\}/g) || [];
        if (tokens.some((token) => token !== '{name}'))
          err(tw, 'a tell line may only use the {name} token');
      }
      // reveals xor tilts.
      if ((tell.reveals === undefined) === (tell.tilts === undefined))
        err(tw, 'a tell needs exactly one of reveals, tilts');
      if (tell.reveals !== undefined) {
        const target = outcomeById.get(tell.reveals);
        if (!target)
          err(tw, `reveals names an outcome the choice does not have ("${tell.reveals}")`);
        else if (choice.check !== undefined)
          err(
            tw,
            'reveals is not for a check choice (its outcome depends on who is chosen): use tilts',
          );
        else if (
          !(
            Number(target.weight) > 0 ||
            Object.values(target.weightByRung || {}).some((w) => Number(w) > 0)
          )
        )
          err(tw, `reveals names an outcome that cannot happen ("${tell.reveals}")`);
      }
      if (tell.tilts !== undefined) {
        tilts++;
        if (tell.tilts !== 'pass') err(tw, 'tilts must be "pass"');
        if (choice.check === undefined) err(tw, 'tilts is only for a choice with a check');
      }
    }
    if (tilts > 1) err(cw, 'at most one tell per choice may tilt the check');
  }

  // ── Tables ────────────────────────────────────────────────────────────
  /**
   * The numbers of a burden definition (or of an `onRung` override, merged over `base`):
   * battles are whole numbers from 1, a Hunted wave is in range, a wound is a small negative.
   */
  function checkBurdenNumbers(where, entry, base = null) {
    const id = where.split('.')[0];
    const w = `burdens.${where}`;
    const merged = { ...(base || {}), ...entry };
    if (entry.battles !== undefined && !(isInt(entry.battles) && entry.battles >= 1))
      err(w, 'battles must be a whole number >= 1');
    if (base === null && ['ill_omen', 'hunted', 'wounded'].includes(id) && !isInt(merged.battles))
      err(w, 'needs `battles`');
    if (entry.wave !== undefined || (base === null && id === 'hunted')) {
      const wave = merged.wave;
      if (!isObject(wave)) err(w, 'needs a `wave` { turn, count, xpMultiplier }');
      else {
        if (
          !(
            isInt(wave.turn) &&
            wave.turn >= HUNTED_TURN_RANGE[0] &&
            wave.turn <= HUNTED_TURN_RANGE[1]
          )
        )
          err(w, `wave.turn must be ${HUNTED_TURN_RANGE[0]}-${HUNTED_TURN_RANGE[1]}`);
        if (
          !(
            Array.isArray(wave.count) &&
            wave.count.length === 2 &&
            wave.count.every((n) => isInt(n) && n >= 1 && n <= HUNTED_COUNT_MAX) &&
            wave.count[0] <= wave.count[1]
          )
        )
          err(w, `wave.count must be [min, max] within 1-${HUNTED_COUNT_MAX}`);
        if (
          !(
            typeof wave.xpMultiplier === 'number' &&
            wave.xpMultiplier >= 0 &&
            wave.xpMultiplier <= 1
          )
        )
          err(w, 'wave.xpMultiplier must be 0-1');
      }
    }
    if (entry.value !== undefined || (base === null && id === 'wounded')) {
      if (!(isInt(merged.value) && merged.value < 0 && merged.value >= -WOUND_MAX_PENALTY))
        err(w, `value must be a whole number from -${WOUND_MAX_PENALTY} to -1`);
    }
  }
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
    checkBurdenNumbers(id, def);
    for (const [rung, override] of Object.entries(def.onRung || {}))
      if (isObject(override)) checkBurdenNumbers(`${id}.onRung.${rung}`, override, def);
  }
  if (isObject(config.burdens))
    for (const id of Object.keys(config.burdens))
      if (!BURDEN_IDS.includes(id)) err('burdens', `unknown burden "${id}"`);

  // ── Blessing tiers an event may ask for ───────────────────────────────
  const safeTiers = new Set(
    (data.blessings?.blessings || []).filter(isSafeEventBlessing).map((b) => b.tier),
  );
  // Earned blessings an event may hand out: earned, won from events (docs/specs/blessings-v3.md §6).
  const eventEarnedIds = new Set(
    (data.blessings?.blessings || [])
      .filter((b) => earnedSourcesOf(b).some((s) => s.kind === 'event'))
      .map((b) => b.id),
  );
  const needsEventEarned = (where, id) => {
    if (typeof id !== 'string' || !eventEarnedIds.has(id))
      err(
        where,
        `"${id}" is not an earned blessing an event can give (sources must include event)`,
      );
  };
  const needsTier = (where, tier) => {
    if (!isInt(tier) || tier < 1 || tier > 4) err(where, `blessing tier "${tier}" must be 1-4`);
    else if (!safeTiers.has(tier))
      err(
        where,
        `blessing tier ${tier} has no mid-run-safe blessing (allow-list: ${SAFE_BLESSING_BOON_TYPES.join(', ')})`,
      );
  };

  // ── Requirement blocks ────────────────────────────────────────────────
  const checkRequires = (where, requires, event = null, atEvent = false) => {
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
      } else if (key === 'notContract') {
        if (value !== true) err(where, '`requires.notContract` must be true');
      } else if (key === 'roadAhead') {
        if (value !== true) err(where, '`requires.roadAhead` must be true');
      } else if (key === 'blessingTier') {
        needsTier(where, value);
      } else if (key === 'earnedAvailable') {
        needsEventEarned(where, value);
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
      } else if (key === 'flagAct') {
        if (!FLAG_ACT_KEYWORDS.includes(value) && !EVENT_ACTS.includes(value))
          err(where, `\`requires.flagAct\` must be ${FLAG_ACT_KEYWORDS.join(', ')} or an act id`);
        if (requires.flag === undefined) err(where, '`requires.flagAct` needs `requires.flag`');
      } else if (key === 'counterAtLeast') {
        if (atEvent)
          err(where, 'an event cannot require a counter: it has none until it is picked');
        else if (
          !isObject(value) ||
          typeof value.key !== 'string' ||
          !isInt(value.n) ||
          value.n < 1
        )
          err(where, '`requires.counterAtLeast` must be { key, n } with a whole n >= 1');
        else if (!Object.hasOwn(event?.counters || {}, value.key))
          err(where, `counterAtLeast names a counter the event does not declare ("${value.key}")`);
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
    for (const key of ['wornWeapon', 'forgeableWeapon'])
      if (filter[key] !== undefined && typeof filter[key] !== 'boolean')
        err(where, `filter.${key} must be true or false`);
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
        if (effect.refund !== undefined) {
          // The price of the choice, handed back: only where there is a price to give back.
          if (effect.refund !== true || effect.value !== undefined)
            err(where, 'gold.refund must be true and then stands alone (no value)');
          else if (!choice.cost) err(where, 'gold.refund needs a choice with a cost');
          else if (phase !== 'o') err(where, 'gold.refund belongs in an outcome or its fallback');
        } else checkAmount(where, 'gold value', effect.value);
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
        } else if (isObject(effect.pool) && effect.pool.kind === 'accessory') {
          // An accessory from the loot table `tierOffset` tiers up, into the accessory pool.
          const pool = effect.pool;
          if (
            !(
              isInt(pool.tierOffset ?? 0) &&
              (pool.tierOffset ?? 0) >= 0 &&
              (pool.tierOffset ?? 0) <= 3
            )
          )
            err(where, 'item.pool.tierOffset must be 0-3');
          if (pool.weaponTypes !== undefined) err(where, 'an accessory pool has no weaponTypes');
          if (effect.wear !== undefined) err(where, 'an accessory does not wear');
          if (effect.to !== undefined)
            err(where, 'an accessory goes to the accessory pool (no `to`)');
          for (const act of joinActs(event, choice)) {
            const have = accessoryPoolFor(
              {
                currentAct: act,
                gameData: { lootTables: data.lootTables, accessories: data.accessories },
              },
              pool.tierOffset ?? 0,
            );
            if (have.length === 0) err(where, `no accessory exists in ${act}'s pool at that tier`);
          }
        } else if (isObject(effect.pool)) {
          const pool = effect.pool;
          if (pool.kind !== 'weapon') err(where, 'item.pool.kind must be "weapon" or "accessory"');
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
      case 'earnedBlessing':
        needsEventEarned(where, effect.id);
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
        } else if (effect.id === 'hunted') {
          if (
            effect.params?.battles !== undefined &&
            !(isInt(effect.params.battles) && effect.params.battles > 0)
          )
            err(where, 'hunted.battles must be a positive whole number');
        } else if (effect.id === 'wounded') {
          // Who is wounded and where: `scope` (a chosen unit or a seeded living one) and `stat`.
          const params = effect.params || {};
          if (!['target', 'randomUnit'].includes(params.scope))
            err(where, 'wounded needs params.scope: target or randomUnit');
          else if (params.scope === 'target') needsTarget();
          if (!WOUND_STAT_CHOICES.includes(params.stat))
            err(where, `wounded needs params.stat: one of ${WOUND_STAT_CHOICES.join(', ')}`);
          if (
            params.value !== undefined &&
            !(isInt(params.value) && params.value < 0 && params.value >= -WOUND_MAX_PENALTY)
          )
            err(where, `wounded.value must be a whole number from -${WOUND_MAX_PENALTY} to -1`);
          if (params.battles !== undefined && !(isInt(params.battles) && params.battles > 0))
            err(where, 'wounded.battles must be a positive whole number');
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
        const best = stats.length === 1 && stats[0] === 'best';
        if (stats.length === 0 || (!best && stats.some((s) => !XP_STAT_NAMES.includes(s))))
          err(
            where,
            `stat must be one or more of ${XP_STAT_NAMES.join(', ')}, or "best" (the unit's highest of ${BEST_STAT_CHOICES.join(' ')}) on its own`,
          );
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
        if (effect.elite !== undefined && typeof effect.elite !== 'boolean')
          err(where, 'battle.elite must be true or false');
        if (effect.recruit !== undefined) {
          const recruit = effect.recruit;
          if (!isObject(recruit))
            err(where, 'battle.recruit must be an object { class | classPool }');
          else {
            for (const key of Object.keys(recruit))
              if (!['class', 'classPool', 'name'].includes(key))
                err(where, `unknown battle.recruit key "${key}"`);
            const forms = ['class', 'classPool'].filter((k) => recruit[k] !== undefined);
            const names = recruit.class !== undefined ? [recruit.class] : recruit.classPool;
            if (
              forms.length !== 1 ||
              !Array.isArray(names) ||
              names.length === 0 ||
              names.some((n) => typeof n !== 'string')
            )
              err(where, 'battle.recruit needs exactly one of class, classPool (names)');
            else
              for (const name of names) {
                const reason = joinClassBlock(data, name, joinActs(event, choice));
                if (reason) err(where, `battle.recruit: ${reason}`);
              }
            if (
              recruit.name !== undefined &&
              (typeof recruit.name !== 'string' || !recruit.name.trim() || recruit.name.length > 20)
            )
              err(where, 'battle.recruit.name must be 1-20 characters');
          }
        }
        if (typeof effect.victoryText !== 'string' || !effect.victoryText)
          err(where, 'battle needs a victoryText');
        else if (effect.victoryText.length > EVENT_TEXT_LIMITS.outcome)
          err(where, `victoryText is over ${EVENT_TEXT_LIMITS.outcome} characters`);
        break;
      case 'counter':
        if (phase === 'k') err(where, 'a contract cannot change an event counter');
        if (!Object.hasOwn(event.counters || {}, effect.key))
          err(where, `counter names a counter the event does not declare ("${effect.key}")`);
        if (!isInt(effect.delta) || effect.delta === 0)
          err(where, 'counter.delta must be a non-zero whole number');
        break;
      case 'join': {
        const forms = ['class', 'classPool'].filter((k) => effect[k] !== undefined);
        if (forms.length !== 1) {
          err(where, 'join needs exactly one of class, classPool');
        } else {
          const names = effect.class !== undefined ? [effect.class] : effect.classPool;
          if (
            !Array.isArray(names) ||
            names.length === 0 ||
            names.some((n) => typeof n !== 'string')
          )
            err(where, 'join.classPool must be a non-empty list of class names');
          else {
            const acts = joinActs(event, choice);
            for (const name of names) {
              const reason = joinClassBlock(data, name, acts);
              if (reason) err(where, `join: ${reason}`);
            }
          }
        }
        if (
          effect.name !== undefined &&
          (typeof effect.name !== 'string' || !effect.name.trim() || effect.name.length > 20)
        )
          err(where, 'join.name must be 1-20 characters');
        if (
          effect.levelOffset !== undefined &&
          !(isInt(effect.levelOffset) && Math.abs(effect.levelOffset) <= 5)
        )
          err(where, 'join.levelOffset must be a whole number from -5 to 5');
        if (effect.trait !== undefined && !traitIds.has(effect.trait))
          err(where, `unknown trait "${effect.trait}"`);
        break;
      }
      case 'contract': {
        if (phase !== 'c' && phase !== 'o')
          err(where, 'a contract can only be opened by a choice or an outcome, never by spoils');
        if (!CONTRACT_GOALS.includes(effect.goal))
          err(where, `contract.goal must be one of ${CONTRACT_GOALS.join(', ')}`);
        for (const list of ['reward', 'penalty']) {
          const effects = effect[list];
          if (effects === undefined) continue;
          if (!Array.isArray(effects)) {
            err(where, `contract.${list} must be a list`);
            continue;
          }
          for (const [i, inner] of effects.entries()) {
            const at = `${where}.${list}[${i}]`;
            if (!isObject(inner) || !CONTRACT_EFFECT_TYPES.includes(inner.type))
              err(at, `a contract's ${list} may only hold ${CONTRACT_EFFECT_TYPES.join(', ')}`);
            else checkEffect(at, inner, { event, choice: {}, phase: 'k' });
          }
        }
        break;
      }
      case 'forge':
      case 'wear':
      case 'mend': {
        needsTarget();
        if (phase === 'k') err(where, `a contract cannot ${effect.type}: it needs a chosen unit`);
        if (effect.type === 'forge') {
          if (
            effect.stat !== undefined &&
            !['might', 'crit', 'hit', 'weight', 'random'].includes(effect.stat)
          )
            err(where, 'forge.stat must be might, crit, hit, weight or random');
          if (choice.target && choice.target.filter?.forgeableWeapon !== true)
            err(where, 'a forge needs the choice target filter `forgeableWeapon`');
        }
        if (effect.type === 'mend' && choice.target && choice.target.filter?.wornWeapon !== true)
          err(where, 'a mend needs the choice target filter `wornWeapon`');
        break;
      }
      case 'routeEdit':
        if (phase !== 'o')
          err(
            where,
            'routeEdit belongs in an outcome (its `fallback` covers a road with nothing to change)',
          );
        if (effect.op === 'redraw') {
          if (!REDRAW_TYPES.includes(effect.toType))
            err(where, `routeEdit.toType must be one of ${REDRAW_TYPES.join(', ')}`);
        } else if (effect.op !== 'addRoad') err(where, 'routeEdit.op must be addRoad or redraw');
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
    checkRequires(ew, event.requires, event, true);
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

    checkCounters(ew, event);
    // One face of the event: its first page's choices and its pages. The Dark Omen face
    // (`dark`) is validated by the same rules as the plain one: a soft-lock there is as bad.
    const checkFace = (ew, faceChoices, facePages) => {
      const pages = [{ id: START_PAGE, where: ew, choices: faceChoices }];
      if (facePages !== undefined) {
        if (!isObject(facePages)) err(ew, '`pages` must be an object');
        else
          for (const [pageId, page] of Object.entries(facePages)) {
            const pw = `${ew}[${pageId}]`;
            if (!ID_PATTERN.test(pageId) || pageId === START_PAGE)
              err(pw, `page id must be lower_snake_case and not "${START_PAGE}"`);
            if (!isObject(page)) {
              err(pw, 'a page must be an object');
              continue;
            }
            textCheck(pw, page.text, EVENT_TEXT_LIMITS.intro, 'text');
            pages.push({ id: pageId, where: pw, choices: page.choices });
          }
      }
      const pageIds = new Set(pages.map((p) => p.id));
      // What the page graph needs: every outcome's `next`, and per page the always-available
      // choices with where each of their outcomes leads (null = the event ends).
      const edges = new Map(pages.map((p) => [p.id, new Set()]));
      const guaranteed = new Map(pages.map((p) => [p.id, []]));

      for (const page of pages) {
        const pw = page.where;
        if (!Array.isArray(page.choices) || page.choices.length === 0) {
          err(pw, 'needs at least one choice');
          continue;
        }
        const choiceIds = new Set();
        let hasFreeChoice = false;
        for (const choice of page.choices) {
          const cw = `${pw}.${isObject(choice) ? choice.id : '(no id)'}`;
          if (!isObject(choice)) {
            err(cw, 'a choice must be an object');
            continue;
          }
          if (!ID_PATTERN.test(choice.id || '')) err(cw, 'id must be lower_snake_case');
          if (choiceIds.has(choice.id)) err(cw, 'duplicate choice id');
          choiceIds.add(choice.id);
          textCheck(cw, choice.label, EVENT_TEXT_LIMITS.label, 'label');
          if (choice.hint !== undefined) textCheck(cw, choice.hint, EVENT_TEXT_LIMITS.hint, 'hint');
          checkRequires(cw, choice.requires, event);
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
                if (!DIFFICULTY_IDS.includes(rung))
                  err(cw, `unknown rung "${rung}" in check.byRung`);
            }
            const ids = outcomes.map((o) => o?.id).sort();
            if (ids.length !== 2 || ids[0] !== 'fail' || ids[1] !== 'pass')
              err(cw, 'a check needs exactly a "pass" and a "fail" outcome');
            for (const o of outcomes)
              if (o?.weight !== undefined || o?.weightByRung !== undefined)
                err(cw, "a check choice's outcomes carry no weights");
          }
          checkTells(cw, choice, outcomes);
          const nexts = [];
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
              // A weight is positive, or 0 for an outcome only a rung brings (`weightByRung` then
              // lists it: Black Sun's lying stranger is 0 on every rung below it).
              const rungOnly =
                outcome.weight === 0 &&
                Object.values(outcome.weightByRung || {}).some((w) => Number(w) > 0);
              if (!(Number.isFinite(outcome.weight) && (outcome.weight > 0 || rungOnly)))
                err(ow, 'weight must be a positive number');
              for (const [rung, w] of Object.entries(outcome.weightByRung || {})) {
                if (!DIFFICULTY_IDS.includes(rung))
                  err(ow, `unknown rung "${rung}" in weightByRung`);
                if (!(Number.isFinite(w) && w > 0)) err(ow, 'weightByRung values must be positive');
              }
            }
            if (!Array.isArray(outcome.effects))
              err(ow, '`effects` must be a list (empty for none)');
            for (const { where, phase, effects } of effectLists(outcome))
              for (const [i, effect] of effects.entries())
                checkEffect(`${ow}.${where}[${i}]`, effect, { event, choice, phase });
            const teaching = (outcome.effects || []).some((e) => e?.type === 'learnSkill');
            // A wear step can find nothing to wear (a forged blade does not wear): it needs a fallback too.
            const wearing = (outcome.effects || []).some((e) => e?.type === 'wear');
            const routing = (outcome.effects || []).filter((e) => e?.type === 'routeEdit').length;
            const work = (list) =>
              (list || []).filter((e) => ['forge', 'wear', 'mend'].includes(e?.type)).length;
            if (work(outcome.effects) > 1)
              err(ow, 'at most one forge, wear or mend per outcome (they work on one weapon)');
            if (teaching && !Array.isArray(outcome.fallback))
              err(ow, 'an outcome that teaches a skill needs a `fallback` (the pool can be empty)');
            if (wearing && !Array.isArray(outcome.fallback))
              err(
                ow,
                'an outcome that wears a weapon needs a `fallback` (a forged blade does not wear)',
              );
            if (routing > 0 && !Array.isArray(outcome.fallback))
              err(
                ow,
                'an outcome that edits the route needs a `fallback` (the road may have nothing to change)',
              );
            if (routing > 1) err(ow, 'at most one routeEdit per outcome');
            if (
              outcome.fallback !== undefined &&
              !teaching &&
              !wearing &&
              routing === 0 &&
              !(outcome.effects || []).some((e) => e?.type === 'fallenSkill')
            )
              err(
                ow,
                '`fallback` is only for outcomes that teach a skill, wear a weapon or edit the route',
              );
            for (const effect of outcome.fallback || [])
              if (
                ['learnSkill', 'fallenSkill', 'routeEdit', 'forge', 'wear', 'mend'].includes(
                  effect?.type,
                )
              )
                err(
                  ow,
                  `a fallback cannot hold a ${effect.type} (it has nothing further to fall back to)`,
                );
            const battles = (outcome.effects || []).filter((e) => e?.type === 'battle').length;
            if (battles > 1) err(ow, 'at most one battle per outcome');
            // Pages: where this outcome leads.
            let next = null;
            if (outcome.next !== undefined) {
              if (
                typeof outcome.next !== 'string' ||
                !pageIds.has(outcome.next) ||
                outcome.next === START_PAGE
              )
                err(ow, `next must name a page of this event (not "${START_PAGE}")`);
              else if (
                [...(outcome.effects || []), ...(outcome.fallback || [])].some(
                  (e) => e?.type === 'battle',
                )
              )
                err(ow, 'an outcome that starts a battle cannot also lead on to another page');
              else {
                next = outcome.next;
                edges.get(page.id).add(next);
              }
            }
            nexts.push(next);
          }
          // Weights of a normal choice must leave something to roll, on every rung.
          if (choice.check === undefined && outcomes.length > 0)
            for (const rung of DIFFICULTY_IDS) {
              const total = outcomes.reduce((sum, o) => {
                const w = Number(byRungValue(o?.weightByRung, rung, o?.weight));
                return sum + (Number.isFinite(w) && w > 0 ? w : 0);
              }, 0);
              if (!(total > 0)) {
                err(cw, `no outcome has a positive weight on ${rung}`);
                break;
              }
            }

          // A contract is "the next battle": this event's own fight is not what it means.
          if (
            choiceMayOpenContract(choice) &&
            outcomes.some((o) =>
              [...(o?.effects || []), ...(o?.fallback || [])].some((e) => e?.type === 'battle'),
            )
          )
            err(cw, 'a choice that opens a contract cannot also start a battle');

          // Always-available: nothing required, nothing to pay or pick, nothing to carry, and
          // no contract to open (one may already be open).
          const unconditional =
            !choice.requires &&
            !choice.cost &&
            !choice.target &&
            !choiceMayGrantItem(choice) &&
            !choiceMayOpenContract(choice) &&
            !(choice.effects || []).some((e) => e?.type === 'consume') &&
            !outcomes.some((o) =>
              (o?.effects || []).some((e) =>
                ['blessing', 'earnedBlessing', 'consume'].includes(e?.type),
              ),
            );
          if (unconditional) {
            hasFreeChoice = true;
            guaranteed.get(page.id).push(nexts);
          }
        }
        if (!hasFreeChoice)
          err(
            pw,
            'no choice is always available (no requirement, cost, target, item, blessing or contract): the road would soft-lock',
          );
      }

      // Every page is reachable, and every page has a guaranteed way out: an always-available
      // choice whose every outcome ends the event or leads on to a page that has one.
      const reached = new Set([START_PAGE]);
      for (const queue = [START_PAGE]; queue.length; )
        for (const next of edges.get(queue.shift()) || [])
          if (!reached.has(next)) {
            reached.add(next);
            queue.push(next);
          }
      for (const page of pages)
        if (!reached.has(page.id)) err(page.where, 'no outcome leads to this page');
      const exits = new Set();
      for (let changed = true; changed; ) {
        changed = false;
        for (const page of pages)
          if (
            !exits.has(page.id) &&
            guaranteed.get(page.id).some((nexts) => nexts.every((n) => n === null || exits.has(n)))
          ) {
            exits.add(page.id);
            changed = true;
          }
      }
      for (const page of pages)
        if (guaranteed.get(page.id).length > 0 && !exits.has(page.id))
          err(
            page.where,
            'no guaranteed way out: needs an always-available choice whose every outcome ends the event or leads to a page that has one',
          );
    };
    checkFace(ew, event.choices, event.pages);
    if (event.dark !== undefined) {
      const dw = `${ew}.dark`;
      if (!isObject(event.dark)) err(dw, '`dark` must be an object { intro, choices }');
      else {
        for (const key of Object.keys(event.dark))
          if (!['intro', 'choices', 'pages'].includes(key)) err(dw, `unknown key "${key}"`);
        textCheck(dw, event.dark.intro, EVENT_TEXT_LIMITS.intro, 'intro');
        checkFace(dw, event.dark.choices, event.dark.pages);
      }
    }
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
