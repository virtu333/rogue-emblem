// RepeatableUpgrades — a Home Base upgrade that keeps selling tiers past its list.
//
// An upgrade in data/metaUpgrades.json may carry `repeatable: { cost, effect }`: its listed
// tiers (`costs`, `effects`, `maxLevel`, all the same length) sell as ever, then every
// further tier costs `cost` and adds `effect` (numbers only) on top of the last listed
// tier's effect, forever; `maxLevel` no longer caps it. Branching Threads is the first:
// tiers 1-4 at 100/200/300/350 (1-4 rerolls a run), then 400 Supply for each +1.
//
// A tier's effect is a total, like every listed tier's (getActiveEffects never sums the
// tiers of one upgrade), so tier N of Branching Threads reads `rewardRerolls: N`.
// Pure: no state, no RNG.

/** Whether an upgrade sells tiers past its list (a valid `repeatable` block). */
export function isRepeatableUpgrade(upgrade) {
  const r = upgrade?.repeatable;
  return Boolean(
    r &&
    typeof r === 'object' &&
    Number.isInteger(r.cost) &&
    r.cost > 0 &&
    r.effect &&
    typeof r.effect === 'object' &&
    Object.keys(r.effect).length > 0,
  );
}

/** How many tiers the upgrade lists (its `costs`). */
export function listedTiers(upgrade) {
  return Array.isArray(upgrade?.costs) ? upgrade.costs.length : 0;
}

/**
 * What tier `tier` (1-based) costs: the listed price, the repeatable price past the list,
 * or null when there is no such tier.
 */
export function upgradeTierCost(upgrade, tier) {
  const t = Math.trunc(Number(tier));
  if (!upgrade || !(t >= 1)) return null;
  if (t <= listedTiers(upgrade)) return upgrade.costs[t - 1] ?? null;
  return isRepeatableUpgrade(upgrade) ? upgrade.repeatable.cost : null;
}

/**
 * Where the tiers past the list are stored. Older builds read `purchasedUpgrades[id]` as an
 * index into their own `costs` / `effects` (`effects[level - 1]`, no clamp; a refund's
 * `costs[level - 1]`, so a level past the list gives them no effect and a NaN refund that
 * saves as 0 Supply and syncs back). The synced value for the id therefore never passes
 * the listed tiers; the repeat tiers live under this key, which an older build never
 * reads (it only looks up the ids its own data lists) and keeps when it saves.
 */
export function repeatTiersKey(id) {
  return `${id}__repeat_tiers`;
}

/** A tier split into what the id stores (the listed tiers) and the repeat tiers past them. */
export function splitUpgradeLevel(upgrade, level) {
  const total = Math.max(0, Math.trunc(Number(level) || 0));
  const listed = Math.min(total, listedTiers(upgrade));
  return { listed, repeat: total - listed };
}

/** The tier from its two stored parts (`listed` is clamped to the list). */
export function joinUpgradeLevel(listed, repeat) {
  return (
    Math.max(0, Math.trunc(Number(listed) || 0)) + Math.max(0, Math.trunc(Number(repeat) || 0))
  );
}

/** Whether every tier has been bought (never, for a repeatable upgrade). */
export function upgradeMaxedAt(upgrade, level) {
  if (!upgrade || isRepeatableUpgrade(upgrade)) return false;
  return Math.trunc(Number(level) || 0) >= upgrade.maxLevel;
}

/**
 * The effect an upgrade gives at `level` (a total): the listed tier's, or past the list the
 * last listed tier's with `repeatable.effect` added once per further tier. Undefined at
 * level 0, or past the list of an upgrade that does not repeat (as `effects[level - 1]`).
 */
export function upgradeEffectAtLevel(upgrade, level) {
  const lv = Math.trunc(Number(level) || 0);
  const effects = Array.isArray(upgrade?.effects) ? upgrade.effects : [];
  if (lv <= 0) return undefined;
  // Past the list of an upgrade that does not repeat, the last tier stands (never undefined).
  if (!isRepeatableUpgrade(upgrade)) return effects[Math.min(lv, effects.length) - 1];
  if (lv <= effects.length) return effects[lv - 1];
  const extra = lv - effects.length;
  const effect = { ...(effects[effects.length - 1] || {}) };
  for (const [key, value] of Object.entries(upgrade.repeatable.effect))
    if (Number.isFinite(value)) effect[key] = (Number(effect[key]) || 0) + value * extra;
  return effect;
}

/**
 * Data errors for repeatable upgrades (npm run validate:data): the listed tiers agree in
 * length with `maxLevel`, the price is a positive whole number, and each added effect is a
 * number the last listed tier already carries (so the tiers past the list continue it).
 * @returns {string[]}
 */
export function validateRepeatableUpgrades(upgrades) {
  const errors = [];
  for (const upgrade of Array.isArray(upgrades) ? upgrades : []) {
    if (upgrade?.repeatable === undefined) continue;
    const at = `metaUpgrades.${upgrade?.id ?? '?'}.repeatable`;
    if (!isRepeatableUpgrade(upgrade)) {
      errors.push(`${at} needs { cost: positive integer, effect: non-empty object }`);
      continue;
    }
    const listed = listedTiers(upgrade);
    if (listed !== upgrade.maxLevel || (upgrade.effects || []).length !== listed)
      errors.push(`${at}: costs, effects and maxLevel must list the same tiers`);
    const last = upgrade.effects?.[upgrade.effects.length - 1] || {};
    for (const [key, value] of Object.entries(upgrade.repeatable.effect)) {
      if (!Number.isFinite(value) || value <= 0)
        errors.push(`${at}.effect.${key} must be a positive number`);
      else if (!Number.isFinite(last[key]))
        errors.push(`${at}.effect.${key} is not a number the last listed tier carries`);
    }
  }
  return errors;
}
