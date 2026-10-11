// Earned blessings from every source (docs/specs/blessings-v3.md §6.3, PR D1): the keyed ledger
// (v2), the pools each source draws from (`sources`, `acts`, `requires`, `excludes`, twists), the
// eclipsed elite's drop, an event's grant, and addBlessingMidRun's price / pact options that the
// later cards build on. Real runs on the shipped data; a patched copy of the catalog where a test
// needs a card the data does not ship yet (a twisted one, a Colosseum one).
//
// Each test names the realistic failure it catches.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  EARNED_PICK_VERSION,
  earnedPickOwed,
  earnedPoolFor,
  earnedSourceConfig,
  eliteDropDue,
  grantEarnedBlessing,
  ledgerKeyOf,
  openSanctum,
  prepareColosseumOffer,
  prepareEarnedBlessingPick,
  prepareEliteEarnedDrop,
  rollActBossEarnedOffer,
  sanitizeEarnedBlessingPicks,
  skipEarnedBlessing,
  takeEarnedBlessing,
} from '../src/engine/EarnedBlessings.js';
import { TWIST_EFFECT_TYPES, validateBlessingsConfig } from '../src/engine/BlessingEngine.js';
import { heldBlessingEntries } from '../src/ui/heldBlessingsModel.js';
import { blessingCardContent } from '../src/ui/choiceContent.js';
import { earnedPickFooter, earnedPickModel } from '../src/ui/earnedBlessingPickModel.js';
import { describeResult } from '../src/engine/EventResultWords.js';
import { chooseEventOption, completeEventBattle } from '../src/engine/EventCommands.js';
import {
  SAFE_BLESSING_BOON_TYPES,
  availableEventBlessings,
  evaluateRequires,
  findEvent,
} from '../src/engine/EventSystem.js';
import { EARNED_BOON_TYPES } from '../src/engine/EarnedBoons.js';
import { planEffects } from '../src/engine/EventEffects.js';
import { validateEventsConfig } from '../src/engine/EventValidation.js';
import { chooseEventPlan, choiceGrantsEarned, skipOwedEarnedPick } from './sim/RunPolicies.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { arriveAs, newRun } from './eventKit.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => {
  vi.restoreAllMocks();
  restoreMathRandom();
});

function freshRun(seed = 7, { difficultyId = 'normal', gameData = data } = {}) {
  const rm = new RunManager(gameData);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  rm.blessingHistory = [];
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);
const bossOf = (rm) => rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
const ids = (list) => list.map((b) => b.id);

/** A battle node of the current map turned into an eclipsed elite (as EclipseSystem leaves it). */
function eclipsedBattle(rm) {
  const node = rm.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
  node.battleParams = { ...node.battleParams, isEclipsed: true, isElite: true };
  node.eclipse = { fromType: 'battle', fellAtShadow: 5, label: 'Eclipsed battle', seen: true };
  return node;
}

/** The catalog with extra earned rows appended (validated, so a test never runs on bad data). */
function withCards(...rows) {
  const copy = structuredClone(data);
  copy.blessings.blessings.push(...rows);
  const result = validateBlessingsConfig(copy.blessings);
  if (!result.valid) throw new Error(result.errors.join('\n'));
  return copy;
}
const twisted = (id, extra = {}) => ({
  id,
  name: id,
  earned: true,
  weight: 1,
  sources: [{ kind: 'act_boss' }],
  description: `${id} boon`,
  lore: `${id} lore`,
  boons: [{ type: 'gold_delta', params: { value: 100 } }],
  costs: [],
  twist: {
    label: 'Ill Omen',
    effects: [{ type: 'burden', params: { id: 'ill_omen' } }],
  },
  ...extra,
});

// ── The keyed ledger (D-1) ─────────────────────────────────────────────────

describe('the ledger v2: one ledger, many sources, keyed', () => {
  it('an act boss keeps its bare act key; every other source files under its own key', () => {
    // Failure: an elite's drop overwrites the act boss's pick (both keyed by act), or the act
    // boss's entry changes shape and PR C's callers (keyed by act) lose it.
    const rm = freshRun(11);
    const boss = prepareEarnedBlessingPick(rm, bossOf(rm));
    const elite = eclipsedBattle(rm);
    rm.gameData = structuredClone(data);
    rm.gameData.blessings.earnedOffer.eclipsedEliteChance = 1;
    const drop = prepareEliteEarnedDrop(rm, elite);
    expect(Object.keys(rm.earnedBlessingPicks).sort()).toEqual(['act1', `elite:${elite.id}`]);
    expect(boss.key).toBeUndefined();
    expect(ledgerKeyOf(boss)).toBe('act1');
    expect(drop).toMatchObject({
      version: EARNED_PICK_VERSION,
      key: `elite:${elite.id}`,
      source: 'eclipsed_elite',
      actId: 'act1',
      nodeId: elite.id,
      status: 'owed',
    });
    expect(drop.offered).toHaveLength(1);
    expect(ledgerKeyOf(drop)).toBe(`elite:${elite.id}`);
  });

  it('a save keeps every source entry under its key; an old v1 ledger loads as it was', () => {
    // Failure: the sanitizer drops a key that is not an act id (an elite's, a sanctum's), or
    // rewrites a PR C ledger it should keep as it was.
    const v1 = {
      act1: {
        version: 1,
        source: 'act_boss',
        actId: 'act1',
        nodeId: 'act1_8_0',
        offered: ['unbroken_banner', 'ember_lantern'],
        status: 'owed',
        chosen: null,
      },
    };
    expect(sanitizeEarnedBlessingPicks(v1)).toEqual(v1);
    const known = {
      earnedIds: data.blessings.blessings.filter((b) => b.earned).map((b) => b.id),
      actSequence: ['act1', 'act2', 'act3', 'finalBoss'],
    };
    const v2 = {
      ...v1,
      'elite:act2_3_1': {
        version: 2,
        key: 'elite:act2_3_1',
        source: 'eclipsed_elite',
        actId: 'act2',
        nodeId: 'act2_3_1',
        offered: ['hollow_hourglass'],
        status: 'owed',
        chosen: null,
      },
      'sanctum:act2_4_0': {
        version: 2,
        key: 'sanctum:act2_4_0',
        source: 'sanctum',
        actId: 'act2',
        nodeId: 'act2_4_0',
        offered: ['tithe_box', 'second_dawn'],
        status: 'open',
        chosen: null,
      },
      // An entry earned in an act the run does not have is gone; so is an unknown source.
      'elite:act4_1_1': {
        version: 2,
        key: 'elite:act4_1_1',
        source: 'eclipsed_elite',
        actId: 'act4',
        offered: ['hollow_hourglass'],
        status: 'owed',
        chosen: null,
      },
      'weird:x': { source: 'pilgrimage', actId: 'act1', offered: ['tithe_box'], status: 'owed' },
    };
    const out = sanitizeEarnedBlessingPicks(v2, known);
    expect(Object.keys(out)).toEqual(['act1', 'elite:act2_3_1', 'sanctum:act2_4_0']);
    expect(out['elite:act2_3_1']).toEqual(v2['elite:act2_3_1']);
    expect(out['sanctum:act2_4_0']).toEqual(v2['sanctum:act2_4_0']);
  });

  it("an open sanctum is never owed; an owed entry of any source is, the act boss's first", () => {
    // Failure: the route map opens the take-or-skip pick for a sanctum the player only walked
    // past (it is taken at its altar), or an elite's drop hides the boss's pick.
    const rm = freshRun(12);
    rm.earnedBlessingPicks = {
      'sanctum:act1_4_0': {
        key: 'sanctum:act1_4_0',
        source: 'sanctum',
        actId: 'act1',
        offered: ['tithe_box'],
        status: 'open',
      },
    };
    expect(earnedPickOwed(rm)).toBeNull();
    rm.earnedBlessingPicks['elite:act1_2_0'] = {
      key: 'elite:act1_2_0',
      source: 'eclipsed_elite',
      actId: 'act1',
      offered: ['hollow_hourglass'],
      status: 'owed',
    };
    expect(ledgerKeyOf(earnedPickOwed(rm))).toBe('elite:act1_2_0');
    rm.earnedBlessingPicks.act1 = { actId: 'act1', offered: ['ember_lantern'], status: 'owed' };
    expect(ledgerKeyOf(earnedPickOwed(rm))).toBe('act1');
    expect(ledgerKeyOf(earnedPickOwed(rm, { sources: ['eclipsed_elite'] }))).toBe('elite:act1_2_0');
    expect(earnedPickOwed(rm, { keys: ['nope'] })).toBeNull();
  });

  it('take and skip go by ledger key; an open sanctum cannot be skipped', () => {
    // Failure: take/skip still read `actId`, so an elite's pick (act1) skips the act boss's.
    const rm = freshRun(13);
    rm.earnedBlessingPicks = {
      act1: { actId: 'act1', offered: ['ember_lantern'], status: 'owed' },
      'elite:n': {
        key: 'elite:n',
        source: 'eclipsed_elite',
        actId: 'act1',
        offered: ['hollow_hourglass'],
        status: 'owed',
      },
      'sanctum:s': {
        key: 'sanctum:s',
        source: 'sanctum',
        actId: 'act1',
        offered: ['tithe_box'],
        status: 'open',
      },
    };
    expect(skipEarnedBlessing(rm, 'elite:n').ok).toBe(true);
    expect(rm.earnedBlessingPicks.act1.status).toBe('owed');
    expect(skipEarnedBlessing(rm, 'sanctum:s').ok).toBe(false);
    expect(takeEarnedBlessing(rm, 'sanctum:s', 'tithe_box').ok).toBe(true);
    expect(rm.earnedBlessingPicks['sanctum:s']).toMatchObject({
      status: 'taken',
      chosen: 'tithe_box',
    });
    const record = rm.blessingHistory.find((r) => r.eventType === 'earned_pick');
    expect(record.details).toMatchObject({ source: 'sanctum', key: 'sanctum:s' });
  });

  it('the sims skip every owed pick by its key, an elite drop included', () => {
    // Failure: skipOwedEarnedPick skips by act and loops forever on (or leaves) an elite drop.
    const rm = freshRun(14);
    rm.earnedBlessingPicks = {
      act1: { actId: 'act1', offered: ['ember_lantern'], status: 'owed' },
      'elite:n': {
        key: 'elite:n',
        source: 'eclipsed_elite',
        actId: 'act1',
        offered: ['hollow_hourglass'],
        status: 'owed',
      },
    };
    expect(skipOwedEarnedPick(rm)).toBe(2);
    expect(Object.values(rm.earnedBlessingPicks).map((e) => e.status)).toEqual([
      'skipped',
      'skipped',
    ]);
    expect(rm.getActiveBlessingIds()).toEqual([]);
  });
});

// ── The pools (D-2, D-3) ───────────────────────────────────────────────────

describe('each source draws only its own cards', () => {
  it("Standard of the Sun is Act I's boss's and Chronicle Act II's; Second Dawn is no boss card", () => {
    // Failure: `acts` is ignored (Chronicle at the first boss), or PR C's Second Dawn is still an
    // act boss card after it moved to the eclipsed elites.
    const rm = freshRun(15);
    // PR D3's twisted cards are every act boss's (Darkened Dawn and Blood Covenant need the
    // Eclipse, which this run has).
    const twisted = ['darkened_dawn', 'blood_covenant', 'kingmakers_oath', 'hollow_sun_favor'];
    expect(ids(earnedPoolFor(rm, 'act_boss', { actId: 'act1' }))).toEqual([
      'unbroken_banner',
      'ember_lantern',
      'captains_whistle',
      'standard_of_the_sun',
      ...twisted,
    ]);
    expect(ids(earnedPoolFor(rm, 'act_boss', { actId: 'act2' }))).toEqual([
      'unbroken_banner',
      'ember_lantern',
      'captains_whistle',
      'chronicle',
      ...twisted,
    ]);
    expect(ids(earnedPoolFor(rm, 'act_boss', { actId: 'act3' }))).toEqual([
      'unbroken_banner',
      'ember_lantern',
      'captains_whistle',
      ...twisted,
    ]);
    expect(ids(earnedPoolFor(rm, 'eclipsed_elite'))).toEqual([
      'second_dawn',
      'hollow_hourglass',
      'lantern_of_the_road',
      'seers_eye',
    ]);
    expect(ids(earnedPoolFor(rm, 'sanctum'))).toEqual(['tithe_box', 'saints_reliquary']);
    expect(ids(earnedPoolFor(rm, 'colosseum'))).toEqual(['mercenary_ledger']);
    expect(ids(earnedPoolFor(rm, 'event'))).toEqual([
      'crest_of_the_road',
      'smiths_covenant',
      'thiefs_lantern',
    ]);
  });

  it('a boss in Act II never offers Standard of the Sun over 300 seeds; in Act I it does', () => {
    // Failure: the roll reads the act's pool from the wrong act (the act the run started in).
    const rm = freshRun(16);
    const seen = { act1: new Set(), act2: new Set() };
    for (let seed = 1; seed <= 300; seed++) {
      rm.runSeed = seed;
      for (const [index, act] of [
        [0, 'act1'],
        [1, 'act2'],
      ]) {
        rm.actIndex = index;
        for (const id of rollActBossEarnedOffer(rm).offered) seen[act].add(id);
      }
    }
    expect(seen.act1.has('standard_of_the_sun')).toBe(true);
    expect(seen.act1.has('chronicle')).toBe(false);
    expect(seen.act2.has('chronicle')).toBe(true);
    expect(seen.act2.has('standard_of_the_sun')).toBe(false);
    for (const set of Object.values(seen)) expect(set.has('second_dawn')).toBe(false);
  });

  it('`requires.eclipse` and `excludes` keep a card out of every pool', () => {
    // Failure: a card that needs the Eclipse is offered with it off, or a card excluded by (or
    // excluding) a held blessing is offered beside it.
    const gameData = withCards(
      twisted('dark_card', { requires: { eclipse: true } }),
      twisted('sworn_card', { excludes: ['ember_lantern'] }),
    );
    const rm = freshRun(17, { gameData });
    rm.eclipse = { ...rm.eclipse, enabled: false };
    vi.spyOn(rm, 'isEclipseActive').mockReturnValue(false);
    expect(ids(earnedPoolFor(rm, 'act_boss'))).not.toContain('dark_card');
    rm.isEclipseActive.mockReturnValue(true);
    expect(ids(earnedPoolFor(rm, 'act_boss'))).toContain('dark_card');
    expect(ids(earnedPoolFor(rm, 'act_boss'))).toContain('sworn_card');
    rm.addBlessingMidRun('ember_lantern', { earned: true });
    expect(ids(earnedPoolFor(rm, 'act_boss'))).not.toContain('sworn_card');
    // Either way: a held card that names the candidate in its own excludes.
    const back = freshRun(17, { gameData });
    back.gameData.blessings.blessings.find((b) => b.id === 'ember_lantern').excludes = [
      'standard_of_the_sun',
    ];
    back.addBlessingMidRun('ember_lantern', { earned: true });
    expect(ids(earnedPoolFor(back, 'act_boss'))).not.toContain('standard_of_the_sun');
  });

  it('a pair holds at most one twisted card, and a twisted card never drops from an elite', () => {
    // Failure: an act boss offers "two curses", or a twisted card reaches a source that has no
    // room for its warning (an elite's one-card drop, the sanctum).
    const heavy = (id) => twisted(id, { weight: 50 });
    const gameData = withCards(heavy('curse_a'), heavy('curse_b'), heavy('curse_c'));
    const rm = freshRun(18, { gameData });
    let pairs = 0;
    for (let seed = 1; seed <= 400; seed++) {
      rm.runSeed = seed;
      const roll = rollActBossEarnedOffer(rm);
      if (roll.status !== 'owed') continue;
      pairs++;
      expect(roll.offered.filter((id) => id.startsWith('curse_')).length).toBeLessThanOrEqual(1);
    }
    expect(pairs).toBe(400);
    expect(ids(earnedPoolFor(rm, 'eclipsed_elite')).some((id) => id.startsWith('curse_'))).toBe(
      false,
    );
    expect(ids(earnedPoolFor(rm, 'sanctum')).some((id) => id.startsWith('curse_'))).toBe(false);
  });
});

// ── The validator (D-2) ────────────────────────────────────────────────────

describe('the validator reads the earned fields', () => {
  const errorsOf = (patch) => {
    const copy = structuredClone(data.blessings);
    patch(copy, (id) => copy.blessings.find((b) => b.id === id));
    return validateBlessingsConfig(copy).errors.join('\n');
  };

  it('the shipped catalog names a source on every earned card', () => {
    expect(validateBlessingsConfig(data.blessings).errors).toEqual([]);
    for (const b of data.blessings.blessings.filter((x) => x.earned))
      expect(b.sources?.length, b.id).toBeGreaterThan(0);
  });

  it.each([
    ['no sources', (row) => delete row('tithe_box').sources, /sources must name where/],
    ['empty sources', (row) => (row('tithe_box').sources = []), /sources must name where/],
    ['an unknown kind', (row) => (row('tithe_box').sources = [{ kind: 'shrine' }]), /kind must be/],
    [
      'a kind twice',
      (row) => (row('tithe_box').sources = [{ kind: 'sanctum' }, { kind: 'sanctum' }]),
      /named twice/,
    ],
    [
      'an unknown act',
      (row) => (row('chronicle').sources = [{ kind: 'act_boss', acts: ['act9'] }]),
      /acts must list/,
    ],
    [
      'a stray field',
      (row) => (row('chronicle').sources = [{ kind: 'act_boss', when: 'dusk' }]),
      /not a source field/,
    ],
    [
      'sources on a shrine card',
      (row) => (row('steady_hands').sources = [{ kind: 'act_boss' }]),
      /sources is only allowed on an earned/,
    ],
    [
      'a twist on a card an elite drops',
      (row) =>
        (row('hollow_hourglass').twist = {
          label: 'x',
          effects: [{ type: 'burden', params: { id: 'ill_omen' } }],
        }),
      /offered by an act boss only/,
    ],
    [
      'a twist effect no price has',
      (row) =>
        (row('ember_lantern').twist = {
          label: 'x',
          effects: [{ type: 'no_such_twist', params: {} }],
        }),
      /is not a twist effect/,
    ],
    ...[
      ['act_stat_delta_all_units', { act: 'act1', stat: 'DEF', value: -1 }],
      ['act_deploy_cap_delta', { act: 'act1', value: -1 }],
      ['act_hit_bonus', { act: 'act1', value: -8 }],
      ['disable_personal_skills_until_act', { act: 'act3' }],
    ].map(([type, params]) => [
      `a twist that is a price fixed to an act (${type})`,
      (row) => (row('ember_lantern').twist = { label: 'x', effects: [{ type, params }] }),
      /is not a twist effect/,
    ]),
    [
      'an unknown requirement',
      (row) => (row('ember_lantern').requires = { moon: true }),
      /not a known requirement/,
    ],
    [
      'a twist on a shrine card',
      (row) => (row('steady_hands').twist = { label: 'x', effects: [] }),
      /twist is only allowed/,
    ],
  ])('refuses %s', (_name, patch, message) => {
    // Failure: a card that can never be won (no source), a twisted card at a source with no
    // warning, or a typo in a kind ships as valid data.
    expect(errorsOf((_copy, row) => patch(row))).toMatch(message);
  });

  it('a twist may carry the run-wide prices on the whitelist (shadow, a burden, Vision...)', () => {
    // Failure: the whitelist is so tight the twisted cards D3 ships (shadow now, a burden) are
    // refused, or it is no list at all (every price passes, act-fixed ones included).
    for (const effects of [
      [{ type: 'eclipse_shadow_delta', params: { value: 8 } }],
      [{ type: 'burden', params: { id: 'ill_omen' } }],
      [{ type: 'vision_delta', params: { value: -1 } }],
      [{ type: 'xp_multiplier_delta', params: { value: -0.1 } }],
    ])
      expect(
        errorsOf((_copy, row) => (row('ember_lantern').twist = { label: 'x', effects })),
        effects[0].type,
      ).toBe('');
    expect([...TWIST_EFFECT_TYPES].sort()).toEqual(
      [
        'burden',
        'eclipse_shadow_delta',
        'forge_cost_multiplier',
        'shop_price_discount',
        'vision_delta',
        'xp_multiplier_delta',
        // PR D3's own twist types (engine/TwistedBoons.js).
        'eclipse_gain_multiplier_delta',
        'master_seals_forbidden',
      ].sort(),
    );
  });

  it.each([
    ['commander_aura', 'standard_of_the_sun', (p) => (p.radius = 0)],
    [
      'commander_aura (does nothing)',
      'standard_of_the_sun',
      (p) => ((p.hitBonus = 0), (p.avoidBonus = 0)),
    ],
    ['reinforcement_delay', 'hollow_hourglass', (p) => (p.value = 1.5)],
    ['xp_per_act_cleared', 'chronicle', (p) => (p.value = 0)],
    ['xp_per_act_cleared (above 1)', 'chronicle', (p) => (p.value = 5)],
    ['church_entry_gold', 'tithe_box', (p) => (p.value = -200)],
    ['fog_opening_reveal', 'lantern_of_the_road', (p) => delete p.radius],
    ['recruit_mark_chance', 'crest_of_the_road', (p) => (p.value = 2)],
    // PR D2's boons (the first boon of each card).
    ['staff_heal_range_bonus', 'saints_reliquary', (p) => (p.heal = -5)],
    [
      'staff_heal_range_bonus (does nothing)',
      'saints_reliquary',
      (p) => ((p.heal = 0), (p.range = 0)),
    ],
    ['staff_heal_range_bonus (range too long)', 'saints_reliquary', (p) => (p.range = 9)],
    ['arena_terms (a fee share of 0)', 'mercenary_ledger', (p) => (p.feeMultiplier = 0)],
    ['arena_terms (a percentage)', 'mercenary_ledger', (p) => (p.feeMultiplier = 50)],
    [
      'arena_terms (does nothing)',
      'mercenary_ledger',
      (p) => ((p.feeMultiplier = 1), (p.visitBouts = 0)),
    ],
    ['route_scout', 'thiefs_lantern', (p) => (p.level = 'everything')],
    ['route_scout (no level)', 'seers_eye', (p) => delete p.level],
  ])('refuses a malformed %s boon (its handler would skip it)', (_type, id, patch) => {
    // Failure: a card that does nothing ships as valid (its handler skips malformed params).
    expect(errorsOf((_copy, row) => patch(row(id).boons[0].params))).not.toBe('');
  });
});

// ── addBlessingMidRun's options (D1 infrastructure) ────────────────────────

describe('addBlessingMidRun takes a price, waives a pact for a gift, and refuses the rest', () => {
  const price = {
    label: 'Ill Omen',
    effects: [{ type: 'burden', params: { id: 'ill_omen' } }],
    kind: 'twist',
  };

  it("a twist is applied after the boons and held as the entry's price, across a save", () => {
    // Failure: the twist is never charged, charged twice on a load, or lost from the held list.
    const rm = freshRun(20);
    const gold = rm.gold;
    expect(rm.addBlessingMidRun('ember_lantern', { earned: true, price })).toBe(true);
    expect(rm.burdens.map((b) => b.id)).toEqual(['ill_omen']);
    const entry = rm.activeBlessings.find((b) => b.id === 'ember_lantern');
    expect(entry).toEqual({ id: 'ember_lantern', rolledCost: { ...price }, midRun: true });
    const back = roundTrip(rm);
    expect(back.activeBlessings).toEqual(rm.activeBlessings);
    expect(back.burdens).toHaveLength(1);
    expect(back.gold).toBe(gold);
    const held = heldBlessingEntries(back).find((e) => e.id === 'ember_lantern');
    expect(held).toMatchObject({ price: 'Ill Omen', priceKind: 'Twist' });
  });

  it('a gift catch reads Catch; a mid-run entry never keeps any other price', () => {
    // Failure: an old save's display-only price on a church blessing comes back as a charge.
    const rm = freshRun(21);
    expect(
      rm.addBlessingMidRun('ember_lantern', { earned: true, price: { ...price, kind: 'gift' } }),
    ).toBe(true);
    expect(heldBlessingEntries(rm)[0]).toMatchObject({ priceKind: 'Catch', price: 'Ill Omen' });
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.activeBlessings.push({
      id: 'steady_hands',
      midRun: true,
      rolledCost: {
        label: 'Debt: 300 gold',
        effects: [{ type: 'burden', params: { id: 'debt' } }],
      },
    });
    const back = RunManager.fromJSON(saved, data);
    expect(back.activeBlessings.find((b) => b.id === 'steady_hands').rolledCost).toBeNull();
  });

  it('refuses a price that is not a twist or a gift, and a malformed one, changing nothing', () => {
    // Failure: a caller hands out a card with a shrine price or a pact sneaked in as `price`.
    const rm = freshRun(22);
    for (const bad of [
      { ...price, kind: 'pact' },
      { ...price, kind: undefined },
      { label: '', effects: price.effects, kind: 'twist' },
      { label: 'x', effects: [], kind: 'twist' },
    ])
      expect(rm.addBlessingMidRun('ember_lantern', { earned: true, price: bad })).toBe(false);
    expect(rm.activeBlessings).toEqual([]);
    expect(rm.burdens).toEqual([]);
  });

  it('a pact card is refused, unless a gift waives its pact (then nothing is charged)', () => {
    // Failure: a church or an event hands out a tier IV card without its pact, or a gift's waiver
    // still charges the pact.
    const rm = freshRun(23);
    const pactCard = data.blessings.blessings.find((b) => Array.isArray(b.pact));
    expect(rm.addBlessingMidRun(pactCard.id)).toBe(false);
    expect(rm.addBlessingMidRun(pactCard.id, { waivePact: true })).toBe(false);
    expect(rm.addBlessingMidRun(pactCard.id, { waivePact: true, source: 'event' })).toBe(false);
    const burdens = rm.burdens.length;
    expect(rm.addBlessingMidRun(pactCard.id, { waivePact: true, source: 'gift' })).toBe(true);
    expect(rm.activeBlessings.at(-1)).toEqual({ id: pactCard.id, rolledCost: null, midRun: true });
    expect(rm.burdens.length).toBe(burdens);
    // An intrinsic price is the boon itself: never waived.
    const intrinsic = data.blessings.blessings.find((b) => b.intrinsicPrice);
    expect(rm.addBlessingMidRun(intrinsic.id, { waivePact: true, source: 'gift' })).toBe(false);
  });

  it('taking a twisted card from a pick charges its twist; the card shows it as its Twist', () => {
    // Failure: the take path calls addBlessingMidRun without the twist (a free curse-less card).
    const gameData = withCards(twisted('curse_a', { weight: 1000 }));
    const rm = freshRun(24, { gameData });
    rm.earnedBlessingPicks = {
      act1: {
        actId: 'act1',
        source: 'act_boss',
        offered: ['curse_a', 'ember_lantern'],
        status: 'owed',
      },
    };
    expect(takeEarnedBlessing(rm, 'act1', 'curse_a').ok).toBe(true);
    expect(rm.burdens.map((b) => b.id)).toEqual(['ill_omen']);
    expect(rm.activeBlessings[0].rolledCost).toMatchObject({ kind: 'twist', label: 'Ill Omen' });
    const card = blessingCardContent(gameData.blessings.blessings.find((b) => b.id === 'curse_a'));
    expect(card).toMatchObject({ cost: 'Ill Omen', costLabel: 'Twist', earned: true });
  });
});

// ── The eclipsed elite's drop (D-4, D-7) ───────────────────────────────────

describe("an eclipsed elite's drop", () => {
  it('is due on an eclipsed battle only: never a plain elite, a Dark Omen fight or the prologue', () => {
    // Failure: every elite (or a Dark Omen's event fight) drops an earned blessing.
    const rm = freshRun(30);
    const plain = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    expect(eliteDropDue(rm, plain)).toBe(false);
    expect(
      eliteDropDue(rm, { ...plain, battleParams: { ...plain.battleParams, isElite: true } }),
    ).toBe(false);
    const omen = {
      ...plain,
      type: 'event',
      eventBattle: true,
      darkOmen: true,
      battleParams: { ...plain.battleParams, isEclipsed: true },
    };
    expect(eliteDropDue(rm, omen)).toBe(false);
    expect(eliteDropDue(rm, eclipsedBattle(rm))).toBe(true);
    const prologue = new RunManager(data);
    prologue.startPrologue(data);
    const chapter = prologue.nodeMap.nodes.find((n) => n.type === 'battle');
    chapter.battleParams = { ...chapter.battleParams, isEclipsed: true };
    expect(eliteDropDue(prologue, chapter)).toBe(false);
  });

  it('completeBattle rolls it with the victory, on its own stream: no other stream moves', () => {
    // Failure: the drop draws from Math.random (the battle stream) or changes the node map, so a
    // seed's run differs from turn one once an elite is won.
    const run = (chance) => {
      const gameData = structuredClone(data);
      gameData.blessings.earnedOffer.eclipsedEliteChance = chance;
      const rm = freshRun(31, { gameData });
      const node = eclipsedBattle(rm);
      rm.currentNodeId = node.id;
      installSeed(4242);
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 5, turnPar: 7 });
      const cursor = [Math.random(), Math.random()];
      restoreMathRandom();
      return { rm, node, cursor };
    };
    const hit = run(1);
    const miss = run(0);
    expect(hit.rm.earnedBlessingPicks[`elite:${hit.node.id}`].status).toBe('owed');
    expect(miss.rm.earnedBlessingPicks[`elite:${miss.node.id}`].status).toBe('none');
    expect(hit.cursor).toEqual(miss.cursor);
    expect(JSON.stringify(hit.rm.nodeMap)).toBe(JSON.stringify(miss.rm.nodeMap));
    const rm = freshRun(32);
    const node = eclipsedBattle(rm);
    const spy = vi.spyOn(Math, 'random');
    prepareEliteEarnedDrop(rm, node);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a reload offers the same card, and the drop is never rolled twice', () => {
    // Failure: a refresh between the victory and the pick re-rolls the drop (save-scumming).
    for (let seed = 40; seed < 80; seed++) {
      const rm = freshRun(seed);
      const node = eclipsedBattle(rm);
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 5, turnPar: 7 });
      const entry = rm.earnedBlessingPicks[`elite:${node.id}`];
      const back = roundTrip(rm);
      expect(back.earnedBlessingPicks[`elite:${node.id}`]).toEqual(entry);
      back.addBlessingMidRun('lantern_of_the_road', { earned: true });
      expect(
        prepareEliteEarnedDrop(
          back,
          back.nodeMap.nodes.find((n) => n.id === node.id),
        ),
      ).toEqual(entry);
    }
  });

  it('drops about a third of the time (10,000 seeds), never a held card', () => {
    // Failure: the odds drift (the boss's snowball odds, or a chance read as a percentage), or a
    // held card drops (a pick of nothing).
    const rm = freshRun(33);
    const node = eclipsedBattle(rm);
    rm.addBlessingMidRun('second_dawn', { earned: true });
    let owed = 0;
    const N = 10000;
    for (let seed = 1; seed <= N; seed++) {
      rm.runSeed = seed;
      rm.earnedBlessingPicks = {};
      const entry = prepareEliteEarnedDrop(rm, node);
      if (entry.status !== 'owed') continue;
      owed++;
      expect(['hollow_hourglass', 'lantern_of_the_road', 'seers_eye']).toContain(entry.offered[0]);
    }
    expect(owed / N).toBeGreaterThan(0.31);
    expect(owed / N).toBeLessThan(0.36);
    expect(earnedSourceConfig(data.blessings).eclipsedEliteChance).toBe(0.3333);
  });

  it('two eclipsed elites in one act roll apart (the stream is keyed by the node), each one fixed', () => {
    // Failure: the drop's stream is keyed by the act or the seed alone, so every eclipsed elite
    // of an act rolls the same (all drop the same card, or none does).
    const rm = freshRun(37);
    const elite = (id) => ({
      id,
      type: 'battle',
      battleParams: { isEclipsed: true, isElite: true },
    });
    const ids = Array.from({ length: 16 }, (_, i) => `act1_${3 + (i % 5)}_${i % 4}`).filter(
      (id, i, all) => all.indexOf(id) === i,
    );
    const roll = (id) => {
      rm.earnedBlessingPicks = {};
      const entry = prepareEliteEarnedDrop(rm, elite(id));
      return `${entry.status}:${entry.offered.join(',')}`;
    };
    const outcomes = ids.map(roll);
    expect(new Set(outcomes).size).toBeGreaterThan(1);
    expect(outcomes.some((o) => o.startsWith('owed'))).toBe(true);
    expect(outcomes.some((o) => o.startsWith('none'))).toBe(true);
    // Each node's roll is its own and the same every time; both live on one ledger together.
    expect(ids.map(roll)).toEqual(outcomes);
    rm.earnedBlessingPicks = {};
    for (const id of ids) prepareEliteEarnedDrop(rm, elite(id));
    expect(
      ids.map((id) => {
        const entry = rm.earnedBlessingPicks[`elite:${id}`];
        return `${entry.status}:${entry.offered.join(',')}`;
      }),
    ).toEqual(outcomes);
  });

  it('with every elite card held, a hit drops nothing ("none", never an empty pick)', () => {
    const rm = freshRun(34);
    for (const id of ['second_dawn', 'hollow_hourglass', 'lantern_of_the_road', 'seers_eye'])
      rm.addBlessingMidRun(id, { earned: true });
    for (let seed = 1; seed <= 50; seed++) {
      rm.runSeed = seed;
      rm.earnedBlessingPicks = {};
      expect(prepareEliteEarnedDrop(rm, eclipsedBattle(rm)).status).toBe('none');
    }
  });

  it("the pick says where it came from and asks to leave one card, not 'both'", () => {
    // Failure: a one-card drop reads "the act's boss" and "leave them both".
    const rm = freshRun(35);
    rm.earnedBlessingPicks = {
      'elite:n': {
        key: 'elite:n',
        source: 'eclipsed_elite',
        actId: 'act1',
        offered: ['hollow_hourglass'],
        status: 'owed',
      },
    };
    const model = earnedPickModel(rm);
    expect(model.cards.map((c) => c.id)).toEqual(['hollow_hourglass']);
    expect(model.key).toBe('elite:n');
    expect(earnedPickFooter(model).text).toBe('Won from an eclipsed elite. Take it, or leave it.');
  });
});

// ── The Colosseum (D-8; its card, the Mercenary Ledger, is PR D2's) ─────────

describe("the Colosseum's offer", () => {
  it("files 'none' when no Colosseum card is left (never rolled again, never owed), and once a run", () => {
    // Failure: an offer of nothing is filed as owed (a pick the menu cannot show), or nothing is
    // filed, so every later win rolls the offer again. The run already holds the one Colosseum
    // card (the Mercenary Ledger), so none is left.
    const rm = freshRun(36);
    expect(rm.addBlessingMidRun('mercenary_ledger', { earned: true })).toBe(true);
    const none = prepareColosseumOffer(rm, 'arena');
    expect(none).toMatchObject({
      key: 'colosseum',
      source: 'colosseum',
      status: 'none',
      offered: [],
    });
    expect(rm.earnedBlessingPicks.colosseum).toBe(none);
    expect(prepareColosseumOffer(rm, 'arena2')).toBe(none);
    expect(earnedPickOwed(rm)).toBeNull();
    expect(roundTrip(rm).earnedBlessingPicks.colosseum).toMatchObject({ status: 'none' });
    const gameData = withCards({
      ...twisted('ledger_card'),
      twist: undefined,
      sources: [{ kind: 'colosseum' }],
    });
    const withCard = freshRun(36, { gameData });
    expect(withCard.addBlessingMidRun('mercenary_ledger', { earned: true })).toBe(true);
    const entry = prepareColosseumOffer(withCard, 'arena');
    expect(entry).toMatchObject({ key: 'colosseum', source: 'colosseum', status: 'owed' });
    expect(entry.offered).toEqual(['ledger_card']);
    expect(prepareColosseumOffer(withCard, 'arena2')).toBe(entry);
  });
});

// ── An event's grant (D-9) ─────────────────────────────────────────────────

describe("an event's earned blessing", () => {
  const rideAndWin = (run) => {
    const node = arriveAs(run, 'old_faces');
    const chosen = chooseEventOption(run, node.id, 'ride');
    expect(chosen.ok, chosen.reason).toBe(true);
    run.completeBattle(run.getRoster(), node.id, 0, { turnCount: 5, turnPar: 5 });
    return { node, done: completeEventBattle(run, node.id) };
  };

  it("Old Faces' ride grants Crest of the Road once its fight is won, and the band says so", () => {
    // Failure: the grant is lost (the effect is unknown to the planner), or applied without a
    // ledger record (a later event grants it again), or the result line is blank.
    const run = newRun({ seed: 301 });
    const { node, done } = rideAndWin(run);
    expect(done.ok, done.reason).toBe(true);
    expect(run.getActiveBlessingIds()).toContain('crest_of_the_road');
    expect(run.earnedBlessingPicks[`event:${node.id}`]).toMatchObject({
      source: 'event',
      status: 'taken',
      chosen: 'crest_of_the_road',
    });
    const record = done.results.find((r) => r.kind === 'earnedBlessing');
    expect(record).toMatchObject({ id: 'crest_of_the_road', name: 'Crest of the Road' });
    expect(describeResult(record, data)).toMatchObject({
      tone: 'good',
      text: 'Earned blessing: Crest of the Road',
    });
    // Saved with the run.
    expect(roundTrip(run).getActiveBlessingIds()).toContain('crest_of_the_road');
  });

  it('held already, the spoils skip it with a note: the fight keeps its other rewards', () => {
    // Failure: the grant throws after a won fight (the spoils fail and the gold is lost).
    const run = newRun({ seed: 302 });
    grantEarnedBlessing(run, 'crest_of_the_road', { source: 'event', key: 'event:elsewhere' });
    const gold = run.gold;
    const { done } = rideAndWin(run);
    expect(done.ok, done.reason).toBe(true);
    expect(run.gold).toBeGreaterThan(gold);
    expect(done.results.find((r) => r.kind === 'note' && r.of === 'earnedBlessing')).toBeTruthy();
    expect(run.getActiveBlessingIds().filter((id) => id === 'crest_of_the_road')).toHaveLength(1);
  });

  it('a spoils step that throws after the grant rolls the grant back whole; Try again grants it', () => {
    // Failure: the rollback restores the blessings but not the ledger (earnedBlessingPicks left
    // out of EventEffects.RUN_FIELDS), so the ledger says "taken" for a card the run does not
    // hold: Try again finds it "already given here", skips it, and the card is lost for good.
    const run = newRun({ seed: 307 });
    const node = arriveAs(run, 'old_faces');
    expect(chooseEventOption(run, node.id, 'ride').ok).toBe(true);
    run.completeBattle(run.getRoster(), node.id, 0, { turnCount: 5, turnPar: 5 });
    // A step after the grant that fails as it is applied.
    run.eventStateByNodeId[node.id].afterVictory.push({ type: 'gold', value: 7 });
    const addGold = run.addGold.bind(run);
    let fail = true;
    run.addGold = (value) => {
      if (fail && value === 7) throw new Error('the purse tore');
      return addGold(value);
    };
    const gold = run.gold;
    const failed = completeEventBattle(run, node.id);
    expect(failed.ok).toBe(false);
    expect(run.getActiveBlessingIds()).not.toContain('crest_of_the_road');
    expect(run.earnedBlessingPicks[`event:${node.id}`]).toBeUndefined();
    expect(run.blessingRuntimeModifiers.recruitMarkChance || 0).toBe(0);
    expect(run.gold).toBe(gold);
    fail = false;
    const retried = completeEventBattle(run, node.id);
    expect(retried.ok, retried.reason).toBe(true);
    expect(run.getActiveBlessingIds()).toContain('crest_of_the_road');
    expect(run.earnedBlessingPicks[`event:${node.id}`]).toMatchObject({ status: 'taken' });
    expect(retried.results.some((r) => r.kind === 'earnedBlessing')).toBe(true);
  });

  it('a grant files under its node\'s event key when no key is named, and never under "undefined"', () => {
    // Failure: a caller that names no key files the entry under "undefined" (a key the sanitizer
    // keeps, and that every later keyless grant would collide with).
    const run = newRun({ seed: 308 });
    const granted = grantEarnedBlessing(run, 'crest_of_the_road', {
      source: 'event',
      nodeId: 'act1_3_1',
    });
    expect(granted.ok, granted.reason).toBe(true);
    expect(Object.keys(run.earnedBlessingPicks)).toEqual(['event:act1_3_1']);
    expect(run.earnedBlessingPicks['event:act1_3_1']).toMatchObject({ key: 'event:act1_3_1' });
    const keyless = newRun({ seed: 309 });
    expect(grantEarnedBlessing(keyless, 'crest_of_the_road', { source: 'event' })).toMatchObject({
      ok: false,
    });
    expect(Object.keys(keyless.earnedBlessingPicks || {})).toEqual([]);
    expect(keyless.getActiveBlessingIds()).not.toContain('crest_of_the_road');
  });

  it("a choice's own grant of a held card is refused, and twice in one plan is refused", () => {
    // Failure: the event grants a held card twice (two entries, the boon doubled).
    const run = newRun({ seed: 303 });
    const ctx = { run, catalog: run.gameData.events, nodeId: 'n1', phase: 'o' };
    const twice = planEffects(ctx, [
      { type: 'earnedBlessing', id: 'crest_of_the_road' },
      { type: 'earnedBlessing', id: 'crest_of_the_road' },
    ]);
    expect(twice).toMatchObject({ ok: false, reason: 'You already carry it.' });
    grantEarnedBlessing(run, 'crest_of_the_road', { source: 'event', key: 'event:n0' });
    expect(planEffects(ctx, [{ type: 'earnedBlessing', id: 'crest_of_the_road' }])).toMatchObject({
      ok: false,
      reason: 'You already carry it.',
    });
    // A card that is no event's to give is refused even when not held.
    expect(planEffects(ctx, [{ type: 'earnedBlessing', id: 'tithe_box' }]).ok).toBe(false);
    expect(grantEarnedBlessing(run, 'steady_hands', { key: 'event:n2' }).ok).toBe(false);
  });

  it("no earned boon is on the event's mid-run-safe list: an event's `blessing` never hands one out", () => {
    // Failure: a new earned boon type is added to SAFE_BLESSING_BOON_TYPES, and an event's tiered
    // `blessing` effect starts handing out earned cards without their source.
    for (const type of EARNED_BOON_TYPES) expect(SAFE_BLESSING_BOON_TYPES).not.toContain(type);
    const run = newRun({ seed: 306 });
    for (const tier of [1, 2, 3, 4])
      for (const b of availableEventBlessings(run, tier)) expect(b.earned).not.toBe(true);
  });

  it('`earnedAvailable` greys a choice once the card is held', () => {
    // Failure: a choice whose reward is held stays open (and pays nothing).
    const run = newRun({ seed: 304 });
    expect(evaluateRequires(run, { earnedAvailable: 'crest_of_the_road' })).toBe('');
    grantEarnedBlessing(run, 'crest_of_the_road', { source: 'event', key: 'event:n0' });
    expect(evaluateRequires(run, { earnedAvailable: 'crest_of_the_road' })).toBe(
      'You already carry it.',
    );
  });

  it('the validator refuses an id that is not an earned card an event can give', () => {
    // Failure: an event names a shrine card or a sanctum card (never won from events) as earned.
    const base = { ...data };
    const withEffect = (id, where = 'effect') => {
      const events = structuredClone(data.events);
      const ride = findEvent(events, 'old_faces').choices.find((c) => c.id === 'ride');
      if (where === 'effect')
        ride.outcomes[0].effects[0].afterVictory.push({ type: 'earnedBlessing', id });
      else ride.requires = { earnedAvailable: id };
      return validateEventsConfig(events, base).errors.join('\n');
    };
    expect(validateEventsConfig(data.events, base).errors).toEqual([]);
    for (const id of ['steady_hands', 'tithe_box', 'nope'])
      expect(withEffect(id), id).toMatch(/not an earned blessing an event can give/);
    expect(withEffect('tithe_box', 'requires')).toMatch(/not an earned blessing an event can give/);
    expect(withEffect('crest_of_the_road', 'requires')).toBe('');
  });

  it("a choice's own grant needs `requires.earnedAvailable` naming its card; spoils do not", () => {
    // Failure: a choice grants a card strictly (a refusal once it is held) with nothing greying
    // it, so a player who holds the card picks a choice that can only fail.
    const strict = (requires) => {
      const events = structuredClone(data.events);
      const choice = findEvent(events, 'old_faces').choices.find((c) => c.id === 'coin');
      choice.outcomes[0].effects.push({ type: 'earnedBlessing', id: 'crest_of_the_road' });
      if (requires) choice.requires = { ...(choice.requires || {}), ...requires };
      return validateEventsConfig(events, { ...data }).errors.join('\n');
    };
    expect(strict(null)).toMatch(/needs the choice to require earnedAvailable "crest_of_the_road"/);
    expect(strict({ earnedAvailable: 'crest_of_the_road' })).toBe('');
    // The ride's spoils (lenient: skipped with a note when held) need no requirement.
    expect(validateEventsConfig(data.events, { ...data }).errors).toEqual([]);
  });

  it('the sims leave a choice that grants one alone (D-25), unless their policy takes them', () => {
    // Failure: a fight policy rides to Old Faces and a sim's numbers start measuring an earned
    // blessing (the fullrun baselines drift).
    const run = newRun({ seed: 305 });
    const node = arriveAs(run, 'old_faces');
    const event = findEvent(run.gameData.events, 'old_faces');
    expect(choiceGrantsEarned(event, 'ride')).toBe(true);
    expect(choiceGrantsEarned(event, 'coin')).toBe(false);
    expect(chooseEventPlan(run, node.id, { fight: true }).choiceId).not.toBe('ride');
    expect(chooseEventPlan(run, node.id).choiceId).not.toBe('ride');
    expect(chooseEventPlan(run, node.id, { fight: true, earned: true }).choiceId).toBe('ride');
  });
});

// ── The sanctum's offer is pure (D-6): unit checks; the church is tests/OldSanctum.test.js ──

describe('an offered card the run already holds is never a Take', () => {
  it('a take elsewhere drops the card from every open or owed offer; one left with none is none', () => {
    // Failure: the sanctum still offers a card the run now holds (an elite dropped it, or an
    // event gave it), so Take is refused and the vow does nothing; or a sanctum whose cards are
    // all held offers no blessing at all (neither its pair nor the tier I three).
    const rm = freshRun(51);
    rm.earnedBlessingPicks = {
      'sanctum:s': {
        version: 2,
        key: 'sanctum:s',
        source: 'sanctum',
        actId: 'act1',
        nodeId: 's',
        offered: ['tithe_box', 'hollow_hourglass'],
        status: 'open',
        chosen: null,
      },
      'sanctum:t': {
        version: 2,
        key: 'sanctum:t',
        source: 'sanctum',
        actId: 'act1',
        nodeId: 't',
        offered: ['hollow_hourglass'],
        status: 'open',
        chosen: null,
      },
      'elite:e': {
        version: 2,
        key: 'elite:e',
        source: 'eclipsed_elite',
        actId: 'act1',
        nodeId: 'e',
        offered: ['hollow_hourglass'],
        status: 'owed',
        chosen: null,
      },
    };
    expect(takeEarnedBlessing(rm, 'elite:e', 'hollow_hourglass').ok).toBe(true);
    expect(rm.earnedBlessingPicks['sanctum:s']).toMatchObject({
      status: 'open',
      offered: ['tithe_box'],
    });
    expect(rm.earnedBlessingPicks['sanctum:t']).toMatchObject({ status: 'none', offered: [] });
    // An event's grant prunes the same way.
    rm.earnedBlessingPicks['sanctum:u'] = {
      version: 2,
      key: 'sanctum:u',
      source: 'sanctum',
      actId: 'act1',
      nodeId: 'u',
      offered: ['crest_of_the_road', 'lantern_of_the_road'],
      status: 'open',
      chosen: null,
    };
    expect(
      grantEarnedBlessing(rm, 'crest_of_the_road', { source: 'event', key: 'event:n' }).ok,
    ).toBe(true);
    expect(rm.earnedBlessingPicks['sanctum:u']).toMatchObject({
      status: 'open',
      offered: ['lantern_of_the_road'],
    });
    // A taken entry keeps the record of what it offered.
    expect(rm.earnedBlessingPicks['elite:e']).toMatchObject({
      status: 'taken',
      offered: ['hollow_hourglass'],
    });
  });

  it('a save holding such an offer loads with the card dropped (or as none); the pick model hides it', () => {
    // Failure: an old save (or one written before the prune) shows a card that cannot be taken.
    const raw = {
      'sanctum:s': {
        key: 'sanctum:s',
        source: 'sanctum',
        actId: 'act1',
        offered: ['tithe_box', 'hollow_hourglass'],
        status: 'open',
      },
      'elite:e': {
        key: 'elite:e',
        source: 'eclipsed_elite',
        actId: 'act1',
        offered: ['hollow_hourglass'],
        status: 'owed',
      },
      act1: {
        source: 'act_boss',
        actId: 'act1',
        offered: ['hollow_hourglass'],
        status: 'taken',
        chosen: 'hollow_hourglass',
      },
    };
    const clean = sanitizeEarnedBlessingPicks(raw, { heldIds: ['hollow_hourglass'] });
    expect(clean['sanctum:s']).toMatchObject({ status: 'open', offered: ['tithe_box'] });
    expect(clean['elite:e']).toMatchObject({ status: 'none', offered: [] });
    // A taken entry keeps what it offered: the record of the pick.
    expect(clean.act1).toMatchObject({ status: 'taken', offered: ['hollow_hourglass'] });
    // Through a real load.
    const rm = freshRun(52);
    rm.addBlessingMidRun('hollow_hourglass', { earned: true });
    rm.earnedBlessingPicks = structuredClone(raw);
    const back = roundTrip(rm);
    expect(back.earnedBlessingPicks['elite:e'].status).toBe('none');
    expect(earnedPickOwed(back)).toBeNull();
    // The model, read before any prune, shows only what can be taken.
    rm.earnedBlessingPicks = {
      'elite:f': {
        key: 'elite:f',
        source: 'eclipsed_elite',
        actId: 'act1',
        offered: ['hollow_hourglass', 'lantern_of_the_road'],
        status: 'owed',
      },
    };
    expect(earnedPickModel(rm).cards.map((c) => c.id)).toEqual(['lantern_of_the_road']);
    rm.earnedBlessingPicks['elite:f'].offered = ['hollow_hourglass'];
    expect(earnedPickModel(rm)).toBeNull();
  });
});

describe('the sanctum pair', () => {
  it('is null on a node that is no sanctum', () => {
    const rm = freshRun(50);
    const church = rm.nodeMap.nodes.find((n) => n.type === 'church') || rm.nodeMap.nodes[1];
    expect(openSanctum(rm, church.id)).toBeNull();
    expect(rm.earnedBlessingPicks).toEqual({});
  });

  it('fills from the pure act-boss and elite cards only: never a twisted card, however heavy', () => {
    // Failure: the fill takes the act boss's whole pool, twisted cards included, so the sanctum
    // (a free vow) hands out a card with a curse on it.
    const gameData = withCards(twisted('dark_bargain', { weight: 1000 }));
    let filled = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rm = freshRun(seed, { gameData });
      // The sanctum's own card is held, so both its cards come from the fill.
      rm.addBlessingMidRun('tithe_box', { earned: true });
      expect(earnedPoolFor(rm, 'act_boss').map((b) => b.id)).toContain('dark_bargain');
      const church = rm.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
      church.type = 'church';
      church.sanctum = true;
      const entry = openSanctum(rm, church.id);
      expect(entry.offered).toHaveLength(2);
      expect(entry.offered, `seed ${seed}`).not.toContain('dark_bargain');
      filled++;
    }
    expect(filled).toBe(40);
  });
});
