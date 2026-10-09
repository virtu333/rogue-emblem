// BlessingEngine.js - Wave 6 blessing validation and deterministic option selection.
// Pure functions, no scene dependency.
//
// Contract v3 (docs/specs/blessings-v3.md §3): prices come from a named `priceCatalog`, each
// with a point value. A tier II-III blessing names its candidate `prices` (a catalog id, or an
// array of ids paid together); a tier IV blessing carries a fixed `pact` (catalog ids). Every
// candidate's points sit inside its tier's `tierBands`. Offers draw slots 2+ by tier
// (`offerWeights`), never two of one tier. A v2 config (rolled tier `costPools`) still
// validates and selects as before, so old fixtures and saves keep working.
//
// An `intrinsicPrice` ({ label, points }) is the third kind of tier II-III price: the blessing's
// own boon carries its cost (Slow Fuse's Act 1 dip, Gambler's Toss's bad tosses), so there is no
// catalog entry to pay and nothing to apply. It still spends the one price draw a pact does.
//
// An `earned: true` blessing (docs/specs/blessings-v3.md §6) is won in a run, never offered at the
// start, a church or an event: it has no tier, no prices, no pact and no costs (`weight` is its
// draw weight among the earned).

import { parseLordStatArc } from './LordStatArc.js';
import { parseBattleGoldGamble } from './BattleGoldGamble.js';
import { playerWeaponArtBoonErrors } from './WeaponArtSystem.js';
import { ACT_SEQUENCE } from '../utils/constants.js';

export const BLESSINGS_CONTRACT_VERSION = 3;
const SUPPORTED_VERSIONS = new Set([2, 3]);
const VALID_TIERS = new Set([1, 2, 3, 4]);
// A Debt price's amount is set for Dusk and scaled by rung (data `debtScale`), rounded to this.
const DEBT_ROUNDING = 50;
const REQUIRED_TOP_LEVEL_KEYS = ['version', 'blessings', 'costPools'];
const REQUIRED_BLESSING_KEYS = ['id', 'name', 'description', 'boons', 'costs'];
// Fields an earned blessing may not carry: it is free and has no tier.
const EARNED_FORBIDDEN_KEYS = ['tier', 'prices', 'pact', 'intrinsicPrice'];
const REQUIRED_EFFECT_KEYS = ['type', 'params'];
const REQUIRED_COST_POOL_KEYS = ['2', '3', '4'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True for a blessing that is won in a run (`earned: true`), never offered for a pick. */
export function isEarnedBlessing(blessing) {
  return blessing?.earned === true;
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createSeededRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Boons whose only param is a positive integer `value` (the earned blessings' effects).
const EARNED_BOON_VALUE_TYPES = new Set([
  'battle_last_stand',
  'act_start_vision_delta',
  'first_kill_heal',
  'first_turn_mov_delta',
]);

/**
 * Params of the boons whose handler quietly skips a malformed set (a card that does nothing
 * ships as a "valid" blessing). Each runs through the parser the handler uses; the bounds the
 * parser leaves loose are checked here. Appends to `errors`.
 */
function validateBoonParams(effect, path, errors) {
  if (effect.type === 'lord_stat_arc') {
    if (!parseLordStatArc(effect.params, ACT_SEQUENCE))
      errors.push(
        `${path}.params is not a usable lord_stat_arc (stats, integer dip/rise, dipAct/riseAct in ${ACT_SEQUENCE.join('/')})`,
      );
  } else if (effect.type === 'battle_gold_gamble') {
    const gamble = parseBattleGoldGamble(effect.params);
    if (!gamble) {
      errors.push(`${path}.params is not a usable battle_gold_gamble (0 < chance < 1, win, lose)`);
    } else if (!(gamble.lose < 1 && gamble.win > 1)) {
      errors.push(
        `${path}.params must have lose < 1 < win (a toss that cuts the gold and one that raises it)`,
      );
    }
  } else if (effect.type === 'player_weapon_art_boon') {
    for (const message of playerWeaponArtBoonErrors(effect.params))
      errors.push(`${path}.${message}`);
  } else if (EARNED_BOON_VALUE_TYPES.has(effect.type)) {
    // The earned blessings' handlers read `params.value` and skip a malformed one, which would
    // ship a card that does nothing.
    const value = effect.params?.value;
    if (!Number.isInteger(value) || value <= 0)
      errors.push(`${path}.params.value must be a positive integer (${effect.type})`);
  }
}

/**
 * Validate blessings config shape.
 * @param {object} config
 * @param {{strict?: boolean}} options
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateBlessingsConfig(config, options = {}) {
  const strict = options.strict !== false;
  const errors = [];
  const warnings = [];

  if (!isObject(config)) {
    return { valid: false, errors: ['config must be an object'], warnings };
  }

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in config)) errors.push(`missing top-level key: ${key}`);
  }
  if (errors.length > 0) return { valid: false, errors, warnings };

  if (!Array.isArray(config.blessings)) {
    errors.push('blessings must be an array');
    return { valid: false, errors, warnings };
  }
  if (config.blessings.length === 0) errors.push('blessings must contain at least one entry');
  if (!isObject(config.costPools)) {
    errors.push('costPools must be an object');
  }

  if (typeof config.version !== 'number') {
    errors.push('version must be a number');
  } else if (!SUPPORTED_VERSIONS.has(config.version)) {
    const message = `version mismatch: expected ${BLESSINGS_CONTRACT_VERSION}, got ${config.version}`;
    if (strict) errors.push(message);
    else warnings.push(message);
  }

  const ids = new Set();
  let hasTier1 = false;

  config.blessings.forEach((blessing, idx) => {
    const path = `blessings[${idx}]`;
    if (!isObject(blessing)) {
      errors.push(`${path} must be an object`);
      return;
    }

    for (const key of REQUIRED_BLESSING_KEYS) {
      if (!(key in blessing)) errors.push(`${path} missing required key: ${key}`);
    }
    if (typeof blessing.id !== 'string' || blessing.id.trim() === '') {
      errors.push(`${path}.id must be a non-empty string`);
    } else if (ids.has(blessing.id)) {
      errors.push(`${path}.id duplicate: ${blessing.id}`);
    } else {
      ids.add(blessing.id);
    }
    if (typeof blessing.name !== 'string' || blessing.name.trim() === '') {
      errors.push(`${path}.name must be a non-empty string`);
    }
    if (blessing.earned !== undefined && typeof blessing.earned !== 'boolean') {
      errors.push(`${path}.earned must be a boolean`);
    }
    const earned = isEarnedBlessing(blessing);
    if (earned) {
      for (const key of EARNED_FORBIDDEN_KEYS)
        if (blessing[key] !== undefined)
          errors.push(`${path}.${key} is not allowed on an earned blessing`);
    } else if (!('tier' in blessing)) {
      errors.push(`${path} missing required key: tier`);
    } else if (!VALID_TIERS.has(blessing.tier)) {
      errors.push(`${path}.tier must be one of 1,2,3,4`);
    }
    if (!earned && blessing.tier === 1) hasTier1 = true;
    if (typeof blessing.description !== 'string' || blessing.description.trim() === '') {
      errors.push(`${path}.description must be a non-empty string`);
    }
    if (!Array.isArray(blessing.boons) || blessing.boons.length === 0) {
      errors.push(`${path}.boons must be a non-empty array`);
    }
    if (!Array.isArray(blessing.costs)) {
      errors.push(`${path}.costs must be an array`);
    } else if (earned) {
      if (blessing.costs.length !== 0)
        errors.push(`${path}.costs must be empty for an earned blessing`);
    } else {
      if (blessing.tier === 1 && blessing.costs.length !== 0) {
        errors.push(`${path}.costs must be empty for tier 1`);
      }
      if (blessing.tier >= 2 && blessing.costs.length !== 0) {
        errors.push(`${path}.costs must be empty for tier ${blessing.tier}; use costPools`);
      }
    }
    // A pact is a fixed, always-shown price that replaces the rolled cost: catalog ids (v3)
    // or a { label, effects } entry (v2).
    if (!earned && blessing.pact !== undefined && !Array.isArray(blessing.pact)) {
      if (blessing.tier < 2) errors.push(`${path}.pact is only allowed for tier 2+`);
      if (!isObject(blessing.pact)) {
        errors.push(`${path}.pact must be an object`);
      } else {
        if (typeof blessing.pact.label !== 'string' || blessing.pact.label.trim() === '')
          errors.push(`${path}.pact.label must be a non-empty string`);
        if (!Array.isArray(blessing.pact.effects) || blessing.pact.effects.length === 0) {
          errors.push(`${path}.pact.effects must be a non-empty array`);
        } else {
          blessing.pact.effects.forEach((effect, effectIdx) => {
            const effectPath = `${path}.pact.effects[${effectIdx}]`;
            if (!isObject(effect)) {
              errors.push(`${effectPath} must be an object`);
              return;
            }
            if (typeof effect.type !== 'string' || effect.type.trim() === '')
              errors.push(`${effectPath}.type must be a non-empty string`);
            if (!isObject(effect.params)) errors.push(`${effectPath}.params must be an object`);
          });
        }
      }
    }

    if (!earned && blessing.intrinsicPrice !== undefined && config.version !== 3) {
      errors.push(`${path}.intrinsicPrice needs contract v3`);
    }

    for (const effectKey of ['boons', 'costs']) {
      const effects = blessing[effectKey];
      if (!Array.isArray(effects)) continue;
      effects.forEach((effect, effectIdx) => {
        const effectPath = `${path}.${effectKey}[${effectIdx}]`;
        if (!isObject(effect)) {
          errors.push(`${effectPath} must be an object`);
          return;
        }
        for (const key of REQUIRED_EFFECT_KEYS) {
          if (!(key in effect)) errors.push(`${effectPath} missing required key: ${key}`);
        }
        if (typeof effect.type !== 'string' || effect.type.trim() === '') {
          errors.push(`${effectPath}.type must be a non-empty string`);
        }
        if (!isObject(effect.params)) {
          errors.push(`${effectPath}.params must be an object`);
        } else if (effectKey === 'boons') {
          validateBoonParams(effect, effectPath, errors);
        }
      });
    }
  });

  if (!hasTier1) {
    errors.push('at least one tier-1 blessing is required');
  }

  if (config.version === 3) validateV3Pricing(config, errors);

  if (isObject(config.costPools)) {
    for (const tierKey of REQUIRED_COST_POOL_KEYS) {
      const pool = config.costPools[tierKey];
      if (!Array.isArray(pool) || pool.length === 0) {
        errors.push(`costPools.${tierKey} must be a non-empty array`);
        continue;
      }
      pool.forEach((entry, entryIdx) => {
        const entryPath = `costPools.${tierKey}[${entryIdx}]`;
        if (!isObject(entry)) {
          errors.push(`${entryPath} must be an object`);
          return;
        }
        if (typeof entry.label !== 'string' || entry.label.trim() === '') {
          errors.push(`${entryPath}.label must be a non-empty string`);
        }
        if (!Array.isArray(entry.effects) || entry.effects.length === 0) {
          errors.push(`${entryPath}.effects must be a non-empty array`);
          return;
        }
        entry.effects.forEach((effect, effectIdx) => {
          const effectPath = `${entryPath}.effects[${effectIdx}]`;
          if (!isObject(effect)) {
            errors.push(`${effectPath} must be an object`);
            return;
          }
          for (const key of REQUIRED_EFFECT_KEYS) {
            if (!(key in effect)) errors.push(`${effectPath} missing required key: ${key}`);
          }
          if (typeof effect.type !== 'string' || effect.type.trim() === '') {
            errors.push(`${effectPath}.type must be a non-empty string`);
          }
          if (!isObject(effect.params)) {
            errors.push(`${effectPath}.params must be an object`);
          }
        });
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function priceOptionIds(option) {
  return Array.isArray(option) ? option : [option];
}

function effectTypesOf(effects) {
  return new Set((Array.isArray(effects) ? effects : []).map((e) => e?.type).filter(Boolean));
}

/** A blessing's own tags: those it declares. */
function tagsOf(entry) {
  return new Set(Array.isArray(entry?.tags) ? entry.tags : []);
}

function validateV3Pricing(config, errors) {
  const catalog = config.priceCatalog;
  if (!isObject(catalog) || Object.keys(catalog).length === 0) {
    errors.push('priceCatalog must be a non-empty object (v3)');
    return;
  }
  for (const [id, entry] of Object.entries(catalog)) {
    const path = `priceCatalog.${id}`;
    if (!isObject(entry)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    if (typeof entry.label !== 'string' || entry.label.trim() === '')
      errors.push(`${path}.label must be a non-empty string`);
    if (!Number.isFinite(entry.points) || entry.points <= 0)
      errors.push(`${path}.points must be a positive number`);
    if (!Array.isArray(entry.effects) || entry.effects.length === 0) {
      errors.push(`${path}.effects must be a non-empty array`);
      continue;
    }
    entry.effects.forEach((effect, i) => {
      if (!isObject(effect) || typeof effect.type !== 'string' || !isObject(effect.params))
        errors.push(`${path}.effects[${i}] must be { type, params }`);
    });
  }
  const bands = config.tierBands;
  for (const tier of ['2', '3', '4']) {
    const band = bands?.[tier];
    if (!Array.isArray(band) || band.length !== 2 || !(band[0] <= band[1]))
      errors.push(`tierBands.${tier} must be [min, max] (v3)`);
  }
  const weights = config.offerWeights;
  if (!isObject(weights) || !['2', '3', '4'].some((t) => Number(weights[t]) > 0))
    errors.push('offerWeights must give tier 2, 3 or 4 a positive weight (v3)');
  if (config.debtScale !== undefined && !isObject(config.debtScale))
    errors.push('debtScale must be an object of rung -> multiplier');

  const checkOption = (blessing, option, path) => {
    const ids = priceOptionIds(option);
    if (ids.length === 0) {
      errors.push(`${path} must name at least one price`);
      return;
    }
    let points = 0;
    const priceTypes = new Set();
    const priceTags = new Set();
    for (const id of ids) {
      const entry = isObject(catalog) ? catalog[id] : null;
      if (typeof id !== 'string' || !entry) {
        errors.push(`${path}: unknown price "${id}"`);
        return;
      }
      points += Number(entry.points) || 0;
      for (const t of effectTypesOf(entry.effects)) priceTypes.add(t);
      for (const t of tagsOf(entry)) priceTags.add(t);
    }
    const band = bands?.[String(blessing.tier)];
    if (Array.isArray(band) && (points < band[0] - 1e-9 || points > band[1] + 1e-9))
      errors.push(
        `${path} costs ${points} points, outside tier ${blessing.tier}'s band ${band[0]}-${band[1]}`,
      );
    const boonTypes = effectTypesOf(blessing.boons);
    for (const t of priceTypes)
      if (boonTypes.has(t)) errors.push(`${path} shares the effect type "${t}" with its boon`);
    // Never a gold price on a gold boon (a Debt on Merchant Bane cancels itself).
    if (tagsOf(blessing).has('gold') && priceTags.has('gold'))
      errors.push(`${path} is a gold price on a gold blessing`);
  };

  // An intrinsic price is { label, points }: the blessing's own boon carries the cost, so it
  // names no catalog entry, but its points sit inside the tier's band like any other price.
  const checkIntrinsic = (blessing, path) => {
    const price = blessing.intrinsicPrice;
    if (!isObject(price)) {
      errors.push(`${path}.intrinsicPrice must be { label, points }`);
      return;
    }
    if (typeof price.label !== 'string' || price.label.trim() === '')
      errors.push(`${path}.intrinsicPrice.label must be a non-empty string`);
    if (!Number.isFinite(price.points) || price.points <= 0) {
      errors.push(`${path}.intrinsicPrice.points must be a positive number`);
      return;
    }
    const band = bands?.[String(blessing.tier)];
    if (Array.isArray(band) && (price.points < band[0] - 1e-9 || price.points > band[1] + 1e-9))
      errors.push(
        `${path}.intrinsicPrice costs ${price.points} points, outside tier ${blessing.tier}'s band ${band[0]}-${band[1]}`,
      );
  };

  for (const blessing of config.blessings || []) {
    if (!isObject(blessing)) continue;
    if (isEarnedBlessing(blessing)) continue; // free: the base validator forbids any price
    const path = `blessings.${blessing.id}`;
    const hasPrices = Array.isArray(blessing.prices) && blessing.prices.length > 0;
    const hasPact = Array.isArray(blessing.pact);
    const hasIntrinsic = blessing.intrinsicPrice !== undefined;
    if (blessing.tier === 1) {
      if (hasPrices || blessing.pact !== undefined || hasIntrinsic)
        errors.push(`${path}: a tier 1 blessing is a free gift (no prices, no pact)`);
      continue;
    }
    if (hasIntrinsic) {
      checkIntrinsic(blessing, path);
      if (hasPrices || blessing.pact !== undefined)
        errors.push(`${path}: an intrinsic price replaces prices and pact; name only one`);
      if (blessing.tier === 4) errors.push(`${path}: a tier 4 blessing carries a fixed pact (v3)`);
      continue;
    }
    if (isObject(blessing.pact)) {
      errors.push(`${path}.pact must be a list of priceCatalog ids (v3)`);
      continue;
    }
    if (blessing.tier === 4 && !hasPact)
      errors.push(`${path}: a tier 4 blessing carries a fixed pact (v3)`);
    if (blessing.tier < 4 && hasPact)
      errors.push(`${path}: only tier 4 carries a pact; tier ${blessing.tier} names its prices`);
    if (blessing.tier < 4 && !hasPrices)
      errors.push(`${path}.prices must name the blessing's candidate prices (v3)`);
    if (hasPact) checkOption(blessing, blessing.pact, `${path}.pact`);
    if (hasPrices)
      blessing.prices.forEach((option, i) => checkOption(blessing, option, `${path}.prices[${i}]`));
  }
}

/**
 * One price as a run applies it: `{ label, effects, points, kind }` from catalog ids (a
 * single id or ids paid together). A Debt is set for Dusk in the catalog and scaled to the
 * rung here (`debtScale`), so the stored price carries the amount the run will owe and its
 * label says it.
 * @param {object} config - blessings config (v3)
 * @param {string|string[]} option
 * @param {{ difficultyId?: string, kind?: 'cost'|'pact' }} [context]
 * @returns {{label: string, effects: object[], points: number, kind: string} | null}
 */
export function resolvePriceOption(
  config,
  option,
  { difficultyId = 'normal', kind = 'cost' } = {},
) {
  const catalog = config?.priceCatalog;
  if (!isObject(catalog)) return null;
  const scale = Number(config?.debtScale?.[difficultyId]);
  const debtScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const labels = [];
  const effects = [];
  let points = 0;
  for (const id of priceOptionIds(option)) {
    const entry = catalog[id];
    if (!isObject(entry)) return null;
    points += Number(entry.points) || 0;
    let label = entry.label;
    for (const effect of entry.effects || []) {
      const copy = cloneDeep(effect);
      if (copy.type === 'burden' && copy.params?.id === 'debt' && Number(copy.params.owed) > 0) {
        const owed = Math.max(
          DEBT_ROUNDING,
          Math.round((Number(copy.params.owed) * debtScale) / DEBT_ROUNDING) * DEBT_ROUNDING,
        );
        copy.params.owed = owed;
        label = label.replace('{owed}', owed.toLocaleString('en-US'));
      }
      effects.push(copy);
    }
    labels.push(label);
  }
  return { label: labels.join(' · '), effects, points, kind };
}

/**
 * Roll a v3 blessing's price: its intrinsic price or its pact (one draw is still spent, as for
 * a v2 pact), or one of
 * its candidate prices, uniformly, among those `isApplicable` accepts (a price that would cost
 * this run nothing is never offered; when none is applicable, all are candidates).
 * @returns {{label: string, effects: object[], points: number, kind: string} | null}
 */
export function rollPriceForBlessing(config, blessing, rand, options = {}) {
  if (typeof rand !== 'function') throw new Error('rollPriceForBlessing requires an RNG');
  const context = { difficultyId: options.difficultyId };
  if (isObject(blessing?.intrinsicPrice)) {
    // The boon carries its own cost: nothing to resolve or apply, but one draw is still
    // spent (as for a pact) so every other offer's roll is unchanged.
    rand();
    const { label, points } = blessing.intrinsicPrice;
    return { label, effects: [], points, kind: 'intrinsic' };
  }
  if (Array.isArray(blessing?.pact)) {
    rand();
    return resolvePriceOption(config, blessing.pact, { ...context, kind: 'pact' });
  }
  const candidates = (Array.isArray(blessing?.prices) ? blessing.prices : [])
    .map((option) => resolvePriceOption(config, option, context))
    .filter(Boolean);
  if (candidates.length === 0) return null;
  const applicable =
    typeof options.isApplicable === 'function'
      ? candidates.filter((price) => options.isApplicable(price))
      : candidates;
  const pool = applicable.length > 0 ? applicable : candidates;
  return pool[Math.floor(rand() * pool.length)] || null;
}

/** True when a config prices blessings through the v3 catalog. */
export function usesPriceCatalog(config) {
  return config?.version === 3 && isObject(config?.priceCatalog);
}

/**
 * Validate and throw on invalid config.
 * @param {object} config
 * @param {{strict?: boolean}} options
 * @returns {object} normalized deep clone
 */
export function assertValidBlessingsConfig(config, options = {}) {
  const result = validateBlessingsConfig(config, options);
  if (!result.valid) {
    throw new Error(`Invalid blessings config: ${result.errors.join('; ')}`);
  }
  return cloneDeep(config);
}

/**
 * Return blessing lookup map by id.
 * @param {object} config
 * @returns {Map<string, object>}
 */
export function buildBlessingIndex(config) {
  const valid = assertValidBlessingsConfig(config);
  const index = new Map();
  for (const blessing of valid.blessings) {
    index.set(blessing.id, blessing);
  }
  return index;
}

function pickWeighted(items, rand) {
  const total = items.reduce((sum, it) => sum + (Number.isFinite(it.weight) ? it.weight : 1), 0);
  if (total <= 0) return items[Math.floor(rand() * items.length)];
  let roll = rand() * total;
  for (const item of items) {
    roll -= Number.isFinite(item.weight) ? item.weight : 1;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Roll one runtime cost entry for a blessing from a tier pool.
 * A blessing with a `pact` always costs its pact (one draw is still spent so every
 * other offer's roll is unchanged). Otherwise cost entries sharing an effect type with
 * the boon are excluded when possible, and so are entries `options.isApplicable`
 * rejects (a cost that would do nothing, e.g. deforging weapons that carry no forge):
 * a shrine never offers a void price.
 * @param {object[]} costPool
 * @param {object} blessing
 * @param {() => number} rand
 * @param {{ isApplicable?: (entry: object) => boolean }} [options]
 * @returns {{label: string, effects: object[]} | null}
 */
export function rollCostForBlessing(costPool, blessing, rand, options = {}) {
  if (typeof rand !== 'function') {
    throw new Error('rollCostForBlessing requires an RNG function argument');
  }
  if (isObject(blessing?.pact)) {
    rand();
    return cloneDeep(blessing.pact);
  }
  if (!Array.isArray(costPool) || costPool.length === 0) return null;
  const boonTypes = new Set(
    (Array.isArray(blessing?.boons) ? blessing.boons : [])
      .map((effect) => effect?.type)
      .filter(Boolean),
  );
  const applicable =
    typeof options.isApplicable === 'function'
      ? costPool.filter((entry) => options.isApplicable(entry))
      : costPool;
  const base = applicable.length > 0 ? applicable : costPool;
  const nonConflicting = base.filter((entry) => {
    const effects = Array.isArray(entry?.effects) ? entry.effects : [];
    return !effects.some((effect) => boonTypes.has(effect?.type));
  });
  const eligible = nonConflicting.length > 0 ? nonConflicting : base;
  const picked = eligible[Math.floor(rand() * eligible.length)];
  if (!picked) return null;
  return cloneDeep(picked);
}

/**
 * Select blessing options deterministically with injected RNG.
 * @param {object} config
 * @param {() => number} rand - returns [0,1)
 * @param {{count?: number, forceTier1?: boolean, allowTier4?: boolean}} options
 * @returns {object[]} selected blessing definitions
 */
export function selectBlessingOptions(config, rand, options = {}) {
  return selectBlessingOptionsWithTelemetry(config, rand, options).selected;
}

/**
 * Select blessing options and include structured selection telemetry.
 * @param {object} config
 * @param {() => number} rand - returns [0,1)
 * @param {{count?: number, forceTier1?: boolean, allowTier4?: boolean}} options
 * @returns {{selected: object[], telemetry: object}}
 */
export function selectBlessingOptionsWithTelemetry(config, rand, options = {}) {
  const valid = assertValidBlessingsConfig(config);
  if (typeof rand !== 'function') {
    throw new Error('selectBlessingOptions requires an RNG function argument');
  }

  const count = Math.max(1, Math.min(4, options.count ?? 3));
  const forceTier1 = options.forceTier1 !== false;
  const allowTier4 = options.allowTier4 !== false;

  // An earned blessing is won in a run, never offered at a shrine (docs/specs/blessings-v3.md §6).
  const pool = valid.blessings.filter((b) => !isEarnedBlessing(b));
  const selected = [];
  const rejectionReasons = [];
  const selectedIds = new Set();

  function violatesExclusion(candidate) {
    const excludes = Array.isArray(candidate.excludes) ? candidate.excludes : [];
    for (const chosenId of selectedIds) {
      const chosen = pool.find((b) => b.id === chosenId);
      const chosenExcludes = Array.isArray(chosen?.excludes) ? chosen.excludes : [];
      if (excludes.includes(chosenId) || chosenExcludes.includes(candidate.id)) {
        return `excludes:${chosenId}`;
      }
    }
    return null;
  }

  if (forceTier1) {
    const tier1 = pool.filter((b) => b.tier === 1 && !violatesExclusion(b));
    if (tier1.length === 0) {
      throw new Error('cannot force tier1 option: no tier1 blessings available');
    }
    const first = pickWeighted(tier1, rand);
    selected.push(first);
    selectedIds.add(first.id);
  }

  const v3 = usesPriceCatalog(valid);
  const usedTiers = new Set();
  while (v3 && selected.length < count) {
    // v3: each later slot draws a tier by `offerWeights` (never one already drawn), then a
    // blessing of that tier by its weight. A blessing at weight 0 is never offered.
    const available = (tier) =>
      pool.filter(
        (b) =>
          b.tier === tier &&
          !selectedIds.has(b.id) &&
          (Number.isFinite(b.weight) ? b.weight : 1) > 0 &&
          (allowTier4 || b.tier !== 4) &&
          !violatesExclusion(b),
      );
    const tiers = Object.entries(valid.offerWeights || {})
      .map(([tier, weight]) => ({ tier: Number(tier), weight: Number(weight) || 0 }))
      .filter((t) => t.weight > 0 && !usedTiers.has(t.tier) && available(t.tier).length > 0)
      .sort((a, b) => a.tier - b.tier);
    if (tiers.length === 0) break;
    const { tier } = pickWeighted(tiers, rand);
    usedTiers.add(tier);
    const next = pickWeighted(available(tier), rand);
    selected.push(next);
    selectedIds.add(next.id);
  }

  // v3 reads in order of the bet: the free gift, then the smaller bet, then the bigger one.
  if (v3) {
    const lead = forceTier1 ? selected.splice(0, 1) : [];
    selected.sort((a, b) => a.tier - b.tier);
    selected.unshift(...lead);
  }

  while (!v3 && selected.length < count) {
    let candidates = pool.filter((b) => !selectedIds.has(b.id));
    if (!allowTier4) candidates = candidates.filter((b) => b.tier !== 4);
    const filtered = [];
    for (const candidate of candidates) {
      const exclusionReason = violatesExclusion(candidate);
      if (exclusionReason) {
        rejectionReasons.push({ blessingId: candidate.id, reason: exclusionReason });
      } else {
        filtered.push(candidate);
      }
    }
    candidates = filtered;
    if (candidates.length === 0) break;
    const next = pickWeighted(candidates, rand);
    selected.push(next);
    selectedIds.add(next.id);
  }

  const selectedWithCosts = selected.map((blessing) => {
    const copy = cloneDeep(blessing);
    if (v3) {
      copy.rolledCost =
        copy.tier >= 2
          ? rollPriceForBlessing(valid, copy, rand, {
              difficultyId: options.difficultyId,
              isApplicable: options.isCostApplicable,
            })
          : null;
    } else if (copy.tier >= 2) {
      const tierPool = valid.costPools?.[String(copy.tier)];
      copy.rolledCost = rollCostForBlessing(tierPool, copy, rand, {
        isApplicable: options.isCostApplicable,
      });
    } else {
      copy.rolledCost = null;
    }
    return copy;
  });

  return {
    selected: selectedWithCosts,
    telemetry: {
      candidatePoolIds: pool.map((b) => b.id),
      chosenIds: selected.map((b) => b.id),
      rejectionReasons,
      options: { count, forceTier1, allowTier4 },
    },
  };
}
