// Simulation-only economy/loadout helpers. Production prices and saves are untouched.
import {
  BALANCE_REVISIONS,
  MetaProgressionManager,
} from '../../src/engine/MetaProgressionManager.js';
import { CATEGORY_CURRENCY } from '../../src/utils/constants.js';

export const PR161_PRICES = BALANCE_REVISIONS.find((r) => r.revision === 2);
export const UNMEASURED = {
  starting_vulnerary: 'The battle agent cannot use consumables.',
  recruit_field_supplies: 'The battle agent cannot use consumables.',
  vision_charges_2: 'The battle agent cannot rewind.',
  vision_charges_3: 'The battle agent cannot rewind.',
  iron_arms: 'The battle agent does not choose weapon arts.',
  steel_arms: 'The battle agent does not choose weapon arts.',
  art_adept: 'The battle agent does not choose weapon arts.',
  starting_reclass_seal: 'The run policy does not reclass.',
  loot_quality: 'The reward policy takes gold or skips; it does not use loot equipment.',
  studied_training: 'The reward policy does not learn scrolls.',
  trinket_collector: 'The reward policy does not equip loot accessories.',
  trade_contacts: 'The run policy does not transact with caravans.',
  commander_choice: 'A fixed starting pair does not measure selection freedom.',
  partner_choice: 'A fixed starting pair does not measure selection freedom.',
};

// Profiles are specified progression states, not estimates of a typical player.
// Every purchase obeys its prerequisites; milestone assumptions are reported.
export const PROFILES = {
  fresh: { purchases: {}, milestones: [] },
  act1: {
    purchases: { lord_hp_growth: 1, lord_str_growth: 1, lord_spd_growth: 1, weapon_forge: 1 },
    milestones: ['beatAct1'],
  },
  mid: {
    purchases: {
      lord_hp_growth: 3,
      lord_str_growth: 3,
      lord_spd_growth: 3,
      lord_def_growth: 3,
      lord_hp_flat: 1,
      lord_str_flat: 1,
      lord_spd_flat: 1,
      lord_def_flat: 1,
      recruit_hp_growth: 3,
      recruit_str_growth: 3,
      recruit_spd_growth: 3,
      recruit_def_growth: 3,
      recruit_hp_flat: 1,
      recruit_str_flat: 1,
      recruit_spd_flat: 1,
      recruit_def_flat: 1,
      extra_starting_unit_pool: 1,
      weapon_forge: 1,
      weapon_tier: 1,
      starting_gold: 1,
      unlock_guard: 1,
      unlock_miracle: 1,
    },
    milestones: ['beatAct1', 'beatAct2', 'beatAct3', 'beatGame'],
  },
  late: {
    purchases: {
      lord_hp_growth: 5,
      lord_str_growth: 5,
      lord_spd_growth: 5,
      lord_def_growth: 5,
      lord_hp_flat: 2,
      lord_str_flat: 2,
      lord_spd_flat: 2,
      lord_def_flat: 2,
      recruit_hp_growth: 5,
      recruit_str_growth: 5,
      recruit_spd_growth: 5,
      recruit_def_growth: 5,
      recruit_hp_flat: 2,
      recruit_str_flat: 2,
      recruit_spd_flat: 2,
      recruit_def_flat: 2,
      extra_starting_unit_pool: 2,
      weapon_forge: 2,
      weapon_tier: 1,
      starting_gold: 2,
      deploy_limit: 1,
      recruit_skill: 1,
      lethal_armory: 1,
      legendary_heir: 1,
      unlock_guard: 1,
      unlock_miracle: 1,
      unlock_luna: 1,
      extra_skill_slot: 1,
    },
    milestones: ['beatAct1', 'beatAct2', 'beatAct3', 'beatGame', 'beatHard'],
  },
};

// These are hypotheses about buying behavior, not an optimized recommendation.
export const BUY_ORDERS = {
  battalion: [
    'extra_starting_unit_pool',
    'deploy_limit',
    'recruit_skill',
    'lethal_armory',
    'recruit_accessory',
    'recruit_weapon_forge',
    'veteran_recruits',
    'recruit_spd_growth',
    'recruit_def_growth',
    'recruit_str_growth',
    'recruit_xp',
    'master_of_arms',
    'lethal_armory_killer',
    'lethal_armory_silver',
    'starting_gold',
    'battle_gold',
  ],
  stats: [
    'recruit_spd_growth',
    'recruit_def_growth',
    'recruit_hp_growth',
    'recruit_str_growth',
    'recruit_spd_flat',
    'recruit_def_flat',
    'extra_starting_unit_pool',
    'deploy_limit',
    'recruit_skill',
    'lethal_armory',
    'starting_gold',
    'battle_gold',
  ],
  economy: [
    'starting_gold',
    'battle_gold',
    'extra_starting_unit_pool',
    'veteran_recruits',
    'deploy_limit',
    'recruit_skill',
    'lethal_armory',
    'recruit_accessory',
    'recruit_spd_growth',
    'recruit_def_growth',
  ],
};
const VALOR_ORDER = [
  'lord_hp_growth',
  'lord_str_growth',
  'lord_spd_growth',
  'lord_def_growth',
  'weapon_forge',
  'weapon_tier',
  'unlock_guard',
  'unlock_miracle',
  'starting_accessory',
  'staff_upgrade',
  'lord_hp_flat',
  'lord_str_flat',
  'lord_spd_flat',
  'lord_def_flat',
  'unlock_luna',
  'unlock_adept',
  'extra_skill_slot',
  'weapon_tier_silver',
];

export function currencyOf(upgrade) {
  return CATEGORY_CURRENCY[upgrade.category] || 'supply';
}

export function priceSchedule(upgrades, fraction = 0.5, deployCost = 150) {
  if (
    !Number.isFinite(fraction) ||
    fraction <= 0 ||
    !Number.isInteger(deployCost) ||
    deployCost <= 0
  )
    throw new Error('Prices require a positive fraction and integer deployment cost.');
  return upgrades.map((u) => ({
    ...structuredClone(u),
    costs:
      u.id === 'deploy_limit'
        ? [deployCost]
        : PR161_PRICES.from[u.id]?.map((cost) =>
            Math.max(5, Math.round((cost * fraction) / 5) * 5),
          ) || [...u.costs],
  }));
}

// Avoid every persistence write (including run payout), without changing the real manager.
export class SimulationMeta extends MetaProgressionManager {
  _save() {
    return { ok: true };
  }
}

export function makeMeta(upgrades, loadout = PROFILES.fresh) {
  const meta = new SimulationMeta(upgrades, '__meta_balance_simulation_only__');
  meta.purchasedUpgrades = structuredClone(loadout.purchases || {});
  meta.milestones = new Set(loadout.milestones || []);
  meta.totalSupply = 0;
  meta.totalValor = 0;
  validateLoadout(meta);
  return meta;
}

export function validateLoadout(meta) {
  for (const [id, level] of Object.entries(meta.purchasedUpgrades)) {
    const u = meta.upgradesData.find((x) => x.id === id);
    if (!u || !Number.isInteger(level) || level < 0 || level > u.maxLevel)
      throw new Error(`Invalid purchase ${id}=${level}`);
    if (level > 0 && !meta.meetsPrerequisites(id)) throw new Error(`Unmet prerequisites: ${id}`);
  }
}

export function purchaseCost(upgrades, purchases) {
  const costs = { supply: 0, valor: 0 };
  for (const [id, level] of Object.entries(purchases)) {
    const u = upgrades.find((x) => x.id === id);
    if (!u) throw new Error(`Unknown upgrade: ${id}`);
    costs[currencyOf(u)] += u.costs.slice(0, level).reduce((a, b) => a + b, 0);
  }
  return costs;
}

// A token without '=N' buys the NEXT tier. '+' combines tokens into an entry bundle.
// Missing upgrade prerequisites are added and charged; milestones are never invented.
export function buildVariant(upgrades, loadout, expression) {
  const meta = makeMeta(upgrades, loadout);
  const before = purchaseCost(upgrades, meta.purchasedUpgrades);
  const visiting = new Set();
  const add = (id, level) => {
    const u = upgrades.find((x) => x.id === id);
    if (!u) throw new Error(`Unknown upgrade: ${id}`);
    if (!Number.isInteger(level) || level < 1 || level > u.maxLevel)
      throw new Error(`Invalid target tier: ${id}=${level}`);
    if ((u.requires?.milestones || []).some((m) => !meta.hasMilestone(m)))
      throw new Error(`Milestone locked: ${id}`);
    if (visiting.has(id)) throw new Error(`Cyclic prerequisite: ${id}`);
    visiting.add(id);
    for (const req of u.requires?.upgrades || [])
      if (meta.getUpgradeLevel(req.id) < req.level) add(req.id, req.level);
    visiting.delete(id);
    meta.purchasedUpgrades[id] = Math.max(meta.getUpgradeLevel(id), level);
  };
  for (const token of expression.split('+')) {
    const [id, raw, extra] = token.split('=');
    if (extra !== undefined || !id) throw new Error(`Invalid variant: ${expression}`);
    const old = meta.getUpgradeLevel(id);
    const target = raw === undefined ? old + 1 : Number(raw);
    if (target <= old) throw new Error(`Variant must increase a tier: ${token}`);
    add(id, target);
  }
  validateLoadout(meta);
  const after = purchaseCost(upgrades, meta.purchasedUpgrades);
  const changes = Object.entries(meta.purchasedUpgrades)
    .filter(([id, level]) => level !== (loadout.purchases?.[id] || 0))
    .map(([id, to]) => ({ id, from: loadout.purchases?.[id] || 0, to }));
  const gaps = changes
    .filter(({ id }) => UNMEASURED[id])
    .map(({ id }) => `${id}: ${UNMEASURED[id]}`);
  return {
    expression,
    purchases: meta.purchasedUpgrades,
    changes,
    gaps,
    costs: { supply: after.supply - before.supply, valor: after.valor - before.valor },
  };
}

export function activeEffects(meta, data, commander = 'Edric', partner = 'Sera') {
  // Fixed, reported policy: defensive skills on the healer; offensive skills on commander.
  // Every unlocked skill remains exclusive and obeys starting-slot limits.
  meta.skillAssignments = {};
  const support = new Set(['miracle', 'guard', 'renewal', 'aegis', 'pavise']);
  const priority = [
    'guard',
    'miracle',
    'luna',
    'adept',
    'sol',
    'renewal',
    'pavise',
    'aegis',
    'vantage',
    'wrath',
    'astra',
  ];
  const unlocked = meta.getUnlockedSkills();
  for (const skill of priority.filter((s) => unlocked.includes(s))) {
    const first = support.has(skill) ? partner : commander;
    if (!meta.assignSkill(first, skill))
      meta.assignSkill(first === commander ? partner : commander, skill);
  }
  return {
    ...meta.getActiveEffects({ weaponArtCatalog: data.weaponArts?.arts || [] }),
    startingLords: { commander, partner },
  };
}

export function buyBetweenRuns(meta, policy, buying = 'save') {
  if (!BUY_ORDERS[policy]) throw new Error(`Unknown purchase policy: ${policy}`);
  if (!['save', 'affordable'].includes(buying)) throw new Error(`Unknown buying mode: ${buying}`);
  const bought = [];
  // Round robin: expand a portfolio before maxing a track. Skip unaffordable/locked entries.
  // Never compares currencies against each other or spends an unearned balance.
  const order = [...BUY_ORDERS[policy], ...VALOR_ORDER];
  const purchase = (id) => {
    const cost = meta.getNextCost(id);
    if (!meta.purchaseUpgrade(id)) throw new Error(`Purchase failed: ${id}`);
    bought.push({
      id,
      level: meta.getUpgradeLevel(id),
      currency: meta.getCurrencyForUpgrade(id),
      cost,
    });
  };
  if (buying === 'save') {
    for (const currency of ['supply', 'valor']) {
      for (;;) {
        const eligible = order.filter(
          (id) =>
            meta.getCurrencyForUpgrade(id) === currency &&
            !meta.isMaxed(id) &&
            meta.meetsPrerequisites(id),
        );
        // Expand eligible tracks one tier at a time, ties by purchase policy.
        eligible.sort((a, b) => meta.getUpgradeLevel(a) - meta.getUpgradeLevel(b));
        const next = eligible[0];
        if (!next || !meta.canAfford(next)) break;
        purchase(next);
      }
    }
    return bought;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of order) {
      if (meta.isMaxed(id) || !meta.meetsPrerequisites(id) || !meta.canAfford(id)) continue;
      purchase(id);
      changed = true;
    }
  }
  return bought;
}

export function pairedStats(base, rows, key) {
  if (rows.length !== base.length || !rows.length)
    throw new Error('Nonempty paired rows required.');
  const diffs = rows.map((r, i) => {
    if (r.seed !== base[i].seed) throw new Error('Paired seed mismatch.');
    if (!Number.isFinite(r[key]) || !Number.isFinite(base[i][key]))
      throw new Error(`Invalid paired metric: ${key}`);
    return r[key] - base[i][key];
  });
  const n = diffs.length;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, n - 1);
  const se = n > 1 ? Math.sqrt(variance / n) : null;
  // Approximate normal interval; raw rows support bootstrap/discordant-pair analysis.
  return {
    n,
    mean,
    se,
    ci95: se === null ? null : [mean - 1.96 * se, mean + 1.96 * se],
    nonzeroPairs: diffs.filter((d) => d !== 0).length,
  };
}
