// EpicWeapons.js - the rules of the Epic tier and the relics that use the same grammar
// (docs/specs/epic-weapons.md). Pure: no Phaser, no Math.random.
//
// A weapon's `special` is the sentence its card shows; the engine reads only its `rules`, a
// list of `{ kind, ... }` records validated by `validateWeaponRules` (npm run validate:data).
// Each kind is read in exactly one place:
//   mods         SkillSystem.getSkillCombatMods (beside Hermit's Bow's bonus), via epicCombatMods
//   mirrorMight  the same, via epicCombatMods: Might = the foe's weapon Might, at least `min`
//   afterCombat  WeaponArtPostCombat.getPostCombatPipelineSteps, via epicAfterCombatSteps
//   killGold     LootSystem.calculateKillReward, via epicKillGold
//   effective    Combat.getEffectivenessMultiplier, via epicEffectiveness
// Boss trophies (`trophyOf`) join the loot draw through `unlockedTrophyNames`.

import { combatDistance } from './EntitySystem.js';
import { isHoldingGround } from './TurnAnchor.js';

/** The tier word. Every tier list that picks gear by tier leaves it out on purpose. */
export const EPIC_TIER = 'Epic';

/** Combat-mod keys a `mods` rule may set (numbers), and the one flag it may raise. */
const NUMERIC_MOD_KEYS = Object.freeze([
  'atkBonus',
  'defBonus',
  'resBonus',
  'hitBonus',
  'avoidBonus',
  'critBonus',
  'spdBonus',
]);
const FLAG_MOD_KEYS = Object.freeze(['vantage']);

/** Conditions a `mods` rule's `when` may list (every one must hold). */
export const EPIC_CONDITIONS = Object.freeze([
  'initiating',
  'defending',
  'foeFullHp',
  'fullHp',
  'below50',
  'holdingGround',
  'moved',
  'onForest',
  'foeWields',
]);

/** What a `mods` rule may scale by (`per`), each capped by `cap`. */
export const EPIC_SCALERS = Object.freeze(['adjacentAlly']);

/** The after-combat effects, and which of them need the wielder's strike to have landed. */
export const EPIC_AFTER_COMBAT_EFFECTS = Object.freeze([
  'push',
  'pull',
  'status',
  'selfDamage',
  'selfHeal',
]);
const AFTER_COMBAT_STATUSES = Object.freeze(['silence', 'root']);
const ONLY_WHEN = Object.freeze(['initiating', 'always']);

export const EPIC_RULE_KINDS = Object.freeze([
  'mods',
  'mirrorMight',
  'afterCombat',
  'killGold',
  'effective',
]);

/** The weapon's rules, as data (an empty list for every weapon without any). */
export function weaponRules(weapon) {
  const rules = weapon?.rules;
  return Array.isArray(rules) ? rules.filter((rule) => rule && typeof rule === 'object') : [];
}

export function rulesOfKind(weapon, kind) {
  return weaponRules(weapon).filter((rule) => rule.kind === kind);
}

/** True for an Epic-tier weapon. */
export function isEpicWeapon(weapon) {
  return weapon?.tier === EPIC_TIER;
}

function living(unit) {
  return Boolean(unit) && Number(unit.currentHP) > 0;
}

function onMap(unit) {
  const { col, row } = unit || {};
  return col != null && row != null && Number.isFinite(Number(col)) && Number.isFinite(Number(row));
}

function fullHp(unit) {
  const max = Number(unit?.stats?.HP) || 0;
  return max > 0 && Number(unit.currentHP) >= max;
}

function below50(unit) {
  const max = Number(unit?.stats?.HP) || 0;
  return max > 0 && Number(unit.currentHP) <= Math.floor(max / 2);
}

function hasMovedThisTurn(unit) {
  return unit?.hasMoved === true || (Number(unit?._movementSpent) || 0) > 0;
}

function adjacentAllyCount(unit, allies) {
  if (!onMap(unit)) return 0;
  let count = 0;
  for (const ally of Array.isArray(allies) ? allies : []) {
    if (ally === unit || !living(ally) || !onMap(ally)) continue;
    if (combatDistance(unit, ally) === 1) count += 1;
  }
  return count;
}

function conditionHolds(condition, rule, unit, opponent, ctx) {
  switch (condition) {
    case 'initiating':
      return ctx.isInitiating === true;
    case 'defending':
      return ctx.isInitiating !== true;
    case 'foeFullHp':
      return fullHp(opponent);
    case 'fullHp':
      return fullHp(unit);
    case 'below50':
      return below50(unit);
    case 'holdingGround':
      return isHoldingGround(unit, ctx.turn);
    case 'moved':
      return hasMovedThisTurn(unit);
    case 'onForest':
      return ctx.terrain?.name === 'Forest';
    case 'foeWields': {
      const types = Array.isArray(rule.weaponTypes) ? rule.weaponTypes : [];
      return Boolean(opponent?.weapon?.type) && types.includes(opponent.weapon.type);
    }
    default:
      return false;
  }
}

function conditionsOf(rule) {
  if (rule.when === undefined) return [];
  return Array.isArray(rule.when) ? rule.when : [rule.when];
}

function scaleOf(rule, unit, ctx) {
  if (!rule.per) return 1;
  const cap = Math.max(0, Math.trunc(Number(rule.cap) || 0));
  if (rule.per === 'adjacentAlly') return Math.min(cap, adjacentAllyCount(unit, ctx.allies));
  return 0;
}

/**
 * The combat mods `unit`'s weapon grants in a combat against `opponent`: every `mods` rule whose
 * conditions hold (scaled by its `per`), and a `mirrorMight` rule's Might. `ctx` is
 * `{ isInitiating, allies, terrain, turn }` as getSkillCombatMods knows them; a missing `turn`
 * (the arena) leaves `holdingGround` false. Returns `{ mods, activated }` with zeros for a weapon
 * with no rules; `activated` names each `mods` rule that fired by its tag, for the forecast's
 * list (Mirrorglass's Might and a rule with no condition are always on and name nothing).
 */
export function epicCombatMods(weapon, unit, opponent, ctx = {}) {
  const mods = {};
  for (const key of NUMERIC_MOD_KEYS) mods[key] = 0;
  const activated = [];
  if (!weapon || !unit) return { mods, activated };
  for (const rule of weaponRules(weapon)) {
    if (rule.kind === 'mods') {
      if (!conditionsOf(rule).every((c) => conditionHolds(c, rule, unit, opponent, ctx))) continue;
      const scale = scaleOf(rule, unit, ctx);
      if (scale <= 0) continue;
      for (const [key, value] of Object.entries(rule.mods || {})) {
        if (NUMERIC_MOD_KEYS.includes(key)) mods[key] += Math.trunc(Number(value) || 0) * scale;
        else if (FLAG_MOD_KEYS.includes(key) && value === true) mods[key] = true;
      }
      // A rule that always holds (Cinderstring's -10 Avoid) is the weapon's stat, not news.
      if (conditionsOf(rule).length > 0 || rule.per)
        activated.push({ id: 'epic_weapon', name: rule.tag || weapon.name });
      continue;
    }
    if (rule.kind === 'mirrorMight') mods.atkBonus += mirrorMightOf(rule, opponent);
  }
  return { mods, activated };
}

/**
 * Mirrorglass's Might: the foe's weapon Might (its catalog Might plus its forge), at least the
 * rule's `min`. A staff, no weapon or no foe gives the minimum.
 */
export function mirrorMightOf(rule, opponent) {
  const min = Math.max(0, Math.trunc(Number(rule?.min) || 0));
  const foeWeapon = opponent?.weapon;
  if (!foeWeapon || foeWeapon.type === 'Staff') return min;
  return Math.max(min, Math.trunc(Number(foeWeapon.might) || 0));
}

/**
 * The post-combat pipeline steps one side's weapon adds (WeaponArtPostCombat): `side` is
 * 'attacker' or 'defender', `landed` whether that side's strikes hit. Push and pull need the
 * side to have started the combat; a step's target is the other side unless it is a self effect.
 */
export function epicAfterCombatSteps(weapon, side, { landed = false } = {}) {
  const steps = [];
  const other = side === 'attacker' ? 'defender' : 'attacker';
  for (const rule of rulesOfKind(weapon, 'afterCombat')) {
    const onlyWhen =
      rule.onlyWhen || (rule.effect === 'push' || rule.effect === 'pull' ? 'initiating' : 'always');
    if (onlyWhen === 'initiating' && side !== 'attacker') continue;
    const amount = Math.max(0, Math.trunc(Number(rule.amount) || 0));
    switch (rule.effect) {
      case 'push':
      case 'pull':
        if (!landed) break;
        steps.push({
          type: 'tier2_move',
          sourceSide: side,
          targetSide: other,
          mode: rule.effect,
          distance: Math.max(1, Math.trunc(Number(rule.distance) || 1)),
          epicWeapon: weapon.name,
        });
        break;
      case 'status':
        if (!landed) break;
        steps.push({
          type: 'tier2_status',
          sourceSide: side,
          targetSide: other,
          status: rule.status,
          durationPhases: Math.max(1, Math.trunc(Number(rule.phases) || 1)),
        });
        break;
      case 'selfHeal':
        if (!landed || amount <= 0) break;
        steps.push({ type: 'epic_self_heal', sourceSide: side, targetSide: side, amount });
        break;
      case 'selfDamage':
        if (amount <= 0) break;
        steps.push({
          type: 'tier2_damage',
          sourceSide: side,
          targetSide: side,
          amount,
          nonLethal: true,
        });
        break;
      default:
        break;
    }
  }
  return steps;
}

/** The extra gold a kill with this weapon pays (Tollkeeper's Knife), 0 for any other. */
export function epicKillGold(weapon) {
  let gold = 0;
  for (const rule of rulesOfKind(weapon, 'killGold')) {
    gold += Math.max(0, Math.trunc(Number(rule.gold) || 0));
  }
  return gold;
}

/** The weapon's class-based effectiveness against `defender` (Daybreak), 1 when none applies. */
export function epicEffectiveness(weapon, defender) {
  const className = typeof defender?.className === 'string' ? defender.className : '';
  if (!className) return 1;
  let best = 1;
  for (const rule of rulesOfKind(weapon, 'effective')) {
    const names = Array.isArray(rule.classNames) ? rule.classNames : [];
    if (!names.includes(className)) continue;
    best = Math.max(best, Math.trunc(Number(rule.multiplier) || 1));
  }
  return best;
}

// --- Boss trophies ---------------------------------------------------------------------------

const ACT_ORDER = ['act1', 'act2', 'act3', 'act4', 'finalBoss'];

/** The act a boss is fought in, from enemies.json `bosses` (null for an unknown name). */
export function bossActOf(bossName, enemiesData) {
  const bosses = enemiesData?.bosses || {};
  for (const [act, list] of Object.entries(bosses)) {
    if ((Array.isArray(list) ? list : []).some((boss) => boss?.name === bossName)) return act;
  }
  return null;
}

/**
 * The trophies the save has unlocked for a draw in `actId`: every weapon whose `trophyOf` boss
 * the save has slain (`bossSlain`: `{ [name]: count }`, MetaProgressionManager's story flags)
 * and whose boss's act is `actId` or earlier. In catalog order, so the list is stable.
 */
export function unlockedTrophyNames(weapons, bossSlain, actId, enemiesData) {
  const actIndex = ACT_ORDER.indexOf(actId);
  if (actIndex < 0 || !bossSlain || typeof bossSlain !== 'object') return [];
  const out = [];
  for (const weapon of Array.isArray(weapons) ? weapons : []) {
    const boss = weapon?.trophyOf;
    if (typeof boss !== 'string' || !(Number(bossSlain[boss]) > 0)) continue;
    const bossIndex = ACT_ORDER.indexOf(bossActOf(boss, enemiesData));
    if (bossIndex < 0 || bossIndex > actIndex) continue;
    out.push(weapon.name);
  }
  return out;
}

// --- Card words ------------------------------------------------------------------------------

/** The longest chip a rule's `tag` may name (a card's chip row is narrow). */
export const EPIC_TAG_MAX = 18;

/**
 * The keyword chips a weapon's rules add on its card (ItemKeywords), in rule order: a `mods`
 * rule's own `tag`, an `effective` rule's "x3 vs <label>", and a fixed word for the rest. Each is
 * `{ id, text, title }`; `title` is the weapon's `special` sentence, the whole rule.
 */
export function epicKeywordTags(weapon) {
  const title = typeof weapon?.special === 'string' ? weapon.special : '';
  const tags = [];
  const seen = new Set();
  const add = (id, text) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    tags.push({ id, text, title });
  };
  for (const rule of weaponRules(weapon)) {
    if (rule.kind === 'mods') add('epic', rule.tag);
    else if (rule.kind === 'effective') add('effective', `x${rule.multiplier} vs ${rule.label}`);
    else if (rule.kind === 'mirrorMight') add('epic', "Foe's Might");
    else if (rule.kind === 'killGold') add('epic', `+${rule.gold} gold a kill`);
    else if (rule.kind === 'afterCombat') add('epic', AFTER_COMBAT_TAG[rule.effect]?.(rule));
  }
  return tags;
}

const AFTER_COMBAT_TAG = {
  push: () => 'Pushes',
  pull: () => 'Pulls',
  status: (rule) => (rule.status === 'silence' ? 'Silences' : 'Roots'),
  selfDamage: (rule) => `-${rule.amount} HP a combat`,
  selfHeal: (rule) => `Heals ${rule.amount} on hit`,
};

// --- Validation ------------------------------------------------------------------------------

/** Every problem with one weapon's `rules`, as sentences (none for a well-formed list). */
export function validateWeaponRules(weapon) {
  const errors = [];
  const name = weapon?.name || '(unnamed)';
  if (weapon?.rules === undefined) return errors;
  if (!Array.isArray(weapon.rules)) return [`${name}: rules must be a list`];
  weapon.rules.forEach((rule, index) => {
    const at = `${name} rules[${index}]`;
    if (!rule || typeof rule !== 'object') {
      errors.push(`${at}: not an object`);
      return;
    }
    if (!EPIC_RULE_KINDS.includes(rule.kind)) {
      errors.push(`${at}: unknown kind "${rule.kind}"`);
      return;
    }
    const allowed = {
      mods: ['kind', 'mods', 'when', 'per', 'cap', 'weaponTypes', 'tag'],
      mirrorMight: ['kind', 'min'],
      afterCombat: ['kind', 'effect', 'distance', 'status', 'phases', 'amount', 'onlyWhen'],
      killGold: ['kind', 'gold'],
      effective: ['kind', 'classNames', 'multiplier', 'label'],
    }[rule.kind];
    for (const key of Object.keys(rule)) {
      if (!allowed.includes(key)) errors.push(`${at}: unknown key "${key}"`);
    }
    if (rule.kind === 'mods') {
      if (typeof rule.tag !== 'string' || !rule.tag.trim() || rule.tag.length > EPIC_TAG_MAX)
        errors.push(`${at}: a mods rule needs a tag of 1-${EPIC_TAG_MAX} characters`);
      const mods = rule.mods;
      if (!mods || typeof mods !== 'object' || Object.keys(mods).length === 0) {
        errors.push(`${at}: mods must name at least one combat mod`);
      } else {
        for (const [key, value] of Object.entries(mods)) {
          if (NUMERIC_MOD_KEYS.includes(key)) {
            if (!Number.isInteger(value) || value === 0)
              errors.push(`${at}: ${key} must be a non-zero integer`);
          } else if (FLAG_MOD_KEYS.includes(key)) {
            if (value !== true) errors.push(`${at}: ${key} must be true`);
          } else errors.push(`${at}: unknown combat mod "${key}"`);
        }
      }
      for (const condition of conditionsOf(rule)) {
        if (!EPIC_CONDITIONS.includes(condition))
          errors.push(`${at}: unknown condition "${condition}"`);
      }
      const usesFoeWields = conditionsOf(rule).includes('foeWields');
      if (usesFoeWields !== (rule.weaponTypes !== undefined))
        errors.push(`${at}: weaponTypes goes with the foeWields condition, and only with it`);
      if (usesFoeWields && (!Array.isArray(rule.weaponTypes) || rule.weaponTypes.length === 0))
        errors.push(`${at}: weaponTypes must be a non-empty list`);
      if (rule.per !== undefined) {
        if (!EPIC_SCALERS.includes(rule.per)) errors.push(`${at}: unknown per "${rule.per}"`);
        if (!Number.isInteger(rule.cap) || rule.cap < 1)
          errors.push(`${at}: per needs a cap of 1 or more`);
      } else if (rule.cap !== undefined) errors.push(`${at}: cap needs a per`);
    }
    if (rule.kind === 'mirrorMight' && (!Number.isInteger(rule.min) || rule.min < 0))
      errors.push(`${at}: min must be a whole number`);
    if (rule.kind === 'afterCombat') {
      if (!EPIC_AFTER_COMBAT_EFFECTS.includes(rule.effect))
        errors.push(`${at}: unknown effect "${rule.effect}"`);
      if (rule.onlyWhen !== undefined && !ONLY_WHEN.includes(rule.onlyWhen))
        errors.push(`${at}: unknown onlyWhen "${rule.onlyWhen}"`);
      if ((rule.effect === 'push' || rule.effect === 'pull') && rule.onlyWhen === 'always')
        errors.push(`${at}: a push or pull happens only after a combat the wielder starts`);
      if (rule.effect === 'status' && !AFTER_COMBAT_STATUSES.includes(rule.status))
        errors.push(`${at}: status must be one of ${AFTER_COMBAT_STATUSES.join(', ')}`);
      if ((rule.effect === 'selfDamage' || rule.effect === 'selfHeal') && !(rule.amount > 0))
        errors.push(`${at}: ${rule.effect} needs an amount above 0`);
    }
    if (rule.kind === 'killGold' && !(Number.isInteger(rule.gold) && rule.gold > 0))
      errors.push(`${at}: gold must be a whole number above 0`);
    if (rule.kind === 'effective') {
      if (!Array.isArray(rule.classNames) || rule.classNames.length === 0)
        errors.push(`${at}: classNames must be a non-empty list`);
      if (!Number.isInteger(rule.multiplier) || rule.multiplier < 2)
        errors.push(`${at}: multiplier must be 2 or more`);
      if (typeof rule.label !== 'string' || !rule.label.trim())
        errors.push(`${at}: an effective rule needs a label (the chip's "vs ..." words)`);
    }
  });
  return errors;
}
