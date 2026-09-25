// Recruit identity (external review of the strategy layer, 2026-09-25):
//
// "MapGenerator unconditionally accepts the fixed preview name even when the roster
// already contains it. Colosseum hires do not reserve pending preview names. The
// deterministic route/mercenary probe generates two Archer Linnets. If the Talk
// recruit dies and the hired Linnet survives, name-keyed casualty matching drops the
// fallen recruit's record, preventing revival."
//
// Two layers:
// 1. Reservation — a name a pending recruit node has promised (the Loom card shows
//    it) is never given to a mercenary, a boss recruit, an extra starter or a
//    preview-less recruit, and a preview never takes a name already in the army.
// 2. Identity — casualties, fallen-recruit records and church revival match units by
//    `unitUid` (UnitIdentity.js), never by name, so a save that already holds a
//    collision (a merc hired under a promised name before the fix) is still correct.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunManager, saveRun, loadRun } from '../src/engine/RunManager.js';
import { generateMercenaryCandidates } from '../src/engine/ColosseumEngine.js';
import { generateBossRecruitCandidates } from '../src/engine/BossRecruitSystem.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { recordBattleRecruit, fallenBattleRecruits } from '../src/engine/BattleRecruits.js';
import { reviveAtChurch } from '../src/engine/ChurchCommands.js';
import {
  isSameUnit,
  matchUnitsToSurvivors,
  unitIdentityKey,
  unitUidOf,
} from '../src/engine/UnitIdentity.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, val) => {
      store[key] = String(val);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    key: vi.fn((i) => Object.keys(store)[i] ?? null),
    get length() {
      return Object.keys(store).length;
    },
  },
  configurable: true,
  writable: true,
});

const data = loadGameData();

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

function freshRun(seed) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId: 'normal', applyBlessingsAtStart: false });
  return rm;
}

/**
 * Colosseum candidates for act 1 on a fixed stream, with the given taken names.
 * ColosseumOverlay passes Math.random (unit creation draws from it too), so the
 * probe seeds Math.random and hands it over.
 */
function mercs(seed, existingNames) {
  installSeed(seed);
  try {
    return generateMercenaryCandidates(
      'act1',
      3,
      data.recruits,
      data.classes,
      data.weapons,
      data.skills,
      'normal',
      data.colosseum,
      Math.random,
      data.traits,
      existingNames,
    );
  } finally {
    restoreMathRandom();
  }
}

/** Strip everything that identifies a unit by name, to compare what the RNG decided. */
function rolled(unit) {
  const copy = JSON.parse(JSON.stringify(unit));
  delete copy.name;
  for (const w of [...(copy.inventory || []), copy.weapon]) if (w) delete w.uid;
  return copy;
}

/** A save written before unit identity existed (no uids, no counter). */
function asLegacySave(rm) {
  const json = JSON.parse(JSON.stringify(rm.toJSON()));
  delete json.nextUnitUid;
  for (const unit of [...json.roster, ...json.fallenUnits]) delete unit.unitUid;
  return json;
}

// The reviewer's probe, reproduced: run seed 51 promises "Tamsin" (an Archer) at a
// recruit node; the act-1 colosseum on stream 51 offered two Archers, one of them
// named Tamsin, when it only avoided roster names.
const PROBE_SEED = 51;
const PROMISED = 'Tamsin';

function probeRun() {
  const rm = freshRun(PROBE_SEED);
  const node = rm.nodeMap.nodes.find(
    (n) => n.type === 'recruit' && n.recruitPreview?.name === PROMISED,
  );
  return { rm, node };
}

describe('UnitIdentity', () => {
  it('reads only well-formed uids', () => {
    expect(unitUidOf({ unitUid: 'ru7' })).toBe('ru7');
    for (const bad of [undefined, '', 'ru0', 'u7', 'ru-1', 7, 'ru7x'])
      expect(unitUidOf({ unitUid: bad })).toBeNull();
    expect(unitIdentityKey({ unitUid: 'ru3', name: 'Linnet' })).toBe('ru3');
    expect(unitIdentityKey({ name: 'Linnet' })).toBe('name:Linnet');
  });

  it('two units with uids are the same only when the uids match, whatever the names', () => {
    expect(isSameUnit({ unitUid: 'ru1', name: 'Linnet' }, { unitUid: 'ru2', name: 'Linnet' })).toBe(
      false,
    );
    expect(isSameUnit({ unitUid: 'ru1', name: 'Linnet' }, { unitUid: 'ru1', name: 'Wren' })).toBe(
      true,
    );
    // Legacy (a side without uid): the name decides.
    expect(isSameUnit({ unitUid: 'ru1', name: 'Linnet' }, { name: 'Linnet' })).toBe(true);
  });

  it('matches one survivor to one unit: a living namesake cannot hide a casualty', () => {
    const merc = { unitUid: 'ru2', name: 'Linnet' };
    const recruit = { unitUid: 'ru9', name: 'Linnet' };
    const edric = { unitUid: 'ru1', name: 'Edric' };
    const survivors = [{ ...edric }, { ...merc }];
    const { unmatched } = matchUnitsToSurvivors([edric, merc, recruit], survivors);
    expect(unmatched).toEqual([recruit]);
  });

  it('legacy survivors (no uid) are matched by name, still one to one', () => {
    const merc = { unitUid: 'ru2', name: 'Linnet' };
    const recruit = { unitUid: 'ru9', name: 'Linnet' };
    const { unmatched, survivorOf } = matchUnitsToSurvivors([merc, recruit], [{ name: 'Linnet' }]);
    expect(unmatched).toEqual([recruit]);
    expect(survivorOf.get(merc)).toEqual({ name: 'Linnet' });
    // A survivor with a uid is never claimed by name for a unit that has another uid.
    expect(matchUnitsToSurvivors([merc], [{ unitUid: 'ru9', name: 'Linnet' }]).unmatched).toEqual([
      merc,
    ]);
  });
});

describe('RunManager unit identity', () => {
  it('every starting unit gets a distinct uid, kept through save and load', () => {
    const rm = freshRun(3);
    const uids = rm.roster.map(unitUidOf);
    expect(uids.every(Boolean)).toBe(true);
    expect(new Set(uids).size).toBe(uids.length);
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(loaded.roster.map(unitUidOf)).toEqual(uids);
    expect(loaded.nextUnitUid).toBe(rm.nextUnitUid);
  });

  it('a legacy save is stamped on load, the same way on every load', () => {
    const legacy = asLegacySave(freshRun(3));
    const a = RunManager.fromJSON(structuredClone(legacy), data);
    const b = RunManager.fromJSON(structuredClone(legacy), data);
    expect(a.roster.map(unitUidOf).every(Boolean)).toBe(true);
    expect(a.roster.map(unitUidOf)).toEqual(b.roster.map(unitUidOf));
  });

  it('repairs a duplicated uid and allocates past the highest in use', () => {
    const rm = freshRun(3);
    rm.roster[1].unitUid = rm.roster[0].unitUid;
    rm.fallenUnits.push({ ...structuredClone(rm.roster[0]), name: 'Gone', unitUid: 'ru40' });
    rm.ensureUnitUids();
    const uids = [...rm.roster, ...rm.fallenUnits].map(unitUidOf);
    expect(new Set(uids).size).toBe(uids.length);
    expect(rm.roster[0].unitUid).not.toBe(rm.roster[1].unitUid);
    expect(rm.nextUnitUid).toBeGreaterThan(40);
  });

  it('a unit that joined without a uid gets one before its first battle, without Math.random', () => {
    const rm = freshRun(3);
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle' || n.type === 'recruit');
    const [hired] = mercs(5, []);
    rm.roster.push(hired.unit);
    const prev = Math.random;
    let draws = 0;
    Math.random = () => {
      draws++;
      return prev();
    };
    try {
      rm.assignUnitUid({ name: 'Probe' });
      rm.ensureUnitUids();
    } finally {
      Math.random = prev;
    }
    expect(draws).toBe(0);
    rm.roster.at(-1).unitUid = undefined;
    rm.getBattleParams(node);
    expect(unitUidOf(rm.roster.at(-1))).toBeTruthy();
    expect(rm.getRoster().map(unitUidOf)).toEqual(rm.roster.map(unitUidOf));
  });
});

describe('names a recruit node promised are reserved', () => {
  it('pending previews and locked encounters are promised; walked nodes are not', () => {
    const rm = freshRun(PROBE_SEED);
    const nodes = rm.nodeMap.nodes.filter((n) => n.type === 'recruit');
    expect(nodes.length).toBeGreaterThan(1);
    const [first, second] = nodes;
    expect(rm.getPromisedRecruitNames()).toEqual(new Set(nodes.map((n) => n.recruitPreview.name)));
    expect(
      rm.getPromisedRecruitNames({ excludeNodeId: first.id }).has(first.recruitPreview.name),
    ).toBe(false);
    rm.battleConfigsByNodeId[second.id] = {
      npcSpawn: { className: 'Mage', name: 'Locked', col: 0, row: 0 },
    };
    expect(rm.getPromisedRecruitNames().has('Locked')).toBe(true);
    first.completed = true;
    expect(rm.getPromisedRecruitNames().has(first.recruitPreview.name)).toBe(false);
    const taken = rm.getTakenUnitNames();
    for (const unit of rm.roster) expect(taken.has(unit.name)).toBe(true);
    expect(taken.has(second.recruitPreview.name)).toBe(true);
  });

  it("reviewer's probe: the colosseum offered the promised name; now it never does", () => {
    const { rm, node } = probeRun();
    expect(node).toBeTruthy();
    // Before: only roster names were avoided.
    const before = mercs(
      PROBE_SEED,
      rm.roster.map((u) => u.name),
    );
    expect(before.map((c) => c.unit.name)).toContain(PROMISED);
    // After (ColosseumOverlay passes RunManager.getTakenUnitNames).
    const after = mercs(PROBE_SEED, [...rm.getTakenUnitNames()]);
    expect(after.map((c) => c.unit.name)).not.toContain(PROMISED);
    // Only the name moved: class, level, stats, growths, traits, skills and gear are
    // the same draws (the name pick spends one draw either way).
    expect(after.map((c) => rolled(c.unit))).toEqual(before.map((c) => rolled(c.unit)));
    expect(after.map((c) => c.hireCost)).toEqual(before.map((c) => c.hireCost));
  });

  it('across seeds, no mercenary ever takes a promised or roster name', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rm = freshRun(seed);
      const taken = rm.getTakenUnitNames();
      for (const c of mercs(seed, [...taken])) expect(taken.has(c.unit.name)).toBe(false);
    }
  });

  it('a boss recruit never takes a promised or fallen name', () => {
    const rm = freshRun(PROBE_SEED);
    rm.fallenUnits.push({ ...structuredClone(rm.roster[0]), name: 'Fallen One', isLord: false });
    // Reserve every name the act-1 pool could draw except the class fallbacks.
    const reserved = Object.values(data.recruits.namePool).flat();
    installSeed(9);
    let candidates;
    try {
      candidates = generateBossRecruitCandidates(
        'act1',
        rm.roster,
        data,
        rm.getEffectiveMetaEffects(),
        rm.fallenUnits,
        [...rm.getTakenUnitNames(), ...reserved],
      );
    } finally {
      restoreMathRandom();
    }
    for (const c of candidates || []) {
      if (c.isLord) continue;
      expect(reserved).not.toContain(c.unit.name);
      expect(c.unit.name).not.toBe('Fallen One');
    }
  });

  it('a recruit battle without a preview (legacy fallback) skips promised names', () => {
    const reserved = data.recruits.act1.classPool.flatMap((c) => data.recruits.namePool[c] || []);
    for (let seed = 1; seed <= 8; seed++) {
      installSeed(seed);
      let bc;
      try {
        bc = generateBattle(
          {
            act: 'act1',
            objective: 'rout',
            isRecruitBattle: true,
            deployCount: 3,
            usedRecruitNames: {},
            reservedRecruitNames: reserved,
          },
          data,
        );
      } finally {
        restoreMathRandom();
      }
      expect(bc.npcSpawn?.name).toBeTruthy();
      expect(reserved).not.toContain(bc.npcSpawn.name);
    }
  });

  it('battle params hand the other nodes’ promised names to the map generator', () => {
    const rm = freshRun(PROBE_SEED);
    const nodes = rm.nodeMap.nodes.filter((n) => n.type === 'recruit');
    const params = rm.getBattleParams(nodes[0]);
    expect(params.recruitPreview.name).toBe(nodes[0].recruitPreview.name);
    expect(params.reservedRecruitNames).toEqual(nodes.slice(1).map((n) => n.recruitPreview.name));
  });

  it('an extra starting unit and a next-act preview avoid names already taken', () => {
    const rm = freshRun(PROBE_SEED);
    const promised = rm.getPromisedRecruitNames();
    for (let i = 0; i < 12; i++) {
      const name = rm._pickRecruitNameForClass('Mage');
      expect(promised.has(name)).toBe(false);
    }
    // A preview drawn after a hire never takes the mercenary's name.
    const hired = mercs(3, [...rm.getTakenUnitNames()])[0].unit;
    rm.assignUnitUid(hired);
    rm.roster.push(hired);
    rm.advanceAct();
    for (const node of rm.nodeMap.nodes.filter((n) => n.type === 'recruit'))
      expect(rm.roster.map((u) => u.name)).not.toContain(node.recruitPreview.name);
  });
});

describe('hire → fixed recruit → one namesake dies (reviewer scenario, legacy collision)', () => {
  /**
   * A save from before the fix: an Archer named Tamsin was hired at the colosseum
   * while the recruit node still promised Tamsin. The preview is kept (the Loom showed
   * it), so the battle spawns a second Tamsin.
   */
  function legacyCollision() {
    const { rm, node } = probeRun();
    const merc = mercs(
      PROBE_SEED,
      rm.roster.map((u) => u.name),
    ).find((c) => c.unit.name === PROMISED).unit;
    rm.roster.push(merc); // the old hire path (no uid, no reservation)
    const loaded = RunManager.fromJSON(asLegacySave(rm), data);
    const recruitNode = loaded.nodeMap.nodes.find((n) => n.id === node.id);
    return { rm: loaded, node: recruitNode };
  }

  /** Enter the recruit battle as BattleScene does, and have the recruit join (Talk). */
  function enterAndRecruit(rm, node) {
    const params = rm.getBattleParams(node);
    expect(params.recruitPreview.name).toBe(PROMISED); // the promise is kept
    const army = rm.getRoster();
    const built = rm.getRecruitNodeUnit(node);
    expect(built.isLord).toBe(false);
    const npc = built.unit;
    rm.assignUnitUid(npc); // BattleScene: at spawn
    expect(npc.name).toBe(PROMISED);
    npc.faction = 'player';
    npc.battleEntityId = 'u9';
    const records = recordBattleRecruit([], npc);
    return { army, npc, records };
  }

  it('the Talk recruit dies, the hired namesake lives: recorded fallen and revivable', () => {
    const { rm, node } = legacyCollision();
    const merc = rm.roster.find((u) => u.name === PROMISED);
    expect(unitUidOf(merc)).toBeTruthy();
    const { army, npc, records } = enterAndRecruit(rm, node);
    expect(npc.unitUid).not.toBe(merc.unitUid);

    // The recruit falls; everyone else (the merc Tamsin too) wins the battle.
    const survivors = army;
    const fallenRecruits = fallenBattleRecruits(records, survivors, rm.roster);
    expect(fallenRecruits.map((u) => u.unitUid)).toEqual([npc.unitUid]);
    expect(rm.completeBattle(survivors, node.id, 0, { fallenRecruits })).toBe(true);

    expect(rm.fallenUnits).toHaveLength(1);
    expect(rm.fallenUnits[0].unitUid).toBe(npc.unitUid);
    expect(rm.fallenUnits[0].name).toBe(PROMISED);
    const living = rm.roster.filter((u) => u.name === PROMISED);
    expect(living.map((u) => u.unitUid)).toEqual([merc.unitUid]);

    // Survives save/load, and the church revives that recruit (not the merc).
    expect(saveRun(rm, null, 1).ok).toBe(true);
    const loaded = loadRun(data, 1);
    const record = loaded.fallenUnits.find((u) => u.unitUid === npc.unitUid);
    expect(record).toBeTruthy();
    loaded.gold = 100000;
    expect(reviveAtChurch(loaded, record).ok).toBe(true);
    expect(loaded.fallenUnits).toEqual([]);
    const uids = loaded.roster.map((u) => u.unitUid);
    expect(uids).toContain(npc.unitUid);
    expect(uids).toContain(merc.unitUid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('the hired namesake dies, the recruit lives: the merc is the one recorded', () => {
    const { rm, node } = legacyCollision();
    const merc = rm.roster.find((u) => u.name === PROMISED);
    const { army, npc, records } = enterAndRecruit(rm, node);
    const survivors = [...army.filter((u) => u.unitUid !== merc.unitUid), npc];
    const fallenRecruits = fallenBattleRecruits(records, survivors, rm.roster);
    expect(fallenRecruits).toEqual([]);
    rm.completeBattle(survivors, node.id, 0, { fallenRecruits });
    expect(rm.fallenUnits.map((u) => u.unitUid)).toEqual([merc.unitUid]);
    expect(rm.roster.map((u) => u.unitUid)).toContain(npc.unitUid);
    expect(rm.roster.map((u) => u.unitUid)).not.toContain(merc.unitUid);
  });

  it('a battle resumed from a checkpoint older than unit identity still records the recruit', () => {
    const { rm, node } = legacyCollision();
    const { army, npc, records } = enterAndRecruit(rm, node);
    // Units restored from the old checkpoint carry no uid.
    const survivors = army.map((u) => {
      const copy = structuredClone(u);
      delete copy.unitUid;
      return copy;
    });
    const fallenRecruits = fallenBattleRecruits(records, survivors, rm.roster);
    expect(fallenRecruits.map((u) => u.unitUid)).toEqual([npc.unitUid]);
    const before = rm.roster.map((u) => u.unitUid);
    rm.completeBattle(survivors, node.id, 0, { fallenRecruits });
    expect(rm.fallenUnits.map((u) => u.unitUid)).toEqual([npc.unitUid]);
    // The survivors inherit the identity of the roster unit each one accounts for.
    expect(rm.roster.map((u) => u.unitUid)).toEqual(before);
  });

  it('two fallen allies with one name: the church revives the one chosen', () => {
    const { rm } = legacyCollision();
    const a = { ...structuredClone(rm.roster[0]), name: 'Wren', isLord: false, level: 2 };
    const b = { ...structuredClone(rm.roster[0]), name: 'Wren', isLord: false, level: 9 };
    delete a.unitUid;
    delete b.unitUid;
    rm.fallenUnits.push(a, b);
    rm.ensureUnitUids();
    rm.roster = rm.roster.slice(0, 2);
    rm.gold = 100000;
    expect(reviveAtChurch(rm, b).ok).toBe(true);
    expect(rm.fallenUnits).toEqual([a]);
    expect(rm.roster.at(-1).unitUid).toBe(b.unitUid);
  });
});
