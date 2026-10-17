#!/usr/bin/env node
// blessingEffectFingerprints.mjs - a differential fingerprint of the run-start blessing effects
// (RunManager._applySingleRunStartBlessingEffect and what it calls), so a refactor of that code can
// be shown to change nothing, against ANY checkout.
//
// For each case (an effect, or a short scenario, applied to a fresh seeded run) it records one
// short hash over everything the case can change:
//   - the serialized run state: the structural diff of `toJSON()` taken just before and just
//     after the case (so the base state, node map and catalogs do not matter), with random ids
//     (UUIDs) normalized and timestamps dropped;
//   - the items granted (bag, consumables, convoy, scrolls, accessories, by name);
//   - the blessing event history of the case, once as a run-start grant and once as a mid-run one;
//   - the RNG: `Math.random` is a seeded stub per case; the fingerprint holds how many draws the
//     case took, the stub's next value, and that `Math.random` was put back. The run's own seeded
//     streams show in the state diff (`rngSeed`) and in what the keyed picks chose.
// A case that throws records the message.
//
// Usage (from the repo root):
//   node tools/blessingEffectFingerprints.mjs                    print the fingerprints as JSON
//   node tools/blessingEffectFingerprints.mjs --write            write tests/fixtures/blessingEffectFingerprints.json
//   node tools/blessingEffectFingerprints.mjs --root <checkout>  fingerprint ANOTHER checkout's engine and data
//                                                                (a `git worktree add <dir> <ref>`; needs its node_modules)
//   node tools/blessingEffectFingerprints.mjs --check            compare this checkout with the fixture
// The cases live here, so the same cases run against any `--root`. The committed fixture was written
// with `--root` set to the base of the refactor (eb7cf00a, the old if-chain) and replays in
// tests/BlessingEffectFingerprints.test.js. After a deliberate behaviour change, regenerate it
// with `--write` and say why in the PR.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
export const FIXTURE_PATH = path.join(REPO, 'tests/fixtures/blessingEffectFingerprints.json');

const ID = 'fp_blessing';
const RUN_SEED = 17;

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** JSON with sorted object keys: equal values stringify equal, whatever order they were built in. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (label) => parseInt(sha(label).slice(0, 8), 16);

// ---------------------------------------------------------------------------------------------
// The cases.

const E = (type, params) => ({ type, params });

export function buildCases(_gameData) {
  const cases = [];
  const seen = new Set();
  const add = (label, effect, setup = null, options = {}) => {
    if (seen.has(label)) throw new Error(`duplicate case label: ${label}`);
    seen.add(label);
    cases.push({ label, effect, setup, ...options });
  };
  const js = (value) => JSON.stringify(value);

  // The dispatcher's own rules.
  add('dispatch: null effect', null);
  add('dispatch: no type', E(undefined, {}));
  add('dispatch: no params', { type: 'gold_delta' });
  add('dispatch: unknown type', E('no_such_effect', { value: 1 }));
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
    add(`dispatch: inherited name ${name}`, E(name, { value: 1 }));
  add('dispatch: non-string type', { type: ['gold_delta'], params: { value: 5 } });
  add('dispatch: NaN value on a known type', E('gold_delta', { value: 'abc' }));
  add('dispatch: Infinity value', E('gold_delta', { value: Infinity }));
  add('dispatch: NaN value on an unknown type', E('no_such', { value: 'abc' }));
  add('dispatch: padded type', E(' gold_delta', { value: 3 }));
  add('dispatch: cased type', E('Gold_Delta', { value: 3 }));
  add('dispatch: no value', E('gold_delta', {}));
  add('dispatch: null value', E('gold_delta', { value: null }));
  add('dispatch: string value', E('gold_delta', { value: '7' }));

  // Effects that read only `value`.
  const valueTypes = [
    'gold_delta',
    'battle_gold_multiplier_delta',
    'deploy_cap_delta',
    'xp_multiplier_delta',
    'forge_cost_discount',
    'forge_cost_multiplier',
    'forge_limit_delta',
    'shop_first_forge_free',
    'shop_price_discount',
    'recruit_level_bonus',
    'first_strike_hit_bonus',
    'healing_effectiveness_delta',
    'weapon_art_hp_cost_delta',
    'shop_item_count_delta',
    'vision_delta',
    'all_growths_delta',
    'all_act_hit_bonus',
    'extra_shop_per_act',
    'act_start_gold',
    'act_start_vision_delta',
    'eclipse_shadow_delta',
    'battle_last_stand',
    'first_kill_heal',
    'first_turn_mov_delta',
  ];
  for (const type of valueTypes)
    for (const value of [0, 1, -1, 3, 2.7, -2.7, 150])
      add(`${type} value=${value}`, E(type, { value }));

  for (const scope of ['all', 'lords', 'recruits', 'commander', 'bogus', undefined])
    for (const value of [0, 4, -3])
      add(
        `run_start_max_hp_bonus scope=${scope} value=${value}`,
        E('run_start_max_hp_bonus', { value, scope }),
      );

  for (const params of [
    { tier: 'Silver', count: 1 },
    { tier: 'Silver', count: 3 },
    { tier: 'Steel' },
    { tier: 'Iron', count: 2 },
    { tier: 'Legend', count: 1 },
    { tier: '', count: 1 },
    { tier: 'Silver', count: 0 },
    {},
  ])
    add(`starting_weapon_tier ${js(params)}`, E('starting_weapon_tier', params));

  for (const act of ['act1', 'act2', '', undefined])
    for (const stat of ['STR', 'HP', 'MOV', '', 'SPD'])
      for (const value of [2, 0, -1])
        add(
          `act_stat_delta_all_units act=${act} stat=${stat} value=${value}`,
          E('act_stat_delta_all_units', { act, stat, value }),
        );
  for (const act of ['act1', 'act2', '', undefined])
    for (const value of [2, 0, -1.5, 5])
      add(`act_hit_bonus act=${act} value=${value}`, E('act_hit_bonus', { act, value }));
  add('act_hit_bonus twice', E('act_hit_bonus', { act: 'act1', value: 3 }), (rm, apply) =>
    apply(E('act_hit_bonus', { act: 'act1', value: 2 })),
  );
  add('all_act_hit_bonus twice', E('all_act_hit_bonus', { value: 3 }), (rm, apply) =>
    apply(E('all_act_hit_bonus', { value: 2 })),
  );
  add('act_hit_bonus on a damaged table', E('act_hit_bonus', { act: 'act2', value: 3 }), (rm) => {
    rm.blessingRuntimeModifiers.actHitBonusByAct = 'broken';
  });
  add('all_act_hit_bonus on a null table', E('all_act_hit_bonus', { value: 3 }), (rm) => {
    rm.blessingRuntimeModifiers.actHitBonusByAct = null;
  });

  for (const stat of ['STR', 'DEF', 'HP', 'MOV', '', 'MAG'])
    for (const value of [2, 0, -1]) {
      add(`lord_stat_bonus stat=${stat} value=${value}`, E('lord_stat_bonus', { stat, value }));
      add(
        `all_units_stat_delta stat=${stat} value=${value}`,
        E('all_units_stat_delta', { stat, value }),
      );
    }

  for (const enabled of [true, false, undefined, 0])
    add(`skip_first_shop enabled=${enabled}`, E('skip_first_shop', { enabled }));

  for (const value of [1, 0, -2, 4.9]) {
    for (const difficulty of ['normal', 'hard'])
      add(
        `all_growths_delta value=${value} on ${difficulty}`,
        E('all_growths_delta', { value }),
        null,
        {
          difficulty,
        },
      );
  }
  for (const scope of ['all', 'lords', 'recruits', 'commander', undefined, ' LORDS ', 'bogus'])
    for (const stats of [['STR', 'SPD'], ['STR', 'STR', 'junk', 5], [], undefined, ['HP']])
      for (const value of [5, 0, -5])
        add(
          `targeted_growths_delta scope=${scope} stats=${js(stats)} value=${value}`,
          E('targeted_growths_delta', { scope, stats, value }),
        );

  for (const act of ['act1', 'act2', 'act3', 'finalBoss', 'nope', '', undefined])
    add(
      `disable_personal_skills_until_act act=${act}`,
      E('disable_personal_skills_until_act', { act }),
    );
  add(
    'disable_personal_skills: act2 then act3',
    E('disable_personal_skills_until_act', { act: 'act3' }),
    (rm, apply) => apply(E('disable_personal_skills_until_act', { act: 'act2' })),
  );
  add(
    'disable_personal_skills: act3 then act2',
    E('disable_personal_skills_until_act', { act: 'act2' }),
    (rm, apply) => apply(E('disable_personal_skills_until_act', { act: 'act3' })),
  );

  for (const name of ['Vulnerary', 'Elixir', 'Nope', '', undefined, 'Iron Sword'])
    add(`starting_consumable_all name=${name}`, E('starting_consumable_all', { name }));
  add(
    'starting_consumable_all x3 (bags fill)',
    E('starting_consumable_all', { name: 'Vulnerary' }),
    (rm, apply) => {
      apply(E('starting_consumable_all', { name: 'Vulnerary' }));
      apply(E('starting_consumable_all', { name: 'Vulnerary' }));
    },
  );
  for (const type of ['extra_consumable', 'extra_vulnerary'])
    for (const params of [
      { count: 1 },
      { count: 3 },
      { value: 2 },
      { count: 0 },
      { itemName: 'Elixir', count: 2 },
      { itemName: 'Nope', count: 2 },
      { itemName: 'Iron Sword', count: 2 },
      { itemName: 'Vulnerary', count: 7 },
      { count: 12 },
      {},
      { count: 'x', value: 4 },
    ])
      add(`${type} ${js(params)}`, E(type, params));

  for (const params of [
    { count: 1, scope: 'lords' },
    { count: 2, scope: 'lords' },
    { count: 1, scope: 'all' },
    { count: 3, scope: 'recruits' },
    { count: 0 },
    {},
    { count: 2, scope: 'bogus' },
  ])
    add(`starting_random_skill ${js(params)}`, E('starting_random_skill', params));
  for (const count of [1, 2, 3, 5, 0, undefined])
    add(`starting_whetstones count=${count}`, E('starting_whetstones', { count }));
  add('starting_whetstones with no catalog', E('starting_whetstones', { count: 2 }), (rm) => {
    rm.gameData = { ...rm.gameData, whetstones: [] };
  });
  for (const params of [
    { count: 1 },
    { count: 2 },
    { count: 1, maxUnlockAct: 'act2' },
    { count: 2, maxUnlockAct: 'act2' },
    { count: 3, maxUnlockAct: 'act2', distinct: true },
    { count: 5, maxUnlockAct: 'act1', distinct: true },
    { count: 3, minUnlockAct: 'act2', maxUnlockAct: 'act2', distinct: true },
    { count: 0 },
  ])
    add(`starting_scroll ${js(params)}`, E('starting_scroll', params));
  add('starting_scroll with no scroll catalog', E('starting_scroll', { count: 1 }), (rm) => {
    rm.gameData = {
      ...rm.gameData,
      weapons: rm.gameData.weapons.filter((w) => w.type !== 'Scroll'),
    };
  });
  add('starting_scroll with a null scroll bag', E('starting_scroll', { count: 1 }), (rm) => {
    rm.scrolls = null;
  });
  add('starting_scroll with no valid scroll', E('starting_scroll', { count: 1 }), (rm) => {
    rm.startingArtScrollPool = () => [];
  });

  for (const type of ['starting_forge_lords', 'starting_weapon_forge_delta'])
    for (const stat of ['might', 'crit', 'hit', 'weight', 'Might', 'junk', undefined])
      for (const p of [
        { count: 1, value: 1 },
        { count: 2, value: 2 },
        { count: 0, value: 0 },
        { count: 1, value: -1 },
        { count: 3, value: -2 },
      ])
        add(`${type} stat=${stat} ${js(p)}`, E(type, { stat, ...p }));
  add(
    'starting_weapon_forge_delta -1 after +2',
    E('starting_weapon_forge_delta', { value: -1, stat: 'might' }),
    (rm, apply) => apply(E('starting_weapon_forge_delta', { value: 2, stat: 'might' })),
  );
  for (const stat of ['might', 'crit', 'hit', 'weight', 'junk', undefined])
    for (const value of [1, 2, 4, 0, -1])
      add(
        `starting_best_weapon_forge stat=${stat} value=${value}`,
        E('starting_best_weapon_forge', { stat, value }),
      );

  add('act_start_gold in act2', E('act_start_gold', { value: 100 }), (rm) => {
    rm.actIndex = 1;
  });
  for (const params of [
    { itemName: 'Vulnerary', count: 1 },
    { itemName: 'Vulnerary', count: 2 },
    { itemName: 'Elixir', value: 1 },
    { itemName: 'Vulnerary' },
    { itemName: 'Nope', count: 1 },
    { itemName: 'Iron Sword', count: 1 },
    { itemName: '', count: 1 },
    { itemName: 'Vulnerary', count: 0 },
    {},
  ]) {
    add(`act_start_convoy_item ${js(params)}`, E('act_start_convoy_item', params));
    add(
      `act_start_convoy_item taken mid-run ${js(params)}`,
      E('act_start_convoy_item', params),
      (rm) => {
        rm.activeBlessings = [{ id: ID, rolledCost: null, midRun: true }];
      },
    );
    add(
      `act_start_convoy_item held from the start ${js(params)}`,
      E('act_start_convoy_item', params),
      (rm) => {
        rm.activeBlessings = [ID, { id: ` ${ID} `, rolledCost: null }];
      },
    );
  }
  add(
    'act_start_convoy_item mid-run in act2',
    E('act_start_convoy_item', { itemName: 'Vulnerary', count: 2 }),
    (rm) => {
      rm.actIndex = 1;
      rm.activeBlessings = [{ id: ID, rolledCost: null, midRun: true }];
    },
  );
  add(
    'act_start_convoy_item with a full convoy',
    E('act_start_convoy_item', { itemName: 'Vulnerary', count: 3 }),
    (rm) => {
      const template = rm.getConsumableTemplate('Vulnerary');
      while (rm.addToConvoy(template));
    },
  );

  for (const value of [5, 20, -4, 0, 500, -500])
    add(`eclipse_shadow_delta big value=${value}`, E('eclipse_shadow_delta', { value }));
  add('eclipse_shadow_delta with no eclipse', E('eclipse_shadow_delta', { value: 7 }), (rm) => {
    rm.eclipse = null;
  });
  add('eclipse_shadow_delta after shadow', E('eclipse_shadow_delta', { value: 7 }), (rm) => {
    rm.eclipse = { ...rm.eclipse, shadow: 30, actStartShadow: 10 };
  });
  add('eclipse_shadow_delta -50 after shadow', E('eclipse_shadow_delta', { value: -50 }), (rm) => {
    rm.eclipse = { ...rm.eclipse, shadow: 30, actStartShadow: 10 };
  });
  for (const value of [1, 2, 0])
    add(`extra_shop_per_act partway value=${value}`, E('extra_shop_per_act', { value }), (rm) => {
      rm.currentNodeId = rm.nodeMap?.nodes?.[0]?.id ?? null;
    });

  for (const p of [
    { defBonus: 2, avoidBonus: 10 },
    { defBonus: 0, avoidBonus: 0 },
    { defBonus: 1 },
    { avoidBonus: 5 },
    { defBonus: 'x' },
    {},
  ])
    add(`stationary_combat_bonus ${js(p)}`, E('stationary_combat_bonus', p));
  add(
    'stationary_combat_bonus twice',
    E('stationary_combat_bonus', { defBonus: 1, avoidBonus: 2 }),
    (rm, apply) => apply(E('stationary_combat_bonus', { defBonus: 2, avoidBonus: 5 })),
  );
  for (const type of ['adjacent_ally_def_bonus', 'isolated_combat_bonus']) {
    for (const p of [
      { perAlly: 2, max: 3 },
      { radius: 2, avoidBonus: 15, critBonus: 10 },
      { radius: 3, critBonus: 5 },
      { radius: 2 },
      { perAlly: 1 },
      { value: 1 },
      { value: 0 },
      { value: 'x' },
      {},
    ])
      add(`${type} ${js(p)}`, E(type, p));
    add(
      `${type} twice`,
      E(
        type,
        type === 'adjacent_ally_def_bonus' ? { perAlly: 1, max: 2 } : { radius: 1, avoidBonus: 5 },
      ),
      (rm, apply) =>
        apply(
          E(
            type,
            type === 'adjacent_ally_def_bonus'
              ? { perAlly: 2, max: 3 }
              : { radius: 2, avoidBonus: 15, critBonus: 10 },
          ),
        ),
    );
  }

  for (const p of [
    { hpCostDelta: -1, mapUsesBonus: 1 },
    { hpCostDelta: 0, mapUsesBonus: 0 },
    { hpCostDelta: -2 },
    { mapUsesBonus: 2 },
    {},
    { hpCostDelta: 5, mapUsesBonus: 5 },
  ])
    add(`player_weapon_art_boon ${js(p)}`, E('player_weapon_art_boon', p));
  add(
    'player_weapon_art_boon twice',
    E('player_weapon_art_boon', { hpCostDelta: -1, mapUsesBonus: 1 }),
    (rm, apply) => apply(E('player_weapon_art_boon', { hpCostDelta: -1, mapUsesBonus: 1 })),
  );

  for (const p of [
    { value: 1, act: 'act1' },
    { value: 2 },
    { value: -1, act: ' act2 ' },
    { value: 0, act: 'act1' },
    { value: 1, act: 5 },
    { value: 1.9, act: '' },
  ])
    add(`enemy_level_delta ${js(p)}`, E('enemy_level_delta', p));

  add('burden hunted', E('burden', { id: 'hunted', battles: 3 }));
  add(
    'burden lingering injury random stat',
    E('burden', { id: 'wounded', target: 'commander', stat: 'random', battles: 5 }),
  );
  add(
    'burden lingering injury named stat',
    E('burden', { id: 'wounded', target: 'commander', stat: 'STR', battles: 5 }),
  );
  add(
    'burden lingering injury, no commander',
    E('burden', { id: 'wounded', target: 'commander', stat: 'STR', battles: 2 }),
    (rm) => {
      rm.roster = rm.roster.filter((u) => !u.isLord);
    },
  );
  add('burden sworn enemy', E('burden', { id: 'sworn_enemy', battles: 1 }));
  add('burden debt', E('burden', { id: 'debt', owed: 1500 }));
  add('burden ill omen', E('burden', { id: 'ill_omen', battles: 2, extraShadow: 5 }));
  add('burden unknown id', E('burden', { id: 'zzz', battles: 1 }));

  add('vision_delta below zero', E('vision_delta', { value: -5 }));
  add('vision_delta from an unset count', E('vision_delta', { value: 2 }), (rm) => {
    rm.visionChargesRemaining = undefined;
  });
  for (const p of [
    { act: 'act1', value: -1 },
    { act: 'act2', value: 1 },
    { act: 'act1', value: 0 },
    { value: 1 },
    { act: 5, value: 1 },
  ])
    add(`act_deploy_cap_delta ${js(p)}`, E('act_deploy_cap_delta', p));
  add(
    'act_deploy_cap_delta twice',
    E('act_deploy_cap_delta', { act: 'act1', value: -1 }),
    (rm, apply) => apply(E('act_deploy_cap_delta', { act: 'act1', value: -1 })),
  );
  add('church_revive_disabled', E('church_revive_disabled', {}));
  add('church_revive_disabled with a value', E('church_revive_disabled', { value: 5 }));

  for (const p of [
    { stats: ['STR'], dipAct: 'act1', dip: -1, riseAct: 'act2', rise: 2 },
    { stats: ['STR', 'DEF'], dipAct: 'act2', dip: -2, riseAct: 'act3', rise: 3 },
    {
      stats: ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'],
      dipAct: 'act1',
      dip: -1,
      riseAct: 'act2',
      rise: 1,
    },
    { stats: ['STR'], dipAct: 'act_1', dip: -1, riseAct: 'act2', rise: 1 },
    { stats: [], dipAct: 'act1', dip: -1, riseAct: 'act2', rise: 1 },
    {},
  ])
    add(`lord_stat_arc ${js(p)}`, E('lord_stat_arc', p));
  for (const p of [
    { chance: 0.5, win: 2, lose: 0.3333333333333333 },
    { chance: 0.5, win: 2, lose: 0.5 },
    { chance: 2, win: 2, lose: 0.5 },
    { chance: 0.3, win: 1.5, lose: 0 },
    {},
  ])
    add(`battle_gold_gamble ${js(p)}`, E('battle_gold_gamble', p));

  // The modules beside the table: a shrine boon, the earned modifiers, an earned and a twisted boon.
  for (const [type, params] of [
    ['under_par_gold', { perTurn: 100 }],
    ['under_par_gold', {}],
    ['staff_uses_bonus', { value: 1 }],
    ['carrier_luck', {}],
    ['par_turn_delta', { value: 1 }],
    ['commander_aura', { radius: 2, hitBonus: 5, avoidBonus: 5 }],
    ['commander_aura', {}],
    ['reinforcement_delay', { value: 1 }],
    ['army_stat_bonus', { value: 1 }],
    ['army_stat_bonus', {}],
    ['master_seals_forbidden', {}],
    ['eclipse_gain_multiplier_delta', { value: 0.25 }],
  ])
    add(`beside the table: ${type} ${js(params)}`, E(type, params));
  for (const type of ['battle_last_stand', 'first_kill_heal', 'first_turn_mov_delta'])
    add(`${type} twice`, E(type, { value: 2 }), (rm, apply) => apply(E(type, { value: 1 })));

  // The catalog's own params for the cards that carry them (copied, so a retune of the catalog
  // does not move the fingerprint).
  for (const [label, effect] of [
    ['blessed_vigor', E('run_start_max_hp_bonus', { value: 4, scope: 'lords' })],
    [
      'slow_fuse',
      E('lord_stat_arc', {
        stats: ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'],
        dipAct: 'act1',
        dip: -1,
        riseAct: 'act2',
        rise: 1,
      }),
    ],
    ['gamblers_toss', E('battle_gold_gamble', { chance: 0.5, win: 2, lose: 0.3333333333333333 })],
    ['bloodless_art', E('player_weapon_art_boon', { hpCostDelta: -1, mapUsesBonus: 1 })],
    ['phalanx_rite', E('adjacent_ally_def_bonus', { perAlly: 2, max: 3 })],
    ['duelists_creed', E('isolated_combat_bonus', { radius: 2, avoidBonus: 15, critBonus: 10 })],
    ['hunted price', E('burden', { id: 'hunted', battles: 2 })],
    ['commander_injury price', E('burden', { id: 'wounded', target: 'commander', stat: 'random' })],
    ['debt_small price', E('burden', { id: 'debt', owed: 1500 })],
    ['shadow_now price', E('eclipse_shadow_delta', { value: 8 })],
  ])
    add(`card: ${label}`, effect);

  // Scenarios through the callers of the dispatcher.
  const syntheticCatalog = {
    version: 3,
    blessings: [
      {
        id: 'fp_card',
        name: 'Fingerprint Card',
        tier: 2,
        weight: 1,
        boons: [
          E('run_start_max_hp_bonus', { value: 2, scope: 'all' }),
          E('gold_delta', { value: 25 }),
        ],
        costs: [],
      },
    ],
  };
  add('chain: a held card then its rolled price', null, null, {
    act: (rm) => {
      rm.gameData = { ...rm.gameData, blessings: syntheticCatalog };
      rm.activeBlessings = [
        {
          id: 'fp_card',
          rolledCost: {
            label: 'Price',
            effects: [E('gold_delta', { value: -40 }), E('vision_delta', { value: -1 })],
          },
        },
        'no_such_card',
      ];
      rm._runStartBlessingsApplied = false;
      rm.applyRunStartBlessingEffects();
    },
  });
  add('chain: a start gift catch (stage gift)', null, null, {
    act: (rm) =>
      rm.applyStartGiftEffects('gift:fp', [
        E('burden', { id: 'hunted', battles: 3 }),
        E('eclipse_shadow_delta', { value: 15 }),
        E('vision_delta', { value: -1 }),
        E('starting_whetstones', { count: 3 }),
        E('starting_scroll', { count: 2, maxUnlockAct: 'act2', distinct: true }),
      ]),
  });
  add('chain: a blessing taken mid-run', null, null, {
    act: (rm) => {
      rm.gameData = {
        ...rm.gameData,
        blessings: {
          ...rm.gameData.blessings,
          blessings: [
            ...rm.gameData.blessings.blessings,
            {
              id: 'fp_mid',
              name: 'Fp Mid',
              tier: 1,
              weight: 1,
              boons: [E('gold_delta', { value: 10 }), E('act_start_gold', { value: 50 })],
              costs: [],
            },
          ],
        },
      };
      rm.addBlessingMidRun('fp_mid');
    },
  });

  return cases;
}

// ---------------------------------------------------------------------------------------------
// Fingerprinting.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
// Item uids carry a process-wide mint counter (utils/itemUid.js): the random part stays, the counter goes.
const ITEM_UID_COUNTER = /itm_\d+_/g;

// The run ledger (the end-of-run grade's tally of gold flows) is bookkeeping beside the effect, not
// part of what a handler decides, so it is left out of the state a fingerprint hashes.
const BOOKKEEPING_KEYS = new Set(['timestamp', 'runLedger']);

function snapshot(rm) {
  const text = JSON.stringify(rm.toJSON(), (key, value) =>
    BOOKKEEPING_KEYS.has(key) ? undefined : value,
  );
  return JSON.parse(text.replace(UUID, '<uuid>').replace(ITEM_UID_COUNTER, 'itm_#_'));
}

/** [path, newValue] for every leaf where `b` differs from `a`. */
export function diff(a, b, at = '', out = []) {
  if (canonical(a) === canonical(b)) return out;
  const bothObjects = a && b && typeof a === 'object' && typeof b === 'object';
  if (bothObjects && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) diff(a[key], b[key], `${at}/${key}`, out);
    return out;
  }
  out.push([at, b === undefined ? '<gone>' : b]);
  return out;
}

function itemNames(state) {
  const names = [];
  for (const unit of state.roster || []) {
    for (const item of unit.inventory || []) names.push(`${unit.name}:bag:${item?.name}`);
    for (const item of unit.consumables || []) names.push(`${unit.name}:use:${item?.name}`);
  }
  for (const item of state.convoy?.weapons || []) names.push(`convoy:${item?.name}`);
  for (const item of state.convoy?.consumables || []) names.push(`convoy:${item?.name}`);
  for (const item of state.scrolls || []) names.push(`scroll:${item?.name}`);
  for (const item of state.accessories || []) names.push(`accessory:${item?.name}`);
  return names;
}
function gained(before, after) {
  const left = [...itemNames(before)];
  const out = [];
  for (const name of itemNames(after)) {
    const at = left.indexOf(name);
    if (at >= 0) left.splice(at, 1);
    else out.push(name);
  }
  return out.sort();
}

function historyOf(rm) {
  return rm.blessingHistory.map((r) => ({
    stage: r.stage,
    eventType: r.eventType,
    blessingId: r.blessingId,
    effectType: r.effectType,
    details: r.details,
  }));
}

export function playCase(deps, c, stage) {
  const rand = mulberry(seedOf(c.label));
  let draws = 0;
  const stub = () => {
    draws++;
    return rand();
  };
  const original = Math.random;
  Math.random = stub;
  try {
    const rm = new deps.RunManager(deps.gameData);
    rm.startRun({
      runSeed: RUN_SEED,
      difficultyId: c.difficulty || 'dusk',
      applyBlessingsAtStart: false,
    });
    rm.blessingHistory = [];
    const apply = (effect) => rm._applySingleRunStartBlessingEffect(ID, effect);
    if (c.setup) c.setup(rm, apply);
    const before = snapshot(rm);
    draws = 0;
    rm.blessingHistory = [];
    if (stage) rm._blessingEventStage = stage;
    let error = null;
    try {
      if (c.act) c.act(rm);
      else apply(c.effect);
    } catch (e) {
      error = String(e && e.message);
    }
    const restored = Math.random === stub;
    const taken = draws;
    const next = rand();
    const after = snapshot(rm);
    return { before, after, history: historyOf(rm), error, rng: { draws: taken, next, restored } };
  } finally {
    Math.random = original;
  }
}

/**
 * Fingerprint every case. `deps` is `{ RunManager, gameData }` of the checkout under test.
 * Returns `{ [label]: "<hash> | <summary>" }`; only the hash is compared, the summary is there to
 * read when two fingerprints differ. `only(label)` limits the run to some cases.
 */
export function computeFingerprints(deps, { only = null } = {}) {
  const out = {};
  for (const c of buildCases(deps.gameData)) {
    if (only && !only(c.label)) continue;
    const run = playCase(deps, c, null);
    const mid = playCase(deps, c, 'mid_run');
    const changes = diff(run.before, run.after);
    const items = gained(run.before, run.after);
    const hash = sha(
      canonical({
        changes,
        items,
        history: run.history,
        midRunHistory: mid.history,
        midRunError: mid.error,
        error: run.error,
        rng: run.rng,
      }),
    );
    const top = [
      ...new Set(
        changes.map(([p]) =>
          p
            .split('/')
            .slice(1, 3)
            .join('.')
            .replace(/\.\d+$/, ''),
        ),
      ),
    ].slice(0, 4);
    const summary = [
      top.length
        ? `changed ${top.join(', ')}${changes.length > 4 ? ` (+${changes.length} paths)` : ''}`
        : 'no state change',
      `events ${run.history.map((h) => `${h.effectType}${h.details?.reason ? `:${h.details.reason}` : ''}`).join(',') || 'none'}`,
      items.length ? `items ${items.length}` : null,
      `draws ${run.rng.draws}`,
      run.error ? `threw ${run.error}` : null,
    ]
      .filter(Boolean)
      .join('; ')
      .slice(0, 110);
    out[c.label] = `${hash} | ${summary}`;
  }
  return out;
}

/** A hash of the game data the fingerprints depend on (the blessings catalog is left out). */
export function dataHash(gameData) {
  const { blessings: _blessings, ...rest } = gameData;
  return sha(canonical(rest));
}

export async function loadDeps(root) {
  const base = path.resolve(root);
  const { RunManager } = await import(
    pathToFileURL(path.join(base, 'src/engine/RunManager.js')).href
  );
  const { loadGameData } = await import(pathToFileURL(path.join(base, 'tests/testData.js')).href);
  return { RunManager, gameData: loadGameData() };
}

function commitOf(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function fingerprintFile(root) {
  const deps = await loadDeps(root);
  const cases = computeFingerprints(deps);
  return {
    generatedFrom: commitOf(path.resolve(root)),
    dataHash: dataHash(deps.gameData),
    caseCount: Object.keys(cases).length,
    cases,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : null;
  };
  const root = arg('--root') || REPO;
  const file = await fingerprintFile(root);
  if (args.includes('--write')) {
    const out = arg('--out') || FIXTURE_PATH;
    const lines = Object.entries(file.cases).map(
      ([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
    );
    const text = `{\n  "generatedFrom": ${JSON.stringify(file.generatedFrom)},\n  "dataHash": ${JSON.stringify(file.dataHash)},\n  "caseCount": ${file.caseCount},\n  "cases": {\n${lines.join(',\n')}\n  }\n}\n`;
    writeFileSync(out, text);
    console.log(`wrote ${file.caseCount} cases from ${file.generatedFrom} to ${out}`);
    return;
  }
  if (args.includes('--check')) {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const bad = Object.keys({ ...fixture.cases, ...file.cases }).filter(
      (k) => (fixture.cases[k] || '').split(' | ')[0] !== (file.cases[k] || '').split(' | ')[0],
    );
    for (const k of bad)
      console.log(`DIFFERS ${k}\n  fixture: ${fixture.cases[k]}\n  now:     ${file.cases[k]}`);
    console.log(
      bad.length
        ? `${bad.length} of ${file.caseCount} cases differ`
        : `all ${file.caseCount} cases match`,
    );
    process.exitCode = bad.length ? 1 : 0;
    return;
  }
  console.log(JSON.stringify(file, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
