// RunStartBlessingEffects.js - the handlers of the run-start blessing effects (docs/blessings_contract.md
// §6; the shrine's boons and prices, a church vow's, an event's, a start gift's catch and a twist's
// price all go through them). One handler per effect type, in a frozen table that
// RunManager._applySingleRunStartBlessingEffect looks the type up in, as it does the earned, twisted
// and shrine boon modules (EarnedBoons.js, TwistedBoons.js, ShrineBoons.js).
//
// A handler is `(run, blessingId, effect, value) => void`: `run` is the RunManager, `effect` the
// `{ type, params }` record and `value` the dispatcher's reading of `params.value` (a finite
// number, 0 when absent). It changes the run, records its history event with
// `run._recordBlessingEvent('run_start', ...)` (the stage the dispatcher's caller set, 'mid_run' or
// 'gift', replaces 'run_start' there) and returns nothing; a malformed set is recorded as skipped
// (`invalid_<type>_params`), never thrown. The dispatcher answers the earned and twisted boons
// first, drops a non-finite `value`, looks the type up here and then falls through to the shrine
// boons (ShrineBoons.js), the earned modifiers and, last, `unhandled_effect_type`. No type in this
// table is answered by those modules (tests/RunStartBlessingEffects.test.js), so the order
// between them does not matter.
//
// The handlers keep the private RunManager helpers they use on the run (`run._applyStatDeltaToUnits`,
// `run._pickDeterministicBlessingItem`, ...). Pure but for that: no Phaser, no DOM, no `Math.random`.

import { ACT_SEQUENCE, RECRUIT_SKILL_POOL, XP_STAT_NAMES } from '../utils/constants.js';
import { applyForge, canForge, canForgeStat, deforgeWeapon } from './ForgeSystem.js';
import {
  parseAdjacentAllyDefBonus,
  parseIsolatedCombatBonus,
  sanitizeAdjacentAllyDefBonuses,
  sanitizeIsolatedCombatBonuses,
} from './FormationBlessings.js';
import { parseBattleGoldGamble } from './BattleGoldGamble.js';
import { startLordStatArc } from './LordStatArc.js';
import { slotsFullFor } from './SkillSlots.js';
import { addToConsumables, addToInventory, canEquip, equipWeapon } from './UnitManager.js';
import { parsePlayerWeaponArtBoon } from './WeaponArtSystem.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The id an `activeBlessings` entry names: a string, or an object's `id`, trimmed; else null. */
export function getBlessingEntryId(entry) {
  if (typeof entry === 'string') {
    const id = entry.trim();
    return id.length > 0 ? id : null;
  }
  if (!isPlainObject(entry) || typeof entry.id !== 'string') return null;
  const id = entry.id.trim();
  return id.length > 0 ? id : null;
}

/** `run_start_max_hp_bonus`. */
function applyRunStartMaxHpBonus(run, blessingId, effect, value) {
  if (value === 0) return;
  const scope = effect.params.scope || 'all';
  const targetUnits = run._resolveBlessingUnitScope(scope);
  run._applyStatDeltaToUnits(targetUnits, 'HP', value);
  run._recordBlessingEvent('run_start', blessingId, effect, { appliedValue: value, scope });
  return;
}

/** `gold_delta`. */
function applyGoldDelta(run, blessingId, effect, value) {
  if (value !== 0) run.addGold(value);
  run._recordBlessingEvent('run_start', blessingId, effect, { appliedValue: value });
  return;
}

/** `battle_gold_multiplier_delta`. */
function applyBattleGoldMultiplierDelta(run, blessingId, effect, value) {
  run.blessingRuntimeModifiers.battleGoldMultiplierDelta += value;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: value,
    total: run.blessingRuntimeModifiers.battleGoldMultiplierDelta,
  });
  return;
}

/** `deploy_cap_delta`. */
function applyDeployCapDelta(run, blessingId, effect, value) {
  run.blessingRuntimeModifiers.deployCapDelta += Math.trunc(value);
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: Math.trunc(value),
    total: run.blessingRuntimeModifiers.deployCapDelta,
  });
  return;
}

/** `starting_weapon_tier`. */
function applyStartingWeaponTier(run, blessingId, effect) {
  const requestedTier = String(effect.params.tier || '').trim();
  const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
  if (!requestedTier || count <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_starting_weapon_tier_params',
    });
    return;
  }

  let granted = 0;
  const grantedWeapons = [];
  const allWeapons = Array.isArray(run.gameData?.weapons) ? run.gameData.weapons : [];
  for (const unit of run.roster) {
    if (granted >= count) break;
    const profTypes = new Set((unit.proficiencies || []).map((p) => p.type));
    const candidate = allWeapons.find(
      (w) =>
        w?.tier === requestedTier &&
        profTypes.has(w.type) &&
        w.type !== 'Staff' &&
        w.type !== 'Consumable' &&
        w.type !== 'Scroll' &&
        canEquip(unit, w),
    );
    if (!candidate) continue;
    if (!addToInventory(unit, candidate)) continue;
    const addedWeapon = unit.inventory[unit.inventory.length - 1];
    if (addedWeapon && canEquip(unit, addedWeapon)) equipWeapon(unit, addedWeapon);
    granted++;
    grantedWeapons.push({ unit: unit.name, weapon: addedWeapon?.name || candidate.name });
  }

  run._recordBlessingEvent('run_start', blessingId, effect, {
    requestedTier,
    requestedCount: count,
    grantedCount: granted,
    grantedWeapons,
  });
  return;
}

/** `act_stat_delta_all_units`. */
function applyActStatDeltaAllUnits(run, blessingId, effect, value) {
  const targetAct = String(effect.params.act || '').trim();
  const stat = String(effect.params.stat || '').trim();
  if (!targetAct || !stat || value === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_act_stat_delta_all_units_params',
    });
    return;
  }

  if (!Array.isArray(run.blessingRuntimeModifiers.actStatDeltaAllUnits)) {
    run.blessingRuntimeModifiers.actStatDeltaAllUnits = [];
  }
  // unitUids: who holds the delta, so the act's end takes it back from them only
  // (a recruit who joined later gets it on joining: grantRecruitBlessingConsumables).
  const tracker = {
    blessingId,
    act: targetAct,
    stat,
    value,
    applied: false,
    reverted: false,
    unitUids: [],
  };
  if (targetAct === run.currentAct) {
    run._applyStatDeltaToUnits(run.roster, stat, value);
    tracker.unitUids = run.roster.map((unit) => run.assignUnitUid(unit));
    tracker.applied = true;
  }
  run.blessingRuntimeModifiers.actStatDeltaAllUnits.push(tracker);
  run._recordBlessingEvent('run_start', blessingId, effect, {
    act: targetAct,
    stat,
    appliedValue: value,
    appliedNow: tracker.applied,
  });
  return;
}

/** `act_hit_bonus`. */
function applyActHitBonus(run, blessingId, effect, value) {
  const targetAct = String(effect.params.act || '').trim();
  const delta = Math.trunc(value);
  if (!targetAct || delta === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_act_hit_bonus_params',
    });
    return;
  }
  if (
    !run.blessingRuntimeModifiers.actHitBonusByAct ||
    typeof run.blessingRuntimeModifiers.actHitBonusByAct !== 'object'
  ) {
    run.blessingRuntimeModifiers.actHitBonusByAct = {};
  }
  run.blessingRuntimeModifiers.actHitBonusByAct[targetAct] =
    Math.trunc(run.blessingRuntimeModifiers.actHitBonusByAct[targetAct] || 0) + delta;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    act: targetAct,
    appliedValue: delta,
    total: run.blessingRuntimeModifiers.actHitBonusByAct[targetAct],
  });
  return;
}

/** `all_act_hit_bonus`. */
function applyAllActHitBonus(run, blessingId, effect, value) {
  const delta = Math.trunc(value);
  if (delta === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'zero_all_act_hit_bonus',
    });
    return;
  }
  if (
    !run.blessingRuntimeModifiers.actHitBonusByAct ||
    typeof run.blessingRuntimeModifiers.actHitBonusByAct !== 'object'
  ) {
    run.blessingRuntimeModifiers.actHitBonusByAct = {};
  }
  const acts = ACT_SEQUENCE;
  for (const act of acts) {
    run.blessingRuntimeModifiers.actHitBonusByAct[act] =
      Math.trunc(run.blessingRuntimeModifiers.actHitBonusByAct[act] || 0) + delta;
  }
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: delta,
    acts,
    totals: { ...run.blessingRuntimeModifiers.actHitBonusByAct },
  });
  return;
}

/** `lord_stat_bonus`. */
function applyLordStatBonus(run, blessingId, effect, value) {
  const stat = String(effect.params.stat || '').trim();
  if (!stat || value === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_lord_stat_bonus_params',
    });
    return;
  }
  const lords = run.roster.filter((unit) => unit.isLord);
  run._applyStatDeltaToUnits(lords, stat, value);
  run._recordBlessingEvent('run_start', blessingId, effect, {
    stat,
    appliedValue: value,
    appliedUnits: lords.map((u) => u.name),
  });
  return;
}

/** `all_units_stat_delta`. */
function applyAllUnitsStatDelta(run, blessingId, effect, value) {
  const stat = String(effect.params.stat || '').trim();
  if (!stat || value === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_all_units_stat_delta_params',
    });
    return;
  }
  run._applyStatDeltaToUnits(run.roster, stat, value);
  run._recordBlessingEvent('run_start', blessingId, effect, {
    stat,
    appliedValue: value,
    appliedUnits: run.roster.map((u) => u.name),
  });
  return;
}

/** `skip_first_shop`. */
function applySkipFirstShop(run, blessingId, effect) {
  const enabled = effect.params.enabled !== false;
  run.blessingRuntimeModifiers.skipFirstShop = Boolean(enabled);
  run._recordBlessingEvent('run_start', blessingId, effect, {
    enabled: run.blessingRuntimeModifiers.skipFirstShop,
  });
  return;
}

/** `shop_item_count_delta`. */
function applyShopItemCountDelta(run, blessingId, effect, value) {
  const delta = Math.trunc(value);
  run.blessingRuntimeModifiers.shopItemCountDelta += delta;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: delta,
    total: run.blessingRuntimeModifiers.shopItemCountDelta,
  });
  return;
}

/** `all_growths_delta`. */
function applyAllGrowthsDelta(run, blessingId, effect, value) {
  const delta = Math.trunc(value);
  if (delta === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'zero_all_growths_delta',
    });
    return;
  }
  run.blessingRuntimeModifiers.allGrowthsDelta += delta;
  if (!Array.isArray(run.blessingRuntimeModifiers.allGrowthsDeltas)) {
    run.blessingRuntimeModifiers.allGrowthsDeltas = [];
  }
  run.blessingRuntimeModifiers.allGrowthsDeltas.push(delta);
  run._applyGrowthDeltaToUnits(run.roster, delta);
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: delta,
    total: run.blessingRuntimeModifiers.allGrowthsDelta,
    appliedUnits: run.roster.map((u) => u.name),
  });
  return;
}

/** `targeted_growths_delta`. */
function applyTargetedGrowthsDelta(run, blessingId, effect, value) {
  const delta = Math.trunc(value);
  const scope =
    typeof effect.params.scope === 'string' ? effect.params.scope.trim().toLowerCase() : 'all';
  const stats = [
    ...new Set(
      (Array.isArray(effect.params.stats) ? effect.params.stats : [])
        .filter((stat) => typeof stat === 'string')
        .map((stat) => stat.trim())
        .filter((stat) => XP_STAT_NAMES.includes(stat)),
    ),
  ];
  if (delta === 0 || stats.length <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_targeted_growths_delta_params',
    });
    return;
  }
  if (!Array.isArray(run.blessingRuntimeModifiers.targetedGrowthsDeltas)) {
    run.blessingRuntimeModifiers.targetedGrowthsDeltas = [];
  }
  run.blessingRuntimeModifiers.targetedGrowthsDeltas.push({ stats, value: delta, scope });
  const units = run._resolveBlessingUnitScope(scope);
  run._applyTargetedGrowthDeltaToUnits(units, stats, delta);
  run._recordBlessingEvent('run_start', blessingId, effect, {
    stats,
    scope,
    appliedValue: delta,
    appliedUnits: units.map((unit) => unit.name),
  });
  return;
}

/** `disable_personal_skills_until_act`. */
function applyDisablePersonalSkillsUntilAct(run, blessingId, effect) {
  const targetAct = String(effect.params.act || '').trim();
  const targetIndex = run.actSequence.indexOf(targetAct);
  if (!targetAct || targetIndex === -1) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_disable_personal_skills_until_act_params',
    });
    return;
  }
  const existingAct = run.blessingRuntimeModifiers.disablePersonalSkillsUntilAct;
  if (!existingAct || run.actSequence.indexOf(existingAct) < targetIndex) {
    run.blessingRuntimeModifiers.disablePersonalSkillsUntilAct = targetAct;
  }
  const suppression = run._suppressPersonalSkillsForCurrentRosterIfNeeded();
  run._recordBlessingEvent('run_start', blessingId, effect, {
    targetAct: run.blessingRuntimeModifiers.disablePersonalSkillsUntilAct,
    appliedNow: suppression.applied,
    removedByUnit: suppression.removedByUnit,
  });
  return;
}

/** `starting_consumable_all`. */
function applyStartingConsumableAll(run, blessingId, effect) {
  const itemName = String(effect.params.name || '').trim();
  const template = run.getConsumableTemplate(itemName);
  if (!template) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'consumable_not_found',
      requestedName: itemName,
    });
    return;
  }
  let granted = 0;
  for (const unit of run.roster) {
    if (addToConsumables(unit, template)) granted++;
  }
  run._recordBlessingEvent('run_start', blessingId, effect, {
    itemName,
    grantedCount: granted,
    rosterSize: run.roster.length,
  });
  return;
}

/** `extra_consumable / extra_vulnerary`. */
function applyExtraConsumable(run, blessingId, effect, value) {
  const itemName =
    typeof effect.params.itemName === 'string' ? effect.params.itemName : 'Vulnerary';
  const configuredCount = effect.params.count ?? effect.params.value ?? value;
  const count = Math.max(0, Math.trunc(Number(configuredCount || 0)));
  if (count <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_extra_consumable_params',
    });
    return;
  }
  const found = run.getConsumableTemplate(itemName);
  const template = found?.type === 'Consumable' ? found : null;
  if (!template) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'missing_consumable_template',
      itemName,
    });
    return;
  }
  let grantedToUnits = 0;
  let grantedToConvoy = 0;
  let overflow = 0;
  const lords = run.roster.filter((unit) => unit.isLord);
  for (const unit of lords) {
    for (let i = 0; i < count; i++) {
      if (addToConsumables(unit, template)) {
        grantedToUnits++;
        continue;
      }
      if (run.addToConvoy(template)) {
        grantedToConvoy++;
      } else {
        overflow++;
      }
    }
  }
  run._recordBlessingEvent('run_start', blessingId, effect, {
    requestedCount: count,
    lordCount: lords.length,
    grantedToUnits,
    grantedToConvoy,
    overflow,
  });
  return;
}

/** `starting_random_skill`. */
function applyStartingRandomSkill(run, blessingId, effect) {
  const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
  const scope =
    typeof effect.params.scope === 'string' ? effect.params.scope.trim().toLowerCase() : 'lords';
  if (count <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_starting_random_skill_count',
    });
    return;
  }

  const validSkills = new Set(
    (run.gameData?.skills || []).map((skill) => skill?.id).filter(Boolean),
  );
  const skillPool = RECRUIT_SKILL_POOL.filter((skillId) => validSkills.has(skillId));
  if (skillPool.length <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'empty_starting_random_skill_pool',
    });
    return;
  }

  const targets = run._resolveBlessingUnitScope(scope);
  const grantedByUnit = {};
  for (const unit of targets) {
    if (!Array.isArray(unit.skills)) unit.skills = [];
    for (let i = 0; i < count; i++) {
      const candidates = skillPool.filter(
        (skillId) =>
          !unit.skills.includes(skillId) && !slotsFullFor(unit, skillId, run.gameData?.skills),
      );
      if (candidates.length <= 0) break;
      const picked = run._pickDeterministicBlessingItem(
        candidates,
        blessingId,
        `starting_random_skill:${unit.name}:${i}`,
      );
      if (!picked) break;
      unit.skills.push(picked);
      if (!grantedByUnit[unit.name]) grantedByUnit[unit.name] = [];
      grantedByUnit[unit.name].push(picked);
    }
  }
  run._recordBlessingEvent('run_start', blessingId, effect, {
    scope,
    requestedCount: count,
    grantedByUnit,
  });
  return;
}

/** `starting_whetstones`. */
function applyStartingWhetstones(run, blessingId, effect) {
  const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
  if (count <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_starting_whetstones_count',
    });
    return;
  }
  const whetstones = Array.isArray(run.gameData?.whetstones) ? run.gameData.whetstones : [];
  if (whetstones.length <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'missing_whetstone_catalog',
    });
    return;
  }

  const applied = [];
  const forgeStats = ['might', 'crit', 'hit', 'weight'];
  for (let rollIndex = 0; rollIndex < count; rollIndex++) {
    const options = [];
    for (const unit of run.roster) {
      if (!unit.isLord) continue;
      const weapons = [];
      for (const weapon of unit.inventory || []) {
        if (!weapon || ['Staff', 'Consumable', 'Scroll', 'Whetstone'].includes(weapon.type))
          continue;
        if (!weapons.includes(weapon)) weapons.push(weapon);
      }
      if (
        unit.weapon &&
        !['Staff', 'Consumable', 'Scroll', 'Whetstone'].includes(unit.weapon.type) &&
        !weapons.includes(unit.weapon)
      ) {
        weapons.push(unit.weapon);
      }

      for (const weapon of weapons) {
        if (!canForge(weapon)) continue;
        for (const whetstone of whetstones) {
          if (whetstone?.forgeStat === 'choice') {
            for (const stat of forgeStats) {
              if (canForgeStat(weapon, stat)) {
                options.push({ unit, weapon, whetstone, stat });
              }
            }
            continue;
          }
          if (canForgeStat(weapon, whetstone?.forgeStat)) {
            options.push({ unit, weapon, whetstone, stat: whetstone.forgeStat });
          }
        }
      }
    }

    if (options.length <= 0) break;
    const choice = run._pickDeterministicBlessingItem(
      options,
      blessingId,
      `starting_whetstones:${rollIndex}`,
    );
    if (!choice) break;
    const result = applyForge(choice.weapon, choice.stat);
    if (!result.success) continue;
    applied.push({
      unit: choice.unit.name,
      weapon: choice.weapon.name,
      whetstone: choice.whetstone?.name || 'Unknown Whetstone',
      stat: choice.stat,
    });
  }

  run._recordBlessingEvent('run_start', blessingId, effect, {
    requestedCount: count,
    appliedCount: applied.length,
    applied,
  });
  return;
}

/** `starting_scroll`. */
function applyStartingScroll(run, blessingId, effect) {
  const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
  if (count <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_starting_scroll_count',
    });
    return;
  }

  const hasCatalog = (run.gameData?.weapons || []).some(
    (item) => item?.type === 'Scroll' && typeof item.teachesWeaponArtId === 'string',
  );
  if (!hasCatalog) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'missing_scroll_catalog',
    });
    return;
  }
  const validScrolls = run.startingArtScrollPool(
    effect.params.maxUnlockAct,
    effect.params.minUnlockAct,
  );
  if (validScrolls.length <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'no_valid_scroll_for_roster',
    });
    return;
  }
  if (!Array.isArray(run.scrolls)) run.scrolls = [];
  const granted = [];
  // `distinct` (a start gift's Stranger's Scroll) never hands out the same art twice while
  // the pool has another; each pick reads the same keyed stream as before.
  const distinct = effect.params.distinct === true;
  let remaining = [...validScrolls];
  for (let i = 0; i < count; i++) {
    if (distinct && remaining.length <= 0) remaining = [...validScrolls];
    const picked = run._pickDeterministicBlessingItem(
      distinct ? remaining : validScrolls,
      blessingId,
      `starting_scroll:${i}`,
    );
    if (!picked) break;
    if (distinct) remaining = remaining.filter((scroll) => scroll !== picked);
    run.scrolls.push(structuredClone(picked));
    granted.push(picked.name);
  }
  run._recordBlessingEvent('run_start', blessingId, effect, {
    requestedCount: count,
    grantedCount: granted.length,
    granted,
  });
  return;
}

/** `starting_forge_lords / starting_weapon_forge_delta`. */
function applyStartingWeaponForge(run, blessingId, effect, value) {
  const forgeStat = String(effect.params.stat || 'might')
    .trim()
    .toLowerCase();
  const resolvedForgeStat = ['might', 'crit', 'hit', 'weight'].includes(forgeStat)
    ? forgeStat
    : 'might';
  const requestedDelta =
    effect.type === 'starting_forge_lords'
      ? Math.max(0, Math.trunc(Number(effect.params.count ?? 1)))
      : Math.trunc(value);
  if (!Number.isFinite(requestedDelta) || requestedDelta === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'zero_starting_weapon_forge_delta',
    });
    return;
  }
  const changedWeapons = [];
  const steps = Math.abs(requestedDelta);
  for (const unit of run.roster) {
    if (!unit.isLord) continue;
    const candidates = [];
    for (const weapon of unit.inventory || []) {
      if (!weapon || ['Staff', 'Consumable', 'Scroll'].includes(weapon.type)) continue;
      if (!candidates.includes(weapon)) candidates.push(weapon);
    }
    if (
      unit.weapon &&
      !['Staff', 'Consumable', 'Scroll'].includes(unit.weapon.type) &&
      !candidates.includes(unit.weapon)
    ) {
      candidates.push(unit.weapon);
    }
    for (const weapon of candidates) {
      for (let i = 0; i < steps; i++) {
        if (requestedDelta > 0) {
          const targetStat = resolvedForgeStat;
          if (!canForgeStat(weapon, targetStat)) break;
          const result = applyForge(weapon, targetStat);
          if (!result.success) break;
          changedWeapons.push({
            unit: unit.name,
            weapon: weapon.name,
            stat: targetStat,
            direction: 'forge',
          });
        } else {
          const result = deforgeWeapon(weapon);
          if (!result.success) break;
          changedWeapons.push({
            unit: unit.name,
            weapon: weapon.name,
            stat: result.stat || null,
            direction: 'deforge',
          });
        }
      }
    }
  }
  run._recordBlessingEvent('run_start', blessingId, effect, {
    requestedDelta,
    forgeStat: resolvedForgeStat,
    changedWeapons,
    // A deforge never goes below an unforged weapon; with nothing forged it is void
    // (the shrine does not offer it then — see isBlessingCostApplicable).
    void: changedWeapons.length === 0,
  });
  return;
}

/** `starting_best_weapon_forge`. */
function applyStartingBestWeaponForge(run, blessingId, effect, value) {
  // Blood Forge: each starting lord's strongest weapon gains `value` forge steps.
  const forgeStat = String(effect.params.stat || 'might')
    .trim()
    .toLowerCase();
  const targetStat = ['might', 'crit', 'hit', 'weight'].includes(forgeStat) ? forgeStat : 'might';
  const steps = Math.max(0, Math.trunc(value));
  if (steps <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'zero_starting_best_weapon_forge',
    });
    return;
  }
  const changedWeapons = [];
  for (const unit of run.roster) {
    if (!unit.isLord) continue;
    const weapon = run._bestForgeableWeapon(unit, targetStat);
    if (!weapon) continue;
    const before = weapon.name;
    let applied = 0;
    for (let i = 0; i < steps; i++) {
      // A gift of the shrine, not a purchase: free, so resale value does not grow.
      if (!applyForge(weapon, targetStat, 0, { free: true }).success) break; // the forge limits
      applied++;
    }
    if (applied > 0)
      changedWeapons.push({
        unit: unit.name,
        weapon: before,
        stat: targetStat,
        steps: applied,
      });
  }
  run._recordBlessingEvent('run_start', blessingId, effect, {
    forgeStat: targetStat,
    requestedSteps: steps,
    changedWeapons,
  });
  return;
}

/** `act_start_gold`. */
function applyActStartGold(run, blessingId, effect, value) {
  // Advance Pay: the shrine's gold covers the act it is taken in (paid by `gold_delta`),
  // so the first recurring payment is the next act's.
  const amount = Math.max(0, Math.trunc(value));
  if (amount <= 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_act_start_gold',
    });
    return;
  }
  run._actStartGrantList().push({
    blessingId,
    kind: 'gold',
    value: amount,
    paidActs: [run.currentAct],
  });
  // Nothing is paid now (the shrine's `gold_delta` covers this act): the record carries
  // the recurring amount, not an applied one.
  run._recordBlessingEvent('run_start', blessingId, effect, {
    recurringValue: amount,
    firstPayment: 'next_act',
  });
  return;
}

/** `act_start_convoy_item`. */
function applyActStartConvoyItem(run, blessingId, effect) {
  // Quartermaster Cache: one item at the start of every act, this one included.
  const itemName = typeof effect.params.itemName === 'string' ? effect.params.itemName : '';
  const count = Math.max(0, Math.trunc(Number(effect.params.count ?? effect.params.value ?? 1)));
  const template = itemName ? run.getConsumableTemplate(itemName) : null;
  if (count <= 0 || template?.type !== 'Consumable') {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: count <= 0 ? 'invalid_act_start_item_count' : 'missing_consumable_template',
      itemName,
    });
    return;
  }
  run._actStartGrantList().push({ blessingId, kind: 'item', itemName, count, paidActs: [] });
  run._recordBlessingEvent('run_start', blessingId, effect, { itemName, count });
  // The current act's delivery is owed now (a church vow in Act 2 pays Act 2 now); the
  // record says whether it came with the shrine or from a church or an event.
  const takenMidRun = (run.activeBlessings || []).some(
    (entry) => getBlessingEntryId(entry) === blessingId && entry?.midRun === true,
  );
  run._payActStartGrants(takenMidRun ? 'mid_run' : 'run_start');
  return;
}

/** `eclipse_shadow_delta`. */
function applyEclipseShadowDelta(run, blessingId, effect, value) {
  // The run's sun starts darker (a pact price). The act's own clock is unmoved:
  // act shadow counts from here, so no node falls because of it; only the
  // Eclipse's phase (enemy levels, affixes) arrives sooner.
  const delta = Math.trunc(value);
  if (!run.eclipse || delta === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: !run.eclipse ? 'no_eclipse' : 'zero_eclipse_shadow_delta',
    });
    return;
  }
  const cap = Math.max(0, Math.trunc(Number(run.getEclipseConfig()?.cap) || 100));
  const before = Math.max(0, Math.trunc(Number(run.eclipse.shadow) || 0));
  const after = Math.max(0, Math.min(cap, before + delta));
  const shift = after - before;
  run.eclipse = {
    ...run.eclipse,
    shadow: after,
    actStartShadow: Math.max(0, Math.trunc(Number(run.eclipse.actStartShadow) || 0) + shift),
  };
  run._recordBlessingEvent('run_start', blessingId, effect, { before, after });
  return;
}

/** `xp_multiplier_delta`. */
function applyXpMultiplierDelta(run, blessingId, effect, value) {
  run.blessingRuntimeModifiers.xpMultiplierDelta += value;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: value,
    total: run.blessingRuntimeModifiers.xpMultiplierDelta,
  });
  return;
}

/** `forge_cost_discount / forge_cost_multiplier`. */
function applyForgeCostDiscount(run, blessingId, effect, value) {
  const discountDelta = effect.type === 'forge_cost_multiplier' ? -value : value;
  run.blessingRuntimeModifiers.forgeCostDiscount += discountDelta;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: discountDelta,
    total: run.blessingRuntimeModifiers.forgeCostDiscount,
  });
  return;
}

/** `forge_limit_delta`. */
function applyForgeLimitDelta(run, blessingId, effect, value) {
  const delta = Math.trunc(value);
  run.blessingRuntimeModifiers.forgeLimitDelta =
    (run.blessingRuntimeModifiers.forgeLimitDelta || 0) + delta;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: delta,
    total: run.blessingRuntimeModifiers.forgeLimitDelta,
  });
  return;
}

/** `shop_first_forge_free`. */
function applyShopFirstForgeFree(run, blessingId, effect, value) {
  // Smith's Mark: the shop's first forge use is free; the engine decides it per shop from
  // the shop's saved count of uses (ShopCommands.freeForgeAvailable).
  const delta = Math.max(0, Math.trunc(value));
  run.blessingRuntimeModifiers.freeForgesPerShop =
    (run.blessingRuntimeModifiers.freeForgesPerShop || 0) + delta;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: delta,
    total: run.blessingRuntimeModifiers.freeForgesPerShop,
  });
  return;
}

/** `extra_shop_per_act`. */
function applyExtraShopPerAct(run, blessingId, effect, value) {
  // Pilgrim's Road: this act's map gains its shop now (a grant taken mid-run converts only
  // a node the party can still reach from where it stands), and every later act's map in
  // advanceAct.
  const delta = Math.max(0, Math.trunc(value));
  run.blessingRuntimeModifiers.extraShopsPerAct =
    (run.blessingRuntimeModifiers.extraShopsPerAct || 0) + delta;
  const here = run.nodeMap?.nodes?.find((node) => node.id === run.currentNodeId);
  const converted = run._stampExtraShops({
    fromRow: here ? here.row + 1 : 0,
    currentNodeId: run.currentNodeId,
  });
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: delta,
    total: run.blessingRuntimeModifiers.extraShopsPerAct,
    converted,
  });
  return;
}

/** `shop_price_discount`. */
function applyShopPriceDiscount(run, blessingId, effect, value) {
  const delta = Number(value) || 0;
  run.blessingRuntimeModifiers.shopPriceDiscount += delta;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: delta,
    total: run.blessingRuntimeModifiers.shopPriceDiscount,
  });
  return;
}

/** `recruit_level_bonus`. */
function applyRecruitLevelBonus(run, blessingId, effect, value) {
  run.blessingRuntimeModifiers.recruitLevelBonus += Math.trunc(value);
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: Math.trunc(value),
    total: run.blessingRuntimeModifiers.recruitLevelBonus,
  });
  return;
}

/** `first_strike_hit_bonus`. */
function applyFirstStrikeHitBonus(run, blessingId, effect, value) {
  const delta = Math.trunc(value);
  if (delta === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'zero_first_strike_hit_bonus',
    });
    return;
  }
  run.blessingRuntimeModifiers.firstStrikeHitBonus =
    Math.trunc(run.blessingRuntimeModifiers.firstStrikeHitBonus || 0) + delta;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: delta,
    total: run.blessingRuntimeModifiers.firstStrikeHitBonus,
  });
  return;
}

/** `stationary_combat_bonus`. */
function applyStationaryCombatBonus(run, blessingId, effect) {
  const defBonus = Math.trunc(Number(effect.params.defBonus) || 0);
  const avoidBonus = Math.trunc(Number(effect.params.avoidBonus) || 0);
  if (defBonus === 0 && avoidBonus === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_stationary_combat_bonus_params',
    });
    return;
  }
  const held = run.blessingRuntimeModifiers.stationaryCombatBonus;
  run.blessingRuntimeModifiers.stationaryCombatBonus = {
    defBonus: Math.trunc(held?.defBonus || 0) + defBonus,
    avoidBonus: Math.trunc(held?.avoidBonus || 0) + avoidBonus,
  };
  run._recordBlessingEvent('run_start', blessingId, effect, {
    defBonus,
    avoidBonus,
    total: { ...run.blessingRuntimeModifiers.stationaryCombatBonus },
  });
  return;
}

/** `adjacent_ally_def_bonus`. */
function applyAdjacentAllyDefBonus(run, blessingId, effect) {
  const bonus = parseAdjacentAllyDefBonus(effect.params);
  if (!bonus) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_adjacent_ally_def_bonus_params',
    });
    return;
  }
  run.blessingRuntimeModifiers.adjacentAllyDefBonuses = [
    ...sanitizeAdjacentAllyDefBonuses(run.blessingRuntimeModifiers.adjacentAllyDefBonuses),
    bonus,
  ];
  run._recordBlessingEvent('run_start', blessingId, effect, {
    ...bonus,
    held: run.blessingRuntimeModifiers.adjacentAllyDefBonuses.length,
  });
  return;
}

/** `isolated_combat_bonus`. */
function applyIsolatedCombatBonus(run, blessingId, effect) {
  const bonus = parseIsolatedCombatBonus(effect.params);
  if (!bonus) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_isolated_combat_bonus_params',
    });
    return;
  }
  run.blessingRuntimeModifiers.isolatedCombatBonuses = [
    ...sanitizeIsolatedCombatBonuses(run.blessingRuntimeModifiers.isolatedCombatBonuses),
    bonus,
  ];
  run._recordBlessingEvent('run_start', blessingId, effect, {
    ...bonus,
    held: run.blessingRuntimeModifiers.isolatedCombatBonuses.length,
  });
  return;
}

/** `healing_effectiveness_delta`. */
function applyHealingEffectivenessDelta(run, blessingId, effect, value) {
  run.blessingRuntimeModifiers.healingEffectivenessMultiplier += value;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: value,
    total: run.blessingRuntimeModifiers.healingEffectivenessMultiplier,
  });
  return;
}

/** `weapon_art_hp_cost_delta`. */
function applyWeaponArtHpCostDelta(run, blessingId, effect, value) {
  run.blessingRuntimeModifiers.weaponArtHpCostDelta += Math.trunc(value);
  run._recordBlessingEvent('run_start', blessingId, effect, {
    appliedValue: Math.trunc(value),
    total: run.blessingRuntimeModifiers.weaponArtHpCostDelta,
  });
  return;
}

/** `player_weapon_art_boon`. */
function applyPlayerWeaponArtBoon(run, blessingId, effect) {
  const boon = parsePlayerWeaponArtBoon(effect.params);
  if (!boon) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_player_weapon_art_boon_params',
    });
    return;
  }
  const { hpCostDelta, mapUsesBonus } = boon;
  run.blessingRuntimeModifiers.playerArtHpCostDelta += hpCostDelta;
  run.blessingRuntimeModifiers.playerArtMapUsesBonus += mapUsesBonus;
  run._recordBlessingEvent('run_start', blessingId, effect, {
    hpCostDelta,
    mapUsesBonus,
    totalHpCostDelta: run.blessingRuntimeModifiers.playerArtHpCostDelta,
    totalMapUsesBonus: run.blessingRuntimeModifiers.playerArtMapUsesBonus,
  });
  return;
}

/** `enemy_level_delta`. */
function applyEnemyLevelDelta(run, blessingId, effect, value) {
  // A pact price on the world, not on a unit: every foe (optionally only in one
  // act) is this many levels higher. Read by getBattleParams.
  const delta = Math.trunc(value);
  const act = typeof effect.params.act === 'string' ? effect.params.act.trim() : null;
  if (delta === 0) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'zero_enemy_level_delta',
    });
    return;
  }
  if (!Array.isArray(run.blessingRuntimeModifiers.enemyLevelDeltas))
    run.blessingRuntimeModifiers.enemyLevelDeltas = [];
  run.blessingRuntimeModifiers.enemyLevelDeltas.push({ value: delta, act: act || null });
  run._recordBlessingEvent('run_start', blessingId, effect, { appliedValue: delta, act });
  return;
}

/** `burden`. */
function applyBurden(run, blessingId, effect) {
  run._applyBurdenPrice(blessingId, effect);
  return;
}

/** `vision_delta`. */
function applyVisionDelta(run, blessingId, effect, value) {
  const before = Number.isFinite(run.visionChargesRemaining)
    ? Math.max(0, Math.trunc(run.visionChargesRemaining))
    : 0;
  run.visionChargesRemaining = Math.max(0, before + Math.trunc(value));
  run._recordBlessingEvent('run_start', blessingId, effect, {
    before,
    after: run.visionChargesRemaining,
  });
  return;
}

/** `act_deploy_cap_delta`. */
function applyActDeployCapDelta(run, blessingId, effect, value) {
  const act = typeof effect.params.act === 'string' ? effect.params.act : null;
  const delta = Math.trunc(value);
  if (act && delta !== 0) {
    const byAct = (run.blessingRuntimeModifiers.deployCapDeltaByAct ||= {});
    byAct[act] = (byAct[act] || 0) + delta;
  }
  run._recordBlessingEvent('run_start', blessingId, effect, { act, appliedValue: delta });
  return;
}

/** `church_revive_disabled`. */
function applyChurchReviveDisabled(run, blessingId, effect) {
  run.blessingRuntimeModifiers.churchReviveDisabled = true;
  run._recordBlessingEvent('run_start', blessingId, effect, {});
  return;
}

/** `lord_stat_arc`. */
function applyLordStatArc(run, blessingId, effect) {
  const tracker = startLordStatArc(run, blessingId, effect.params);
  run._recordBlessingEvent(
    'run_start',
    blessingId,
    effect,
    tracker
      ? {
          dipAct: tracker.dipAct,
          dip: tracker.dip,
          riseAct: tracker.riseAct,
          rise: tracker.rise,
          appliedUnits: tracker.unitUids,
          dipTaken: tracker.dipTaken,
          riseApplied: tracker.riseApplied,
        }
      : { skipped: true, reason: 'invalid_lord_stat_arc_params' },
  );
  return;
}

/** `battle_gold_gamble`. */
function applyBattleGoldGamble(run, blessingId, effect) {
  const gamble = parseBattleGoldGamble(effect.params);
  if (gamble) run.blessingRuntimeModifiers.battleGoldGamble = gamble;
  run._recordBlessingEvent(
    'run_start',
    blessingId,
    effect,
    gamble ? { ...gamble } : { skipped: true, reason: 'invalid_battle_gold_gamble_params' },
  );
  return;
}

/** `act_start_vision_delta`. */
function applyActStartVisionDelta(run, blessingId, effect, value) {
  // Second Dawn: +value Vision as each act begins (an act-start grant, paid by
  // _payActStartGrants). The take happens at an act boss, before advanceAct, so the act it
  // is taken in counts as paid: the first payment is the next act's, never the take's.
  const amount = Math.trunc(value);
  if (!(amount > 0)) {
    run._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'invalid_act_start_vision_delta_params',
    });
    return;
  }
  run._actStartGrantList().push({
    blessingId,
    kind: 'vision',
    value: amount,
    paidActs: run.currentAct ? [run.currentAct] : [],
  });
  run._recordBlessingEvent('run_start', blessingId, effect, {
    recurringValue: amount,
    firstPayment: 'next_act',
  });
  return;
}

/**
 * Effect type -> handler, for every run-start effect the shrine, a church vow, an event, a start
 * gift and a twist price share. A handler reads its own params and records its own history
 * event; it returns nothing. Frozen; look a type up with `Object.hasOwn`.
 */
export const RUN_START_BLESSING_EFFECTS = Object.freeze({
  run_start_max_hp_bonus: applyRunStartMaxHpBonus,
  gold_delta: applyGoldDelta,
  battle_gold_multiplier_delta: applyBattleGoldMultiplierDelta,
  deploy_cap_delta: applyDeployCapDelta,
  starting_weapon_tier: applyStartingWeaponTier,
  act_stat_delta_all_units: applyActStatDeltaAllUnits,
  act_hit_bonus: applyActHitBonus,
  all_act_hit_bonus: applyAllActHitBonus,
  lord_stat_bonus: applyLordStatBonus,
  all_units_stat_delta: applyAllUnitsStatDelta,
  skip_first_shop: applySkipFirstShop,
  shop_item_count_delta: applyShopItemCountDelta,
  all_growths_delta: applyAllGrowthsDelta,
  targeted_growths_delta: applyTargetedGrowthsDelta,
  disable_personal_skills_until_act: applyDisablePersonalSkillsUntilAct,
  starting_consumable_all: applyStartingConsumableAll,
  extra_consumable: applyExtraConsumable,
  extra_vulnerary: applyExtraConsumable,
  starting_random_skill: applyStartingRandomSkill,
  starting_whetstones: applyStartingWhetstones,
  starting_scroll: applyStartingScroll,
  starting_forge_lords: applyStartingWeaponForge,
  starting_weapon_forge_delta: applyStartingWeaponForge,
  starting_best_weapon_forge: applyStartingBestWeaponForge,
  act_start_gold: applyActStartGold,
  act_start_convoy_item: applyActStartConvoyItem,
  eclipse_shadow_delta: applyEclipseShadowDelta,
  xp_multiplier_delta: applyXpMultiplierDelta,
  forge_cost_discount: applyForgeCostDiscount,
  forge_cost_multiplier: applyForgeCostDiscount,
  forge_limit_delta: applyForgeLimitDelta,
  shop_first_forge_free: applyShopFirstForgeFree,
  extra_shop_per_act: applyExtraShopPerAct,
  shop_price_discount: applyShopPriceDiscount,
  recruit_level_bonus: applyRecruitLevelBonus,
  first_strike_hit_bonus: applyFirstStrikeHitBonus,
  stationary_combat_bonus: applyStationaryCombatBonus,
  adjacent_ally_def_bonus: applyAdjacentAllyDefBonus,
  isolated_combat_bonus: applyIsolatedCombatBonus,
  healing_effectiveness_delta: applyHealingEffectivenessDelta,
  weapon_art_hp_cost_delta: applyWeaponArtHpCostDelta,
  player_weapon_art_boon: applyPlayerWeaponArtBoon,
  enemy_level_delta: applyEnemyLevelDelta,
  burden: applyBurden,
  vision_delta: applyVisionDelta,
  act_deploy_cap_delta: applyActDeployCapDelta,
  church_revive_disabled: applyChurchReviveDisabled,
  lord_stat_arc: applyLordStatArc,
  battle_gold_gamble: applyBattleGoldGamble,
  act_start_vision_delta: applyActStartVisionDelta,
});
