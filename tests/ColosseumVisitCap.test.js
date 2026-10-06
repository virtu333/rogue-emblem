// Playtest 2026-10-06: "if you have a lot of vulneraries you can get tons of gold and XP
// from a colosseum node". arena.maxFightsPerUnit limited each fighter, but nothing limited
// the visit: a big army fought 3 bouts per unit. arena.maxFightsPerVisit caps the bouts at
// one colosseum node, all fighters together: First Light 5, Dusk 4, Nightfall 4, Black Sun 3.
//
// The count is the sum of the node's saved per-unit counts (node.colosseumState.fightsPerUnit,
// written when a bout's fee is paid and saved with the route map), so leaving, re-entering,
// reloading and a crash cannot reset it, and a new act's fresh node map starts every node at 0.
//
// Failure modes each test below is written to catch:
//   - the cap ignored, or read from the wrong rung (Dusk/Nightfall/Black Sun values)
//   - the visit cap hiding behind the per-unit cap (a unit with fights left still enters)
//   - the per-unit cap lost when the visit cap was added
//   - the count reset by leaving and re-entering, by a reload, or carried into the next act
//   - a save from before the cap (no new field) loading as a fresh visit
//   - a bout that was never entered (fee unpaid) spending the visit
//   - the arena screen not showing the bouts left / the closed state, or closing the board too
import './harness/JourneyTestSetup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The challenger is the only random part of a bout: tests choose it.
vi.mock('../src/engine/ColosseumEngine.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, generateChallenger: vi.fn(mod.generateChallenger) };
});
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { ColosseumOverlay } from '../src/ui/ColosseumOverlay.js';
import {
  generateChallenger,
  ARENA_VISIT_SPENT_REASON,
  arenaEntryBlock,
  arenaVisitBouts,
  arenaVisitBoutsLeft,
  canFight,
  getMaxFightsPerVisit,
} from '../src/engine/ColosseumEngine.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { DIFFICULTY_IDS } from '../src/engine/DifficultyEngine.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const storage = new Map();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  });
});

// ── Engine ──

describe('getMaxFightsPerVisit', () => {
  it('reads the rung: First Light 5, Dusk 4, Nightfall 4, Black Sun 3', () => {
    expect(getMaxFightsPerVisit('normal', data.colosseum)).toBe(5);
    expect(getMaxFightsPerVisit('dusk', data.colosseum)).toBe(4);
    expect(getMaxFightsPerVisit('hard', data.colosseum)).toBe(4);
    expect(getMaxFightsPerVisit('lunatic', data.colosseum)).toBe(3);
  });

  it('falls back to the arena default for no rung or an unknown one', () => {
    expect(getMaxFightsPerVisit(null, data.colosseum)).toBe(5);
    expect(getMaxFightsPerVisit('nope', data.colosseum)).toBe(5);
    expect(getMaxFightsPerVisit('lunatic', { arena: { maxFightsPerVisit: 7 } })).toBe(7);
  });

  it('never grows with the rung, and every rung has its own entry', () => {
    const caps = DIFFICULTY_IDS.map((id) => getMaxFightsPerVisit(id, data.colosseum));
    expect(caps).toHaveLength(4);
    for (let i = 1; i < caps.length; i++) expect(caps[i]).toBeLessThanOrEqual(caps[i - 1]);
    for (const id of DIFFICULTY_IDS) {
      expect(data.colosseum.difficulty[id]?.maxFightsPerVisit).toEqual(expect.any(Number));
    }
  });
});

describe('arena visit count', () => {
  it('is the sum of the per-unit counts', () => {
    expect(arenaVisitBouts({ Ada: 3, Bram: 2, Cleo: 1 })).toBe(6);
    expect(arenaVisitBouts({})).toBe(0);
    expect(arenaVisitBouts(null)).toBe(0);
    expect(arenaVisitBouts(undefined)).toBe(0);
  });

  it('ignores junk entries instead of poisoning the total', () => {
    expect(arenaVisitBouts({ Ada: 2, Bram: NaN, Cleo: -4, Dov: 'x' })).toBe(2);
  });

  it('bouts left: cap minus fought, never negative, infinite without a cap', () => {
    expect(arenaVisitBoutsLeft(2, 5)).toBe(3);
    expect(arenaVisitBoutsLeft(5, 5)).toBe(0);
    expect(arenaVisitBoutsLeft(9, 5)).toBe(0);
    expect(arenaVisitBoutsLeft(9, undefined)).toBe(Infinity);
  });
});

describe('arenaEntryBlock with the visit cap', () => {
  const fighter = (over = {}) => {
    const weapon = { name: 'Iron Sword', type: 'Sword', rankRequired: 'Prof', range: '1' };
    return {
      name: 'Kai',
      currentHP: 10,
      weapon,
      inventory: [weapon],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      ...over,
    };
  };

  it('a spent visit blocks a fighter who has per-unit bouts left, with the crowd line', () => {
    expect(arenaEntryBlock(fighter(), 0, 3, 5, 5)).toBe('The crowd goes home: no more bouts here.');
    expect(ARENA_VISIT_SPENT_REASON).toBe('The crowd goes home: no more bouts here.');
    expect(canFight(fighter(), 0, 3, 5, 5)).toBe(false);
  });

  it('one bout left lets a fighter with per-unit bouts left in', () => {
    expect(arenaEntryBlock(fighter(), 2, 3, 4, 5)).toBe('');
    expect(canFight(fighter(), 2, 3, 4, 5)).toBe(true);
  });

  it('the per-unit cap and its text still stop a fighter while the visit has bouts left', () => {
    expect(arenaEntryBlock(fighter(), 3, 3, 3, 5)).toBe('Kai has no arena fights left this visit.');
  });

  it('the other reasons (HP, weapon) still show while the visit has bouts left', () => {
    expect(arenaEntryBlock(fighter({ currentHP: 1 }), 0, 3, 0, 5)).toBe(
      'Kai needs more than 1 HP to fight.',
    );
    expect(arenaEntryBlock(fighter({ weapon: null, inventory: [] }), 0, 3, 0, 5)).toBe(
      'Kai has no weapon to fight with.',
    );
  });

  it('without visit arguments the old per-unit rule is unchanged', () => {
    expect(arenaEntryBlock(fighter(), 0, 3)).toBe('');
    expect(arenaEntryBlock(fighter(), 3, 3)).toBe('Kai has no arena fights left this visit.');
  });
});

// ── The overlay on a real run ──

function runFixture({ difficultyId = 'normal' } = {}) {
  const run = new RunManager(data);
  run.startRun({ runSeed: 42, difficultyId });
  run.gold = 10000;
  const scene = {
    gameData: data,
    runManager: run,
    registry: { get: (key) => (key === 'activeSlot' ? 1 : null) },
    checkActComplete: vi.fn(),
    drawMap: vi.fn(),
    persistRunSave() {
      return NodeMapScene.prototype.persistRunSave.call(this);
    },
  };
  // Two fighters who fell any challenger in round 1: the test is about counts, not odds.
  expect(run.roster.length).toBeGreaterThanOrEqual(2);
  for (const unit of run.roster.slice(0, 2)) {
    unit.stats.STR = 999;
    unit.stats.SPD = 99;
    unit.weapon.hit = 999;
    unit.currentHP = unit.stats.HP;
  }
  return { run, scene, node: run.nodeMap.nodes[0], a: run.roster[0], b: run.roster[1] };
}

function texts(scene) {
  const s = scene._journeySurface;
  return !s || s.destroyed ? [] : [s.title, ...s.root.all().map((n) => n.textContent)].map(String);
}
function buttons(scene) {
  const s = scene._journeySurface;
  return s.root.all().filter((n) => n.tag === 'button');
}
function findButton(scene, match) {
  const test = typeof match === 'string' ? (t) => t === match : match;
  return buttons(scene).find((n) => test(String(n.textContent)));
}
function press(scene, match) {
  const node = findButton(scene, match);
  if (!node || node.disabled) throw new Error(`No enabled button ${match} in ${texts(scene)[0]}`);
  node.onclick();
}
const startsWith = (prefix) => (t) => t.startsWith(prefix);

/** A challenger who cannot hurt anyone and cannot be hurt: a bout against it never ends. */
function wall() {
  const foe = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    1,
    data.weapons,
  );
  foe.stats.HP = foe.currentHP = 99999;
  foe.stats.DEF = 99999;
  foe.stats.STR = 0;
  foe.weapon.hit = 0;
  return { unit: foe };
}
function pushover() {
  const foe = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    1,
    data.weapons,
  );
  foe.currentHP = 1;
  return { unit: foe };
}

function open(scene, run, node) {
  generateChallenger.mockImplementation(() => pushover());
  const overlay = new ColosseumOverlay(scene, run, data);
  overlay.show(node, vi.fn());
  return overlay;
}

/** One bout through the real screens: Arena, the fighter, Bronze, Fight, the log, back. */
function fightBout(scene, unit) {
  press(scene, 'Arena');
  press(scene, startsWith(`${unit.name} ·`));
  press(scene, startsWith('Bronze'));
  press(scene, 'Fight');
  expect(texts(scene)[0]).toBe('Arena · Combat result');
  press(scene, 'Continue');
  expect(texts(scene)[0]).toBe('Arena · Rewards');
  press(scene, 'Back to colosseum');
}

describe('the colosseum visit cap, on a real run', () => {
  it('shows the bouts left and counts down with each bout (First Light: 5)', () => {
    const { run, scene, node, a } = runFixture();
    open(scene, run, node);
    expect(texts(scene)).toContain('Bouts left here: 5');
    fightBout(scene, a);
    expect(texts(scene)).toContain('Bouts left here: 4');
    fightBout(scene, a);
    expect(texts(scene)).toContain('Bouts left here: 3');
  });

  it.each([
    ['normal', 5],
    ['dusk', 4],
    ['hard', 4],
    ['lunatic', 3],
  ])('%s opens with %i bouts left', (difficultyId, cap) => {
    const { run, scene, node } = runFixture({ difficultyId });
    const overlay = open(scene, run, node);
    expect(run.difficultyId).toBe(difficultyId);
    expect(texts(scene)).toContain(`Bouts left here: ${cap}`);
    expect(overlay._visitBoutsLeft()).toBe(cap);
  });

  it('closes the arena when the visit is spent, with the reason, and leaves the board open', () => {
    const { run, scene, node, a, b } = runFixture();
    open(scene, run, node);
    // Three bouts for one fighter (its own cap), two for the other: 5 in all.
    for (const unit of [a, a, a, b, b]) fightBout(scene, unit);

    expect(texts(scene)).toContain('Bouts left here: 0');
    const arena = findButton(scene, 'Arena');
    expect(arena.disabled).toBe(true);
    expect(texts(scene)).toContain(ARENA_VISIT_SPENT_REASON);
    expect(findButton(scene, 'Mercenary board').disabled).toBeFalsy();
    // The second fighter still has a per-unit bout left (2 of 3): only the visit stopped it.
    expect(node.colosseumState.fightsPerUnit).toEqual({ [a.name]: 3, [b.name]: 2 });
  });

  it('a spent visit takes no fee and counts no bout, even if entry is forced', () => {
    const { run, scene, node, b } = runFixture();
    node.colosseumState = { fightsPerUnit: { [run.roster[0].name]: 3, [b.name]: 2 } };
    const reopened = open(scene, run, node);
    expect(reopened._visitBoutsLeft()).toBe(0);
    const goldBefore = run.gold;
    reopened._selectedUnit = b;
    reopened._selectedTier = { name: 'bronze', entryFee: 50, goldReward: 200, xpMultiplier: 1 };
    reopened._challenger = pushover();
    reopened._executeFight();
    expect(run.gold).toBe(goldBefore);
    expect(reopened._fightsPerUnit[b.name]).toBe(2);
  });

  it('the fighter list shows the crowd line for everyone once spent', () => {
    const { run, scene, node, a } = runFixture();
    node.colosseumState = { fightsPerUnit: { [a.name]: 3, Other: 2 } };
    const overlay = open(scene, run, node);
    overlay._showUnitSelect();
    expect(texts(scene).filter((t) => t === ARENA_VISIT_SPENT_REASON).length).toBe(
      run.roster.length,
    );
    expect(
      buttons(scene)
        .filter((n) => n.textContent.includes(' · Lv '))
        .every((n) => n.disabled),
    ).toBe(true);
  });

  it('the per-unit cap still stops a fighter while the visit has bouts left', () => {
    const { run, scene, node, a, b } = runFixture();
    open(scene, run, node);
    for (const unit of [a, a, a]) fightBout(scene, unit);
    expect(texts(scene)).toContain('Bouts left here: 2');
    press(scene, 'Arena');
    const aButton = findButton(scene, startsWith(`${a.name} ·`));
    const bButton = findButton(scene, startsWith(`${b.name} ·`));
    expect(aButton.disabled).toBe(true);
    expect(texts(scene)).toContain(`${a.name} has no arena fights left this visit.`);
    expect(bButton.disabled).toBeFalsy();
  });

  it('"Fight again" is offered while bouts remain and gone on the last one', () => {
    const { run, scene, node, a, b } = runFixture({ difficultyId: 'lunatic' });
    open(scene, run, node);
    // Black Sun: 2 bouts per fighter, 3 per visit.
    fightBout(scene, a);
    fightBout(scene, b);
    press(scene, 'Arena');
    press(scene, startsWith(`${a.name} ·`));
    press(scene, startsWith('Bronze'));
    press(scene, 'Fight');
    press(scene, 'Continue');
    expect(texts(scene)).toContain('Bouts left here: 0');
    expect(texts(scene)).toContain(ARENA_VISIT_SPENT_REASON);
    expect(findButton(scene, 'Fight again')).toBeUndefined();
  });

  it('leaving and re-entering keeps the count', () => {
    const { run, scene, node, a } = runFixture();
    const first = open(scene, run, node);
    fightBout(scene, a);
    fightBout(scene, a);
    first.hide();
    open(scene, run, node);
    expect(texts(scene)).toContain('Bouts left here: 3');
  });

  it('a bout left mid-round is a yield and still counts', () => {
    const { run, scene, node, a } = runFixture();
    const first = open(scene, run, node);
    // A challenger who survives round 1: leave while the bout is open.
    first._selectedUnit = a;
    first._selectedTier = { name: 'bronze', entryFee: 50, goldReward: 200, xpMultiplier: 1 };
    first._challenger = wall();
    first._showForecast();
    press(scene, 'Fight');
    expect(texts(scene)[0]).toMatch(/^Arena · Round 1/);
    first.hide();
    open(scene, run, node);
    expect(texts(scene)).toContain('Bouts left here: 4');
  });

  it('a bout whose fee is not paid does not spend the visit', () => {
    const { run, scene, node, a } = runFixture();
    run.gold = 10;
    const overlay = open(scene, run, node);
    overlay._selectedUnit = a;
    overlay._selectedTier = { name: 'bronze', entryFee: 50, goldReward: 200, xpMultiplier: 1 };
    overlay._challenger = pushover();
    overlay._executeFight();
    expect(run.gold).toBe(10);
    expect(overlay._visitBouts()).toBe(0);
    expect(node.colosseumState?.fightsPerUnit || {}).toEqual({});
  });

  it('survives save and load: the loaded run opens with the same bouts left', () => {
    const { run, scene, node, a } = runFixture();
    open(scene, run, node);
    fightBout(scene, a);
    fightBout(scene, a);
    fightBout(scene, a);

    const loaded = loadRun(data, 1);
    const loadedNode = loaded.nodeMap.nodes[0];
    expect(loadedNode.colosseumState.fightsPerUnit).toEqual({ [a.name]: 3 });
    const loadedScene = { ...scene, runManager: loaded };
    open(loadedScene, loaded, loadedNode);
    expect(texts(loadedScene)).toContain('Bouts left here: 2');

    // And through toJSON/fromJSON directly (the cloud copy's route).
    const copy = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    expect(copy.nodeMap.nodes[0].colosseumState.fightsPerUnit).toEqual({ [a.name]: 3 });
  });

  it('a save from before the cap loads with its true count, and a fresh node with none', () => {
    const { run, scene, node, a } = runFixture();
    // Exactly what an older save holds: per-unit counts and no visit field.
    node.colosseumState = { fightsPerUnit: { [a.name]: 3 }, levelsGained: {}, mercHired: false };
    const old = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    const oldScene = { ...scene, runManager: old };
    const overlay = open(oldScene, old, old.nodeMap.nodes[0]);
    expect(overlay._visitBouts()).toBe(3);
    expect(overlay._visitBoutsLeft()).toBe(2);

    const fresh = open(scene, run, run.nodeMap.nodes[1]);
    expect(fresh._visitBoutsLeft()).toBe(5);
    node.colosseumState = { mercHired: true };
    expect(open(scene, run, node)._visitBoutsLeft()).toBe(5);
  });

  it('resets with the next act: its map is new and every node starts at 0', () => {
    const { run, scene, node, a } = runFixture();
    open(scene, run, node);
    for (const unit of [a, a, a]) fightBout(scene, unit);
    expect(run.nodeMap.nodes[0].colosseumState.fightsPerUnit[a.name]).toBe(3);

    run.advanceAct();
    expect(run.currentAct).toBe('act2');
    expect(run.nodeMap.nodes.some((n) => n.colosseumState)).toBe(false);
    const overlay = open(scene, run, run.nodeMap.nodes[0]);
    expect(overlay._visitBoutsLeft()).toBe(5);
  });
});
