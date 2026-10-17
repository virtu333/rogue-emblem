// NG+ phase 1 (docs/specs/ng-plus.md): the unlock, "Who rides again?", the Barracks, the NG+
// run's start (veterans at a fresh level, lords' kits), the run's end and the save format.
// Real RunManager and MetaProgressionManager on the shipped data; each test names the realistic
// failure it catches.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  writable: true,
});

import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { getMetaKey } from '../src/engine/SlotManager.js';
import { learnSkill } from '../src/engine/UnitManager.js';
import { CLIENT_CAPABILITIES, requiredRunFormat, runFormatBlock } from '../src/engine/RunFormat.js';
import {
  applyGenerationFields,
  battleGenerationSeed,
  generateSeededBattle,
} from '../src/engine/BattleScout.js';
import { slotKindFor, swornOathSkillId } from '../src/engine/SkillSlots.js';
import { INVENTORY_MAX } from '../src/utils/constants.js';
import { deployLimitsForParams, resolveDeployLimits } from '../src/engine/BattleDeployCount.js';
import {
  BRING_LIMIT,
  MAX_BRING_LIMIT,
  NG_PLUS_UPGRADES,
  KEPT_ITEM_CAPS,
  adoptNgPlusState,
  NG_PLUS_COST,
  applyRidePicks,
  applyRunEnd,
  defaultNgPlusState,
  lordRecordId,
  normalizeNgPlusState,
  ridePickBlock,
  runStartOf,
  setBring,
  undoLastRide,
} from '../src/engine/NgPlusState.js';
import { isNgPlusRun, ngPlusRunEnd, rideCandidates } from '../src/engine/NgPlusRun.js';
import {
  barracksView,
  candidateDetail,
  draftPicks,
  ngPlusResultNote,
  openRideWarning,
  rideView,
  unlockView,
  upgradesView,
} from '../src/ui/ngPlusModel.js';

const data = loadGameData();
const META_KEY = getMetaKey(1);
const freshMeta = () => new MetaProgressionManager(data.metaUpgrades, META_KEY);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});
afterEach(() => vi.restoreAllMocks());

const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const consumable = (name) => structuredClone(data.consumables.find((c) => c.name === name));

/** A Nightfall run whose army holds a Fighter recruit with a learned skill and a kept axe. */
function wonRun({ difficultyId = 'hard', seed = 11, ngPlus = null } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, applyBlessingsAtStart: false, difficultyId, ngPlus });
  return rm;
}

function addRecruit(rm, className = 'Fighter') {
  const unit = rm._createExtraStartingUnit(className);
  rm.roster.push(unit);
  rm.ensureUnitUids();
  return rm.roster.at(-1);
}

function winRun(rm, meta) {
  rm.actIndex = rm.actSequence.length - 1;
  rm.status = 'victory';
  return rm.settleEndRunRewards(meta, 'victory');
}

const unlockedMeta = () => {
  const meta = freshMeta();
  meta.milestones.add('beatLunatic');
  meta.addValor(NG_PLUS_COST.valor);
  meta.addSupply(NG_PLUS_COST.supply);
  expect(meta.unlockNgPlus()).toEqual({ ok: true });
  return meta;
};

describe('the unlock', () => {
  it('needs a Black Sun win and both currencies, and takes both in one save', () => {
    // Failure: the unlock opens on a Nightfall win, or charges one currency only.
    const meta = freshMeta();
    meta.addValor(5000);
    meta.addSupply(5000);
    meta.milestones.add('beatHard');
    expect(meta.unlockNgPlus()).toEqual({ ok: false, reason: 'milestone' });
    meta.milestones.add('beatLunatic');
    meta.totalSupply = NG_PLUS_COST.supply - 1;
    expect(meta.unlockNgPlus()).toEqual({ ok: false, reason: 'supply' });
    meta.totalSupply = 5000;
    expect(meta.unlockNgPlus().ok).toBe(true);
    const reloaded = freshMeta();
    expect(reloaded.isNgPlusUnlocked()).toBe(true);
    expect(reloaded.totalValor).toBe(5000 - NG_PLUS_COST.valor);
    expect(reloaded.totalSupply).toBe(5000 - NG_PLUS_COST.supply);
    expect(meta.unlockNgPlus()).toEqual({ ok: false, reason: 'unlocked' });
  });

  it('a stale copy cannot buy it a second time', () => {
    // Failure (the second review's P1): B checks its stale "locked" state before adopting the
    // disk, so it charges the slot again after A already bought NG+ and earned more.
    const a = freshMeta();
    a.milestones.add('beatLunatic');
    a.addValor(4000);
    a.addSupply(4000);
    const b = freshMeta();
    expect(b.totalValor).toBe(4000);
    expect(b.isNgPlusUnlocked()).toBe(false);
    expect(a.unlockNgPlus()).toEqual({ ok: true });
    a.addValor(1000);
    const valorOnDisk = 4000 - NG_PLUS_COST.valor + 1000;
    const supplyOnDisk = 4000 - NG_PLUS_COST.supply;
    expect(b.unlockNgPlus()).toEqual({ ok: false, reason: 'unlocked' });
    expect(b.isNgPlusUnlocked()).toBe(true);
    const disk = freshMeta();
    expect(disk.isNgPlusUnlocked()).toBe(true);
    expect(disk.totalValor).toBe(valorOnDisk);
    expect(disk.totalSupply).toBe(supplyOnDisk);
  });

  it('is never refunded by Home Base', () => {
    // Failure: the refund path finds the unlock and hands the currencies back.
    const meta = unlockedMeta();
    expect(meta.canRefund('ng_plus').success).toBe(false);
  });

  it('a failed write leaves the currencies and the lock as they were', () => {
    // Failure: memory says "unlocked" and charged while the disk never saw it.
    const meta = freshMeta();
    meta.milestones.add('beatLunatic');
    meta.totalValor = 2000;
    meta.totalSupply = 2000;
    vi.spyOn(meta, '_save').mockReturnValue({ ok: false });
    expect(meta.unlockNgPlus()).toEqual({ ok: false, reason: 'save_failed' });
    expect(meta.totalValor).toBe(2000);
    expect(meta.totalSupply).toBe(2000);
    expect(meta.isNgPlusUnlocked()).toBe(false);
  });

  it('the unlock card says why it cannot be bought', () => {
    const meta = freshMeta();
    expect(unlockView(meta).blockText).toMatch(/Black Sun/);
    expect(unlockView(meta).canBuy).toBe(false);
  });
});

describe('a win leaves its survivors to pick from', () => {
  it('a Nightfall win stores a pending ride with every army survivor but Gaspar', () => {
    // Failure: the special veteran (Gaspar) becomes a Barracks veteran.
    const meta = freshMeta();
    const rm = wonRun();
    const fighter = addRecruit(rm);
    winRun(rm, meta);
    const ride = freshMeta().getNgPlus().pendingRide;
    expect(ride.runId).toBe(rm.runRecordId);
    const names = ride.candidates.map((c) => c.name);
    expect(names).toContain('Edric');
    expect(names).toContain(fighter.name);
    expect(names).not.toContain('Gaspar');
    expect(ngPlusResultNote(freshMeta(), rm)).toMatch(/Black Sun/);
  });

  it('a First Light or Dusk win stores none, and a defeat stores none', () => {
    // Failure: a lower rung farms the Barracks.
    for (const difficultyId of ['normal', 'dusk']) {
      const meta = freshMeta();
      winRun(wonRun({ difficultyId }), meta);
      expect(meta.getNgPlus().pendingRide).toBeNull();
    }
    const meta = freshMeta();
    const rm = wonRun();
    rm.failRun(null);
    rm.settleEndRunRewards(meta, 'defeat');
    expect(meta.getNgPlus().pendingRide).toBeNull();
  });

  it('pays the ride once however often the run is settled', () => {
    // Failure: a reload on Run Complete re-records the ride over a pick already made.
    const meta = unlockedMeta();
    const rm = wonRun();
    winRun(rm, meta);
    expect(meta.passNgPlusRide().ok).toBe(true);
    rm.settleEndRunRewards(meta, 'victory');
    expect(meta.getNgPlus().pendingRide).toBeNull();
  });

  it('keepable skills leave out lord, class and curriculum skills, and keep learned ones', () => {
    // Failure: a class innate or a level-taught skill fills a kept slot.
    const rm = wonRun();
    const fighter = addRecruit(rm);
    learnSkill(fighter, 'vantage');
    learnSkill(fighter, 'wrath'); // the Fighter line's curriculum
    learnSkill(fighter, 'shove');
    const candidate = rideCandidates(rm).find((c) => c.ref === fighter.unitUid);
    expect(candidate.skills).toContain('vantage');
    expect(candidate.skills).toContain('shove');
    expect(candidate.skills).not.toContain('wrath');
    expect(candidate.skillKinds.shove).toBe('ability');
    const edric = rideCandidates(rm).find((c) => c.name === 'Edric');
    expect(edric.skills).not.toContain('charisma');
  });

  it('a promoted recruit is kept on its base line, without the promotion’s growths', () => {
    // Failure: a Warrior comes back with the Warrior's +5 STR growth added a second time.
    const rm = wonRun();
    const fighter = addRecruit(rm);
    const baseStr = fighter.growths.STR;
    fighter.className = 'Warrior';
    fighter.tier = 'promoted';
    fighter.baseClass = 'Fighter';
    fighter.growths.STR += 5;
    const candidate = rideCandidates(rm).find((c) => c.ref === fighter.unitUid);
    expect(candidate.identity.className).toBe('Fighter');
    expect(candidate.identity.growths.STR).toBe(baseStr);
  });
});

/** Meta with a Barracks: Edric (a skill and a weapon) and a Fighter veteran brought. */
function metaWithBarracks() {
  const meta = unlockedMeta();
  const rm = wonRun();
  const fighter = addRecruit(rm);
  learnSkill(fighter, 'vantage');
  const axe = weapon('Steel Axe');
  axe.uid = 'itm_kept_axe';
  fighter.inventory.push(axe);
  const edric = rm.roster.find((u) => u.name === 'Edric');
  learnSkill(edric, 'sol');
  const elixir = consumable('Elixir');
  elixir.uid = 'itm_kept_elixir';
  edric.consumables = [elixir];
  winRun(rm, meta);
  const picks = [
    { ref: edric.unitUid, skillId: 'sol', itemUid: 'itm_kept_elixir' },
    { ref: fighter.unitUid, skillId: 'vantage', itemUid: 'itm_kept_axe' },
  ];
  expect(meta.chooseNgPlusRide(picks)).toMatchObject({ ok: true });
  const vet = meta.getNgPlus().barracks.find((r) => r.kind === 'recruit');
  expect(meta.setNgPlusBring([vet.id]).ok).toBe(true);
  return { meta, fighter, vet };
}

describe('"Who rides again?"', () => {
  it('records 1 skill and 1 item per pick and clears the ride', () => {
    const { meta, fighter, vet } = metaWithBarracks();
    const state = meta.getNgPlus();
    expect(state.pendingRide).toBeNull();
    expect(vet.name).toBe(fighter.name);
    expect(vet.className).toBe('Fighter');
    expect(vet.keptSkills).toEqual(['vantage']);
    expect(vet.keptItems.map((i) => i.uid)).toEqual(['itm_kept_axe']);
    const edric = state.barracks.find((r) => r.id === lordRecordId('Edric'));
    expect(edric.keptSkills).toEqual(['sol']);
    expect(edric.rides).toBe(1);
  });

  it('refuses a second lord, a third recruit, or a skill the unit never had', () => {
    // Failure: the pacing rule's limits are not enforced on commit.
    const meta = unlockedMeta();
    const rm = wonRun();
    const a = addRecruit(rm);
    const b = addRecruit(rm);
    const c = addRecruit(rm);
    winRun(rm, meta);
    const [edric, sera] = ['Edric', 'Sera'].map((n) => rm.roster.find((u) => u.name === n));
    const state = meta.getNgPlus();
    expect(ridePickBlock(state, [{ ref: edric.unitUid }, { ref: sera.unitUid }])).toBe(
      'too_many_lords',
    );
    expect(
      ridePickBlock(
        state,
        [a, b, c].map((u) => ({ ref: u.unitUid })),
      ),
    ).toBe('too_many_recruits');
    expect(ridePickBlock(state, [{ ref: a.unitUid, skillId: 'luna' }])).toBe('unknown_skill');
    expect(meta.chooseNgPlusRide([{ ref: edric.unitUid }, { ref: sera.unitUid }]).ok).toBe(false);
    expect(meta.getNgPlus().pendingRide).not.toBeNull();
  });

  it('a full kind needs a replacement and swaps exactly that one', () => {
    // Failure: the 11th skill is added past the cap, or the wrong one is dropped.
    const state = defaultNgPlusState();
    const ids = ['vantage', 'wrath', 'sol', 'luna', 'astra', 'adept', 'miracle', 'guard'];
    const extra = ['cancel', 'desperation', 'aether'];
    state.barracks.push({
      id: 'vet:r:1',
      kind: 'recruit',
      name: 'Bjorn',
      keptSkills: [...ids, ...extra.slice(0, 2)],
      skillKinds: {},
      keptItems: [],
      rides: 1,
      className: 'Fighter',
      growths: { HP: 70 },
      traits: [],
    });
    state.pendingRide = {
      runId: 'r2',
      candidates: [
        {
          ref: 'u1',
          kind: 'recruit',
          name: 'Bjorn',
          recordId: 'vet:r:1',
          className: 'Fighter',
          identity: null,
          items: [],
          skills: ['aether'],
          skillKinds: { aether: 'skill' },
        },
      ],
    };
    const s = normalizeNgPlusState({ ...state, v: 1 });
    expect(ridePickBlock(s, [{ ref: 'u1', skillId: 'aether' }])).toBe('skill_cap');
    const done = applyRidePicks(s, [{ ref: 'u1', skillId: 'aether', replaceSkillId: 'wrath' }]);
    expect(done.ok).toBe(true);
    const record = s.barracks[0];
    expect(record.keptSkills).toHaveLength(10);
    expect(record.keptSkills).toContain('aether');
    expect(record.keptSkills).not.toContain('wrath');
  });

  it('stays open after a partial pick until every slot is filled', () => {
    // Failure: sending one survivor closes the whole pick (the owner's report), so the other
    // slots are lost; or one already sent is offered again and fills a second slot.
    const meta = unlockedMeta();
    const rm = wonRun();
    const [a, b, c] = [addRecruit(rm), addRecruit(rm), addRecruit(rm)];
    winRun(rm, meta);
    const edric = rm.roster.find((u) => u.name === 'Edric');
    const first = meta.chooseNgPlusRide([{ ref: a.unitUid }]);
    expect(first).toMatchObject({ ok: true, closed: false });
    const reloaded = freshMeta().getNgPlus();
    expect(reloaded.pendingRide.picked).toEqual([a.unitUid]);
    expect(ridePickBlock(reloaded, [{ ref: a.unitUid }])).toBe('already_picked');
    expect(ridePickBlock(reloaded, [{ ref: b.unitUid }, { ref: c.unitUid }])).toBe(
      'too_many_recruits',
    );
    const view = rideView(reloaded, {});
    expect(view.counts).toBe('Lords 0/1 · Recruits 1/2');
    expect(view.candidates.find((x) => x.ref === a.unitUid)).toMatchObject({
      sent: true,
      disabled: true,
    });
    expect(view.commitLabel).toMatch(/^Done/);
    expect(meta.chooseNgPlusRide([{ ref: b.unitUid }])).toMatchObject({ ok: true, closed: false });
    expect(meta.chooseNgPlusRide([{ ref: edric.unitUid }])).toMatchObject({
      ok: true,
      closed: true,
    });
    const state = freshMeta().getNgPlus();
    expect(state.pendingRide).toBeNull();
    expect(state.barracks.map((r) => r.name).sort()).toEqual([a.name, b.name, 'Edric'].sort());
  });

  it('Done (an empty pick) closes a ride left part-filled', () => {
    // Failure: a player who wants only one survivor can never close the pick.
    const meta = unlockedMeta();
    const rm = wonRun();
    const a = addRecruit(rm);
    addRecruit(rm);
    winRun(rm, meta);
    expect(meta.chooseNgPlusRide([{ ref: a.unitUid }]).closed).toBe(false);
    expect(meta.chooseNgPlusRide([])).toMatchObject({ ok: true, closed: true });
    const state = freshMeta().getNgPlus();
    expect(state.pendingRide).toBeNull();
    expect(state.barracks).toHaveLength(1);
  });

  it('a full slot’s survivor can be opened but not added; Begin Run warns while the pick is open', () => {
    // Failure: a full kind locks its survivors' loadouts out of view, or a player begins a run
    // with slots unsent and loses them to the next win without a word.
    const meta = unlockedMeta();
    const rm = wonRun();
    winRun(rm, meta);
    const [edric, sera] = ['Edric', 'Sera'].map((n) => rm.roster.find((u) => u.name === n));
    const view = rideView(meta.getNgPlus(), { [edric.unitUid]: {} });
    const seraChip = view.candidates.find((c) => c.ref === sera.unitUid);
    expect(seraChip).toMatchObject({ full: true, disabled: false });
    expect(seraChip.fullText).toMatch(/lord slot is full/);
    expect(openRideWarning(meta).text).toMatch(/still has 1 lord/);
    expect(meta.chooseNgPlusRide([]).ok).toBe(true);
    expect(openRideWarning(meta)).toBeNull();
    // Not bought: no NG+ run can be begun, so nothing to warn about.
    winRun(wonRun({ seed: 12 }), meta);
    expect(openRideWarning(meta)).not.toBeNull();
    vi.spyOn(meta, 'isNgPlusUnlocked').mockReturnValue(false);
    expect(openRideWarning(meta)).toBeNull();
  });

  it('warns about a pick that keeps no skill or item', () => {
    const meta = unlockedMeta();
    const rm = wonRun();
    const fighter = addRecruit(rm);
    winRun(rm, meta);
    const view = rideView(meta.getNgPlus(), { [fighter.unitUid]: {} });
    expect(view.warnText).toContain(fighter.name);
    expect(rideView(meta.getNgPlus(), {}).warnText).toBe('');
  });

  it('the ride shows what riding again does to each survivor’s Echo', () => {
    // Failure (the owner's ask): the pick names class and level only, so a player sends a
    // veteran in without seeing the enemies will scale up with it.
    const meta = unlockedMeta();
    const first = wonRun();
    winRun(first, meta);
    const edric = first.roster.find((u) => u.name === 'Edric');
    const chipOf = (name) => rideView(meta.getNgPlus(), {}).candidates.find((c) => c.name === name);
    expect(chipOf('Edric').echoText).toBe('Riding again: Echo 0 → 1');
    expect(meta.chooseNgPlusRide([{ ref: edric.unitUid }]).ok).toBe(true);
    if (meta.getNgPlus().pendingRide) expect(meta.chooseNgPlusRide([]).ok).toBe(true);
    winRun(wonRun({ seed: 12 }), meta);
    expect(chipOf('Edric').echoText).toBe('Riding again: Echo 1 → 2');
    expect(chipOf('Sera').echoText).toBe('Riding again: Echo 0 → 1');
  });

  it('the model draws the ride and a picked survivor’s choices', () => {
    const meta = unlockedMeta();
    const rm = wonRun();
    const fighter = addRecruit(rm);
    learnSkill(fighter, 'vantage');
    winRun(rm, meta);
    const state = meta.getNgPlus();
    const draft = { [fighter.unitUid]: { skillId: 'vantage' } };
    const view = rideView(state, draft);
    expect(view.counts).toBe('Lords 0/1 · Recruits 1/2');
    expect(view.canCommit).toBe(true);
    const detail = candidateDetail(state, fighter.unitUid, draft[fighter.unitUid], data);
    expect(detail.skills.find((s) => s.id === 'vantage').chosen).toBe(true);
    expect(draftPicks(draft)).toEqual([{ ref: fighter.unitUid, skillId: 'vantage' }]);
    expect(ngPlusResultNote(meta, rm)).toMatch(/NG\+ tab/);
  });
});

describe('an NG+ run starts with its veterans and kits', () => {
  it('a brought veteran returns at level 1 in its base class with its own growths', () => {
    // Failure: the veteran is re-rolled (new growths), keeps its level, or the trait's growth
    // change lands twice.
    const { meta, vet } = metaWithBarracks();
    const start = meta.ngPlusRunStart('hard');
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 21, applyBlessingsAtStart: false, difficultyId: 'hard', ngPlus: start });
    const unit = rm.roster.find((u) => u.name === vet.name);
    expect(unit).toBeTruthy();
    expect(unit.level).toBe(1);
    expect(unit.className).toBe('Fighter');
    expect(unit.growths).toEqual(vet.growths);
    expect(unit.traits).toEqual(vet.traits);
    expect(unit.faction).toBe('player');
    expect(unit.skills).toContain('vantage');
    expect(unit.inventory.some((i) => i.uid === 'itm_kept_axe')).toBe(true);
    const edric = rm.roster.find((u) => u.name === 'Edric');
    expect(edric.skills).toContain('sol');
    expect(edric.consumables.some((i) => i.uid === 'itm_kept_elixir')).toBe(true);
    expect(isNgPlusRun(rm)).toBe(true);
    expect(rm.ngPlus.members.map((m) => m.id).sort()).toEqual(
      [lordRecordId('Edric'), vet.id].sort(),
    );
  });

  it('rebuilds the veteran the same whatever Math.random returns', () => {
    // Failure: a veteran is re-rolled (growths, traits, stats) on the run's stream, so the
    // same Barracks record comes back as a different unit. Only item uids may differ.
    const { meta, vet } = metaWithBarracks();
    const start = runStartOf(meta.getNgPlus());
    const build = (value) => {
      vi.spyOn(Math, 'random').mockReturnValue(value);
      const rm = new RunManager(data);
      rm.startRun({
        runSeed: 21,
        applyBlessingsAtStart: false,
        difficultyId: 'hard',
        ngPlus: start,
      });
      vi.restoreAllMocks();
      const unit = rm.roster.find((u) => u.name === vet.name);
      return { stats: unit.stats, growths: unit.growths, traits: unit.traits, skills: unit.skills };
    };
    expect(build(0.01)).toEqual(build(0.97));
  });

  it('an NG+ run is saved with its capability and loads back the same', () => {
    // Failure: the run's members are lost on reload (the end never settles the Barracks), or
    // an older client opens the run.
    const { meta } = metaWithBarracks();
    const rm = new RunManager(data);
    rm.startRun({
      runSeed: 21,
      applyBlessingsAtStart: false,
      difficultyId: 'hard',
      ngPlus: meta.ngPlusRunStart('hard'),
    });
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(saved.requiresCapabilities).toContain('ngPlus');
    expect(requiredRunFormat(saved).capabilities).toContain('ngPlus');
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.ngPlus).toEqual(rm.ngPlus);
    const plain = new RunManager(data);
    plain.startRun({ runSeed: 21, applyBlessingsAtStart: false, difficultyId: 'hard' });
    expect(plain.toJSON().ngPlus).toBeUndefined();
    expect(plain.toJSON().requiresCapabilities || []).not.toContain('ngPlus');
  });

  it('an NG+ run at the Entity keeps both its own and the Entity kit’s capability', () => {
    // Failure (the second review's merge check): the two branches each listed only their own
    // id, so a merged client either refuses its own NG+ finale or drops one marker on save.
    const { meta } = metaWithBarracks();
    const rm = new RunManager(data);
    rm.startRun({
      runSeed: 23,
      applyBlessingsAtStart: false,
      difficultyId: 'hard',
      ngPlus: meta.ngPlusRunStart('hard'),
    });
    rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
    rm.advanceAct();
    const boss = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
    const params = applyGenerationFields(rm.getBattleParams(boss), {
      deployCount: 6,
      isBoss: true,
    });
    expect(params.entityKit).toBeTruthy();
    const seed = battleGenerationSeed(params, { runSeed: rm.runSeed, nodeId: boss.id });
    rm.lockBattleConfig(boss.id, generateSeededBattle(params, data, seed));
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(requiredRunFormat(saved).capabilities).toEqual(
      expect.arrayContaining(['ngPlus', 'entityKit']),
    );
    expect(saved.requiresCapabilities).toEqual(expect.arrayContaining(['ngPlus', 'entityKit']));
    // This build plays both; a client missing either refuses the run and names it.
    expect(runFormatBlock(saved)).toBeNull();
    const without = (id) => CLIENT_CAPABILITIES.filter((c) => c !== id);
    expect(runFormatBlock(saved, { clientCapabilities: without('ngPlus') }).missing).toEqual([
      'ngPlus',
    ]);
    expect(runFormatBlock(saved, { clientCapabilities: without('entityKit') }).missing).toEqual([
      'entityKit',
    ]);
    // A load and a second save keep both, and the NG+ members.
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.ngPlus).toEqual(rm.ngPlus);
    expect(loaded.getLockedBattleConfig(boss.id).entityKit).toEqual(params.entityKit);
    expect(loaded.toJSON().requiresCapabilities).toEqual(
      expect.arrayContaining(['ngPlus', 'entityKit']),
    );
  });

  it('no NG+ start below Nightfall or before the unlock', () => {
    const { meta } = metaWithBarracks();
    expect(meta.ngPlusRunStart('dusk')).toBeNull();
    expect(
      new MetaProgressionManager(data.metaUpgrades, getMetaKey(2)).ngPlusRunStart('hard'),
    ).toBeNull();
  });

  it('a trait gives its stat once and never a second helping of its growth', () => {
    // Failure: the trait's +10 HP growth is added again on top of the saved growths (which
    // already hold it), or its +3 HP is lost.
    const growths = { HP: 80, STR: 50, MAG: 0, SKL: 40, SPD: 40, DEF: 30, RES: 10, LCK: 30 };
    const record = (traits) => ({
      id: 'vet:x:1',
      kind: 'recruit',
      name: 'Bjorn',
      keptSkills: [],
      skillKinds: {},
      keptItems: [],
      rides: 1,
      className: 'Fighter',
      growths,
      traits,
    });
    const build = (traits) => {
      const state = defaultNgPlusState();
      state.barracks.push(record(traits));
      state.bring = ['vet:x:1'];
      const rm = new RunManager(data);
      rm.startRun({
        runSeed: 3,
        applyBlessingsAtStart: false,
        difficultyId: 'hard',
        ngPlus: runStartOf(state),
      });
      return rm.roster.find((u) => u.name === 'Bjorn');
    };
    const plain = build([]);
    const hardy = build(['hardy']);
    expect(hardy.growths).toEqual(growths);
    expect(plain.growths).toEqual(growths);
    expect(hardy.stats.HP).toBe(plain.stats.HP + 3);
    expect(hardy.currentHP).toBe(hardy.stats.HP);
  });

  it('a kept Legend weapon is written into the run’s ledger', () => {
    // Failure: the run drops a second copy of a legendary the veteran already carries.
    const state = defaultNgPlusState();
    const legend = data.weapons.find((w) => w.tier === 'Legend' && w.type === 'Axe');
    state.barracks.push({
      id: 'vet:x:1',
      kind: 'recruit',
      name: 'Bjorn',
      keptSkills: [],
      skillKinds: {},
      keptItems: [{ ...structuredClone(legend), uid: 'itm_legend' }],
      rides: 1,
      className: 'Fighter',
      growths: { HP: 70, STR: 50, MAG: 0, SKL: 40, SPD: 40, DEF: 30, RES: 10, LCK: 30 },
      traits: [],
    });
    state.bring = ['vet:x:1'];
    const rm = new RunManager(data);
    rm.startRun({
      runSeed: 3,
      applyBlessingsAtStart: false,
      difficultyId: 'hard',
      ngPlus: runStartOf(state),
    });
    expect(rm.legendaryGrants).toContain(legend.name);
  });

  it('a lord’s kit stacks win over win, and a bag too full sends the rest to the convoy', () => {
    // Failure: a second ride replaces the first's keeps, or a kept weapon past the bag's room
    // is lost at the run's start instead of waiting in the convoy.
    const meta = unlockedMeta();
    const names = ['Iron Sword', 'Steel Sword', 'Iron Lance', 'Steel Lance', 'Iron Axe'];
    for (const [i, name] of names.entries()) {
      const rm = wonRun({ seed: 30 + i });
      const edric = rm.roster.find((u) => u.name === 'Edric');
      const kept = { ...weapon(name), uid: `itm_stack_${i}` };
      edric.inventory = [kept];
      winRun(rm, meta);
      expect(meta.chooseNgPlusRide([{ ref: edric.unitUid, itemUid: kept.uid }]).ok).toBe(true);
      if (meta.getNgPlus().pendingRide) expect(meta.chooseNgPlusRide([]).ok).toBe(true);
    }
    const record = meta.getNgPlus().barracks.find((r) => r.id === lordRecordId('Edric'));
    expect(record.rides).toBe(KEPT_ITEM_CAPS.weapon);
    expect(record.keptItems.map((i) => i.uid)).toEqual(names.map((_, i) => `itm_stack_${i}`));
    const rm = new RunManager(data);
    rm.startRun({
      runSeed: 5,
      applyBlessingsAtStart: false,
      difficultyId: 'hard',
      ngPlus: meta.ngPlusRunStart('hard'),
    });
    const edric = rm.roster.find((u) => u.name === 'Edric');
    const held = new Set([
      ...edric.inventory.map((i) => i.uid),
      ...(rm.convoy.weapons || []).map((i) => i.uid),
    ]);
    for (const item of record.keptItems) expect(held.has(item.uid)).toBe(true);
    expect(edric.inventory.length).toBe(INVENTORY_MAX);
    expect((rm.convoy.weapons || []).some((i) => i.uid.startsWith('itm_stack_'))).toBe(true);
  });

  it('a third lord in the Barracks takes their kit when they join', () => {
    // Failure: only the starting pair's kits come back.
    const state = defaultNgPlusState();
    state.barracks.push({
      id: lordRecordId('Kira'),
      kind: 'lord',
      name: 'Kira',
      keptSkills: ['vantage'],
      skillKinds: {},
      keptItems: [],
      rides: 1,
    });
    const rm = new RunManager(data);
    rm.startRun({
      runSeed: 3,
      applyBlessingsAtStart: false,
      difficultyId: 'hard',
      ngPlus: runStartOf(state),
    });
    const lordDef = data.lords.find((l) => l.name === 'Kira');
    expect(lordDef).toBeTruthy();
    const unit = rm._buildStartingLord(lordDef, { isCommander: false });
    rm.resolveThirdLord(unit);
    const joined = rm.roster.find((u) => u.name === 'Kira');
    expect(joined.skills).toContain('vantage');
    expect(rm.ngPlus.members.some((m) => m.id === lordRecordId('Kira'))).toBe(true);
    expect(rm.ngPlus.lordKits).toEqual([]);
  });
});

describe('the run’s end settles the Barracks', () => {
  function ngPlusRun(meta, seed = 21) {
    const rm = new RunManager(data);
    rm.startRun({
      runSeed: seed,
      applyBlessingsAtStart: false,
      difficultyId: 'hard',
      ngPlus: meta.ngPlusRunStart('hard'),
    });
    return rm;
  }

  it('a veteran who fell leaves the Barracks, even on a loss', () => {
    // Failure: a fallen veteran comes back next run.
    const { meta, vet } = metaWithBarracks();
    const rm = ngPlusRun(meta);
    const unit = rm.roster.find((u) => u.name === vet.name);
    rm.roster = rm.roster.filter((u) => u !== unit);
    rm.fallenUnits.push(unit);
    rm.failRun(null);
    rm.settleEndRunRewards(meta, 'defeat');
    const state = freshMeta().getNgPlus();
    expect(state.barracks.some((r) => r.id === vet.id)).toBe(false);
    expect(state.bring).toEqual([]);
    expect(state.barracks.some((r) => r.id === lordRecordId('Edric'))).toBe(true);
  });

  it('the commander the defeat took loses only their latest ride', () => {
    // Failure: a lost run wipes a lord's whole kit (every defeat ends with the commander
    // down), or it costs nothing at all.
    const { meta } = metaWithBarracks();
    const second = wonRun({ seed: 13 });
    const edric = second.roster.find((u) => u.name === 'Edric');
    learnSkill(edric, 'vantage');
    const lance = { ...weapon('Steel Lance'), uid: 'itm_second_ride' };
    edric.inventory = [lance];
    winRun(second, meta);
    const pick = [{ ref: edric.unitUid, skillId: 'vantage', itemUid: lance.uid }];
    expect(meta.chooseNgPlusRide(pick).ok).toBe(true);
    if (meta.getNgPlus().pendingRide) expect(meta.chooseNgPlusRide([]).ok).toBe(true);

    const rm = ngPlusRun(meta);
    rm.failRun({ defeatedBy: 'Fighter', wasBoss: false });
    rm.settleEndRunRewards(meta, 'defeat');
    const record = freshMeta()
      .getNgPlus()
      .barracks.find((r) => r.id === lordRecordId('Edric'));
    expect(record.keptSkills).toEqual(['sol']);
    expect(record.keptItems.map((i) => i.uid)).toEqual(['itm_kept_elixir']);
    expect(record.rides).toBe(1);

    // A second defeat takes the first ride too, and with nothing left he leaves.
    const again = ngPlusRun(meta);
    again.failRun({ defeatedBy: 'Fighter', wasBoss: false });
    again.settleEndRunRewards(meta, 'defeat');
    expect(
      freshMeta()
        .getNgPlus()
        .barracks.some((r) => r.id === lordRecordId('Edric')),
    ).toBe(false);
  });

  it('taking back a ride restores what it replaced', () => {
    // Failure: undoing a ride that swapped out a kept skill or item leaves the slot empty.
    const state = defaultNgPlusState();
    const sword = { ...weapon('Iron Sword'), uid: 'itm_old' };
    const axe = { ...weapon('Steel Axe'), uid: 'itm_new' };
    state.barracks.push({
      id: lordRecordId('Edric'),
      kind: 'lord',
      name: 'Edric',
      keptSkills: ['sol'],
      skillKinds: { sol: 'skill' },
      keptItems: [sword],
      rides: 1,
    });
    state.pendingRide = {
      runId: 'r2',
      candidates: [
        {
          ref: 'e',
          kind: 'lord',
          name: 'Edric',
          items: [axe],
          skills: ['vantage'],
          skillKinds: { vantage: 'skill' },
        },
      ],
    };
    const s = normalizeNgPlusState({ ...state, v: 1 });
    // Make both kinds full so the ride must replace.
    const record = s.barracks[0];
    record.keptSkills = [
      'sol',
      'luna',
      'astra',
      'adept',
      'miracle',
      'guard',
      'wrath',
      'aether',
      'cancel',
      'desperation',
    ];
    record.skillKinds = Object.fromEntries(record.keptSkills.map((id) => [id, 'skill']));
    record.keptItems = [
      sword,
      ...['a', 'b', 'c', 'd'].map((x) => ({ ...weapon('Iron Lance'), uid: `itm_${x}` })),
    ];
    const done = applyRidePicks(s, [
      {
        ref: 'e',
        skillId: 'vantage',
        replaceSkillId: 'sol',
        itemUid: 'itm_new',
        replaceItemUid: 'itm_old',
      },
    ]);
    expect(done.ok).toBe(true);
    expect(record.keptSkills).not.toContain('sol');
    // The log survives a save and load.
    expect(normalizeNgPlusState(s).barracks[0].rideLog).toHaveLength(1);
    expect(undoLastRide(s, record.id)).toBe(true);
    expect(record.keptSkills).toContain('sol');
    expect(record.keptSkills).not.toContain('vantage');
    expect(record.keptItems.map((i) => i.uid)).toContain('itm_old');
    expect(record.keptItems.map((i) => i.uid)).not.toContain('itm_new');
    expect(record.rides).toBe(1);
    // A ride from before the log can't be taken back.
    expect(undoLastRide(s, record.id)).toBe(false);
  });

  it('a win keeps a member’s items as they are now and drops one used up', () => {
    // Failure: a forged kept weapon reverts to its old copy, or an Elixir drunk comes back.
    const { meta, vet } = metaWithBarracks();
    const rm = ngPlusRun(meta);
    const unit = rm.roster.find((u) => u.name === vet.name);
    const axe = unit.inventory.find((i) => i.uid === 'itm_kept_axe');
    axe.might += 1;
    axe.name = 'Steel Axe +1';
    const edric = rm.roster.find((u) => u.name === 'Edric');
    edric.consumables = edric.consumables.filter((i) => i.uid !== 'itm_kept_elixir');
    winRun(rm, meta);
    const state = freshMeta().getNgPlus();
    const record = state.barracks.find((r) => r.id === vet.id);
    expect(record.keptItems[0].name).toBe('Steel Axe +1');
    expect(state.barracks.find((r) => r.id === lordRecordId('Edric')).keptItems).toEqual([]);
    expect(state.wins).toBe(1);
    expect(state.pendingRide.candidates.find((c) => c.name === vet.name).recordId).toBe(vet.id);
  });

  it('an ordinary run settles nothing for a Barracks it never brought', () => {
    const { meta, vet } = metaWithBarracks();
    const rm = wonRun({ seed: 30 });
    rm.failRun({ defeatedBy: 'x' });
    expect(ngPlusRunEnd(rm, { result: 'defeat' })).toBeNull();
    rm.settleEndRunRewards(meta, 'defeat');
    expect(meta.getNgPlus().barracks.some((r) => r.id === vet.id)).toBe(true);
  });
});

describe('the Barracks state', () => {
  it('bring holds at most two recruits that exist', () => {
    const state = defaultNgPlusState();
    for (const n of [1, 2, 3])
      state.barracks.push({
        id: `vet:r:${n}`,
        kind: 'recruit',
        name: `V${n}`,
        keptSkills: [],
        skillKinds: {},
        keptItems: [],
        rides: 1,
        className: 'Fighter',
        growths: { HP: 50 },
        traits: [],
      });
    expect(setBring(state, ['vet:r:1', 'vet:r:2', 'vet:r:3'])).toEqual({
      ok: false,
      reason: 'too_many',
    });
    expect(setBring(state, ['lord:Edric'])).toEqual({ ok: false, reason: 'unknown' });
    expect(setBring(state, ['vet:r:1', 'vet:r:2']).ok).toBe(true);
    expect(state.bring).toHaveLength(BRING_LIMIT);
    expect(barracksView(state, data).records[2].canBring).toBe(false);
  });

  it('the adopt-merge takes the newer write whole, and a payload without the key keeps ours', () => {
    const a = defaultNgPlusState();
    a.barracks.push({
      id: lordRecordId('Edric'),
      kind: 'lord',
      name: 'Edric',
      keptSkills: [],
      skillKinds: {},
      keptItems: [],
      rides: 1,
    });
    a.rev = 5;
    const b = defaultNgPlusState();
    b.rev = 1;
    // A lower count does not outvote the newer write.
    expect(adoptNgPlusState(a, b).barracks).toEqual([]);
    expect(adoptNgPlusState(a, undefined).barracks).toHaveLength(1);
  });

  it('one kept item has one owner: a later record’s copy of the same uid is dropped', () => {
    // Failure: a save holding the same heirloom on two records installs it twice.
    const axe = { ...weapon('Steel Axe'), uid: 'itm_shared' };
    const record = (id, name) => ({
      id,
      kind: 'lord',
      name,
      keptSkills: [],
      skillKinds: {},
      keptItems: [structuredClone(axe)],
      rides: 1,
    });
    const s = normalizeNgPlusState({
      v: 1,
      barracks: [record(lordRecordId('Edric'), 'Edric'), record(lordRecordId('Sera'), 'Sera')],
    });
    expect(s.barracks[0].keptItems.map((i) => i.uid)).toEqual(['itm_shared']);
    expect(s.barracks[1].keptItems).toEqual([]);
    expect(runStartOf(s).lordKits.flatMap((r) => r.keptItems)).toHaveLength(1);
  });

  it('one record holding the same uid twice keeps one copy', () => {
    // Failure (the second review's P3): the dedupe reads only other records, so a record with
    // two copies of one heirloom brings both into the run.
    const axe = { ...weapon('Steel Axe'), uid: 'itm_twice' };
    const s = normalizeNgPlusState({
      v: 1,
      barracks: [
        {
          id: lordRecordId('Edric'),
          kind: 'lord',
          name: 'Edric',
          keptSkills: [],
          skillKinds: {},
          keptItems: [structuredClone(axe), structuredClone(axe)],
          rides: 2,
        },
      ],
    });
    expect(s.barracks[0].keptItems.map((i) => i.uid)).toEqual(['itm_twice']);
    expect(runStartOf(s).lordKits.flatMap((r) => r.keptItems)).toHaveLength(1);
  });

  it('a malformed record or a bad version reads as empty', () => {
    expect(normalizeNgPlusState({ v: 9, barracks: [{}] })).toEqual(defaultNgPlusState());
    const s = normalizeNgPlusState({ v: 1, barracks: [{ id: 'x', kind: 'recruit', name: 'A' }] });
    expect(s.barracks).toEqual([]);
  });

  it('applyRunEnd with nothing changes nothing', () => {
    const s = defaultNgPlusState();
    applyRunEnd(s, { fallenIds: [], refresh: [], pendingRide: null, ngPlusWin: false });
    expect(s.rev).toBe(0);
  });
});

/** Every instance of an item uid the run's army holds: bags, belts, worn, convoy, stores. */
function instancesOf(rm, uid) {
  const all = [
    ...rm.roster.flatMap((u) => [...(u.inventory || []), ...(u.consumables || []), u.accessory]),
    ...(rm.convoy?.weapons || []),
    ...(rm.convoy?.consumables || []),
    ...(rm.accessories || []),
  ];
  return all.filter((item) => item?.uid === uid).length;
}

function startNgPlus(meta, seed = 21) {
  const rm = new RunManager(data);
  rm.startRun({
    runSeed: seed,
    applyBlessingsAtStart: false,
    difficultyId: 'hard',
    ngPlus: meta.ngPlusRunStart('hard'),
  });
  return rm;
}

describe('a kept item has exactly one owner across the Barracks', () => {
  /** An NG+ run where the veteran's kept axe was traded to Edric before the win. */
  function tradedHeirloom({ vetFalls = false, toConvoy = false } = {}) {
    const { meta, vet } = metaWithBarracks();
    const rm = startNgPlus(meta);
    const vetUnit = rm.roster.find((u) => u.name === vet.name);
    const edric = rm.roster.find((u) => u.name === 'Edric');
    const axe = vetUnit.inventory.find((i) => i.uid === 'itm_kept_axe');
    expect(axe).toBeTruthy();
    vetUnit.inventory = vetUnit.inventory.filter((i) => i !== axe);
    if (vetUnit.weapon === axe) vetUnit.weapon = null;
    if (toConvoy) rm.convoy.weapons.push(axe);
    else edric.inventory.push(axe);
    if (vetFalls) {
      rm.roster = rm.roster.filter((u) => u !== vetUnit);
      rm.fallenUnits.push(vetUnit);
    }
    winRun(rm, meta);
    return { meta, vet, edric };
  }

  it('a heirloom traded to another survivor cannot be kept by them too', () => {
    // Failure (the review's P1): both records claim the axe and the next run holds two.
    const { meta, vet, edric } = tradedHeirloom();
    const state = meta.getNgPlus();
    expect(state.barracks.find((r) => r.id === vet.id).keptItems.map((i) => i.uid)).toEqual([
      'itm_kept_axe',
    ]);
    const pick = [{ ref: edric.unitUid, itemUid: 'itm_kept_axe' }];
    expect(ridePickBlock(state, pick)).toBe('kept_by_other');
    expect(meta.chooseNgPlusRide(pick)).toMatchObject({ ok: false, reason: 'kept_by_other' });
    const detail = candidateDetail(state, edric.unitUid, {}, data);
    expect(detail.items.some((i) => i.uid === 'itm_kept_axe')).toBe(false);
    expect(detail.heirlooms.join()).toContain(vet.name);

    // Reloaded and started again, with the veteran brought: one owner, one axe.
    const reloaded = freshMeta();
    expect(reloaded.chooseNgPlusRide([]).ok).toBe(true);
    const owners = reloaded
      .getNgPlus()
      .barracks.filter((r) => r.keptItems.some((i) => i.uid === 'itm_kept_axe'));
    expect(owners.map((r) => r.id)).toEqual([vet.id]);
    expect(instancesOf(startNgPlus(reloaded, 22), 'itm_kept_axe')).toBe(1);
  });

  it('two picks in one commit cannot both keep the same item', () => {
    const state = normalizeNgPlusState({
      v: 1,
      pendingRide: {
        runId: 'r',
        candidates: ['a', 'b'].map((ref) => ({
          ref,
          kind: 'lord',
          name: ref === 'a' ? 'Edric' : 'Sera',
          items: [{ ...weapon('Iron Sword'), uid: 'itm_dup' }],
          skills: [],
        })),
      },
    });
    expect(
      ridePickBlock(state, [
        { ref: 'a', itemUid: 'itm_dup' },
        { ref: 'b', itemUid: 'itm_dup' },
      ]),
    ).not.toBeNull();
  });

  it('once the original owner falls, the survivor holding it may keep it', () => {
    // Failure: the fallen veteran's claim outlives them and the heirloom is lost for good.
    const { meta, vet, edric } = tradedHeirloom({ vetFalls: true });
    expect(meta.getNgPlus().barracks.some((r) => r.id === vet.id)).toBe(false);
    expect(meta.chooseNgPlusRide([{ ref: edric.unitUid, itemUid: 'itm_kept_axe' }]).ok).toBe(true);
    const owners = freshMeta()
      .getNgPlus()
      .barracks.filter((r) => r.keptItems.some((i) => i.uid === 'itm_kept_axe'));
    expect(owners.map((r) => r.id)).toEqual([lordRecordId('Edric')]);
  });

  it('a heirloom left in the convoy stays its owner’s and comes back once', () => {
    const { meta, vet } = tradedHeirloom({ toConvoy: true });
    expect(meta.chooseNgPlusRide([]).ok).toBe(true);
    const state = freshMeta().getNgPlus();
    expect(state.barracks.find((r) => r.id === vet.id).keptItems.map((i) => i.uid)).toEqual([
      'itm_kept_axe',
    ]);
    expect(instancesOf(startNgPlus(freshMeta(), 23), 'itm_kept_axe')).toBe(1);
  });
});

describe('two managers on one slot never lose or undo each other’s NG+ changes', () => {
  it('a release on one copy is not undone by a stale copy’s Bring change', () => {
    // Failure (the review's P2): the stale copy's save restores the released veteran.
    const { meta: a, vet } = metaWithBarracks();
    const b = freshMeta();
    expect(a.releaseNgPlusVeteran(vet.id).ok).toBe(true);
    // B still thinks the veteran is there: bringing them is refused, not saved.
    expect(b.setNgPlusBring([vet.id])).toMatchObject({ ok: false });
    expect(b.setNgPlusBring([]).ok).toBe(true);
    const state = freshMeta().getNgPlus();
    expect(state.barracks.some((r) => r.id === vet.id)).toBe(false);
  });

  it('two foreign edits and one local edit all persist', () => {
    // Failure: the copy with the higher count wins whole and drops the stale copy's
    // successful edit (or the other way round).
    const { meta: a, vet } = metaWithBarracks();
    const b = freshMeta();
    expect(a.releaseNgPlusVeteran(lordRecordId('Edric')).ok).toBe(true);
    expect(a.setNgPlusBring([]).ok).toBe(true);
    expect(b.setNgPlusBring([vet.id]).ok).toBe(true);
    const state = freshMeta().getNgPlus();
    expect(state.barracks.some((r) => r.id === lordRecordId('Edric'))).toBe(false);
    expect(state.bring).toEqual([vet.id]);
    expect(b.getNgPlus()).toEqual(state);
  });

  it('a survivor sent on one copy cannot be sent again from a stale copy', () => {
    // Failure: the stale copy sends the same survivor a second time, or its own pick
    // replaces the first copy's.
    const a = unlockedMeta();
    const rm = wonRun();
    const [x, y] = [addRecruit(rm), addRecruit(rm)];
    winRun(rm, a);
    const b = freshMeta();
    expect(a.chooseNgPlusRide([{ ref: x.unitUid }]).ok).toBe(true);
    expect(b.chooseNgPlusRide([{ ref: x.unitUid }])).toMatchObject({
      ok: false,
      reason: 'already_picked',
    });
    expect(b.chooseNgPlusRide([{ ref: y.unitUid }]).ok).toBe(true);
    const state = freshMeta().getNgPlus();
    expect(state.pendingRide.picked).toEqual([x.unitUid, y.unitUid]);
    expect(state.barracks.filter((r) => r.kind === 'recruit').map((r) => r.name)).toEqual([
      x.name,
      y.name,
    ]);
  });
});

describe('a kept Oath', () => {
  it('can be kept, and comes back as an ordinary skill with the Oath slot free', () => {
    // Pins the rule as built (the owner's Oath decision): the sworn Oath is keepable; in the
    // next run it is an ordinary skill, never locked in the Oath slot, and the unit has sworn
    // nothing yet.
    const meta = unlockedMeta();
    const rm = wonRun();
    const fighter = addRecruit(rm);
    learnSkill(fighter, 'pavise');
    fighter.deeds = {
      ...(fighter.deeds || {}),
      oath: { deedId: 'dev_deed', skillId: 'pavise', name: 'Test Oath', className: 'Fighter' },
    };
    const candidate = rideCandidates(rm).find((c) => c.ref === fighter.unitUid);
    expect(candidate.skills).toContain('pavise');
    winRun(rm, meta);
    expect(meta.chooseNgPlusRide([{ ref: fighter.unitUid, skillId: 'pavise' }]).ok).toBe(true);
    const vet = meta.getNgPlus().barracks.find((r) => r.kind === 'recruit');
    expect(meta.setNgPlusBring([vet.id]).ok).toBe(true);
    const next = startNgPlus(meta, 24);
    const unit = next.roster.find((u) => u.name === vet.name);
    expect(unit.skills).toContain('pavise');
    expect(swornOathSkillId(unit)).toBeNull();
    expect(slotKindFor(unit, 'pavise', data.skills)).not.toBe('oath');
  });
});

/** A meta whose Barracks holds `n` recruit veterans (two per Nightfall win, keeping nothing). */
function metaWithRecruitVets(n) {
  const meta = unlockedMeta();
  for (let won = 0; won * 2 < n; won += 1) {
    const rm = wonRun({ seed: 40 + won });
    const recruits = [addRecruit(rm), addRecruit(rm)].slice(0, n - won * 2);
    winRun(rm, meta);
    expect(meta.chooseNgPlusRide(recruits.map((u) => ({ ref: u.unitUid }))).ok).toBe(true);
    if (meta.getNgPlus().pendingRide) expect(meta.chooseNgPlusRide([]).ok).toBe(true);
  }
  const ids = meta
    .getNgPlus()
    .barracks.filter((r) => r.kind === 'recruit')
    .map((r) => r.id);
  expect(ids).toHaveLength(n);
  return { meta, ids };
}

const fund = (meta, amount) => {
  meta.addValor(amount);
  meta.addSupply(amount);
};

describe('the NG+ tab upgrades (repeatable sinks)', () => {
  it('each tier costs 400 more of both currencies, up to the cap, and is saved', () => {
    // Failure: a tier charges the wrong price or one currency, or buys past its cap.
    const meta = unlockedMeta();
    fund(meta, 20000);
    const startValor = meta.totalValor;
    const startSupply = meta.totalSupply;
    const prices = [];
    for (let t = 0; t < 4; t += 1) {
      const before = meta.totalValor;
      expect(meta.buyNgPlusUpgrade('barracks_wing')).toEqual({ ok: true, tier: t + 1 });
      prices.push(before - meta.totalValor);
    }
    expect(prices).toEqual([800, 1200, 1600, 2000]);
    expect(startSupply - meta.totalSupply).toBe(5600);
    expect(meta.buyNgPlusUpgrade('barracks_wing')).toEqual({ ok: false, reason: 'maxed' });
    expect(startValor - meta.totalValor).toBe(5600);
    const reloaded = freshMeta();
    expect(reloaded.ngPlusUpgradeTier('barracks_wing')).toBe(4);
    expect(reloaded.ngPlusBringLimit()).toBe(6);
    expect(reloaded.totalValor).toBe(meta.totalValor);
    expect(NG_PLUS_UPGRADES.seers_lantern.maxTier).toBe(5);
  });

  it('needs NG+ unlocked and enough of each currency, and is never refunded', () => {
    const meta = freshMeta();
    fund(meta, 5000);
    expect(meta.buyNgPlusUpgrade('seers_lantern')).toEqual({ ok: false, reason: 'locked' });
    const unlocked = unlockedMeta();
    unlocked.totalValor = 599;
    unlocked.totalSupply = 5000;
    expect(unlocked.buyNgPlusUpgrade('seers_lantern')).toEqual({ ok: false, reason: 'valor' });
    unlocked.totalValor = 5000;
    unlocked.totalSupply = 599;
    expect(unlocked.buyNgPlusUpgrade('seers_lantern')).toEqual({ ok: false, reason: 'supply' });
    expect(unlocked.totalValor).toBe(5000);
    expect(unlocked.ngPlusUpgradeTier('seers_lantern')).toBe(0);
    unlocked.totalSupply = 5000;
    expect(unlocked.buyNgPlusUpgrade('seers_lantern').ok).toBe(true);
    expect(unlocked.canRefund('ng_plus_seers_lantern').success).toBe(false);
    expect(unlocked.buyNgPlusUpgrade('nope')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('a stale copy cannot buy the same tier again at the old price', () => {
    // Failure: B checks its stale tier 0 before adopting the disk and charges tier 1 twice.
    const a = unlockedMeta();
    fund(a, 3000);
    const b = freshMeta();
    expect(a.buyNgPlusUpgrade('barracks_wing')).toEqual({ ok: true, tier: 1 });
    expect(b.buyNgPlusUpgrade('barracks_wing')).toEqual({ ok: true, tier: 2 });
    const disk = freshMeta();
    expect(disk.ngPlusUpgradeTier('barracks_wing')).toBe(2);
  });

  it('Barracks Wing lets an NG+ run bring more veterans', () => {
    // Failure: the Bring list or the run start still stops at two.
    const { meta, ids } = metaWithRecruitVets(4);
    expect(meta.setNgPlusBring(ids.slice(0, 3))).toEqual({ ok: false, reason: 'too_many' });
    fund(meta, 2000);
    expect(meta.buyNgPlusUpgrade('barracks_wing').ok).toBe(true);
    expect(meta.setNgPlusBring(ids.slice(0, 3)).ok).toBe(true);
    expect(meta.setNgPlusBring(ids)).toEqual({ ok: false, reason: 'too_many' });
    expect(freshMeta().getNgPlus().bring).toEqual(ids.slice(0, 3));
    const start = meta.ngPlusRunStart('hard');
    expect(start.veterans.map((v) => v.id)).toEqual(ids.slice(0, 3));
    const rm = wonRun({ seed: 77, ngPlus: start });
    // By the run's member records, never by name: two veterans may share a random name,
    // and the join renames the second ("Jorun II").
    const veteranUids = new Set(
      rm.ngPlus.members.filter((m) => ids.includes(m.id)).map((m) => m.uid),
    );
    expect(veteranUids.size).toBe(3);
    expect(rm.roster.filter((u) => veteranUids.has(u.unitUid))).toHaveLength(3);
    const view = barracksView(meta.getNgPlus(), data, meta.ngPlusBringLimit());
    expect(view.bringCount).toBe('Bringing 3/3');
  });

  it('a saved Bring list keeps up to the most any slot can bring, and a run takes its limit', () => {
    const template = metaWithRecruitVets(1)
      .meta.getNgPlus()
      .barracks.find((r) => r.kind === 'recruit');
    const state = defaultNgPlusState();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    state.barracks = ids.map((id) => ({ ...structuredClone(template), id, keptItems: [] }));
    expect(setBring(state, ids.slice(0, 3))).toEqual({ ok: false, reason: 'too_many' });
    expect(setBring(state, ids.slice(0, 3), 3).ok).toBe(true);
    state.bring = ids;
    const s = normalizeNgPlusState(state);
    expect(s.bring).toHaveLength(MAX_BRING_LIMIT);
    expect(runStartOf(s).veterans).toHaveLength(BRING_LIMIT);
    expect(runStartOf(s, { bringLimit: 4 }).veterans).toHaveLength(4);
  });

  it('Seer’s Lantern adds a Vision charge per tier to every run', () => {
    // Failure: the bonus replaces Home Base's (assigned, not added) or never reaches the run.
    const meta = unlockedMeta();
    meta.purchasedUpgrades.vision_charges_3 = 1; // Sera's Revelation: +2
    expect(meta.getActiveEffects().visionChargesBonus).toBe(2);
    fund(meta, 2000);
    expect(meta.buyNgPlusUpgrade('seers_lantern').ok).toBe(true);
    expect(meta.buyNgPlusUpgrade('seers_lantern').ok).toBe(true);
    const effects = meta.getActiveEffects();
    expect(effects.visionChargesBonus).toBe(4);
    const rm = new RunManager(data, effects);
    rm.startRun({ runSeed: 5, applyBlessingsAtStart: false, difficultyId: 'normal' });
    expect(rm.visionChargesRemaining).toBe(5);
  });

  it('the tab lists each upgrade with its tier, next price and why it cannot be bought', () => {
    const meta = unlockedMeta();
    meta.totalValor = 700;
    meta.totalSupply = 5000;
    const [wing, lantern] = upgradesView(meta);
    expect(wing).toMatchObject({
      name: 'Barracks Wing',
      tierLine: 'Tier 0/4',
      now: 'Brings 2 recruit veterans.',
      cost: 'Next: 800 Valor + 800 Supply · never refunded',
      canBuy: false,
      blockText: 'Needs 800 Valor.',
    });
    expect(lantern).toMatchObject({ tierLine: 'Tier 0/5', canBuy: true, blockText: '' });
    meta.purchasedUpgrades.ng_plus_seers_lantern = 5;
    const maxed = upgradesView(meta)[1];
    expect(maxed).toMatchObject({
      now: '+5 Vision charges.',
      cost: '',
      buyLabel: 'Fully upgraded',
      canBuy: false,
      blockText: '',
    });
  });
});

describe('a full Barracks Wing: six recruit veterans ride', () => {
  it('starts, deploys, saves, reloads and settles the Barracks with all six', () => {
    // Failures at the cap: the run start drops veterans past some old limit, the first map
    // cannot field the deploy screen's count or loses a unit off the bench, a reload forgets
    // the members, or the run's end mis-settles a member it brought (a survivor dropped, a
    // fallen one kept).
    const { meta, ids } = metaWithRecruitVets(6);
    fund(meta, 6000);
    for (let t = 0; t < 4; t += 1) expect(meta.buyNgPlusUpgrade('barracks_wing').ok).toBe(true);
    expect(meta.ngPlusBringLimit()).toBe(6);
    expect(meta.setNgPlusBring(ids).ok).toBe(true);
    expect(freshMeta().getNgPlus().bring).toEqual(ids);

    // The start: every veteran, at level 1 in its base class, beside the lords.
    const start = freshMeta().ngPlusRunStart('hard');
    expect(start.veterans.map((v) => v.id)).toEqual(ids);
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 31, applyBlessingsAtStart: false, difficultyId: 'hard', ngPlus: start });
    // Two veterans may share a name (the roster renames the second "Bram II"): match by member.
    const vetUnits = ids.map((id) => {
      const member = rm.ngPlus.members.find((m) => m.id === id);
      return rm.roster.find((u) => u.unitUid === member?.uid);
    });
    expect(vetUnits.every(Boolean)).toBe(true);
    expect(new Set(vetUnits).size).toBe(6);
    for (const u of vetUnits) expect(u.level).toBe(1);
    expect(new Set(rm.roster.map((u) => u.name)).size).toBe(rm.roster.length);
    expect(new Set(rm.roster.map((u) => u.unitUid)).size).toBe(rm.roster.length);

    // The first battle: the deploy screen's count is fielded, the rest wait on the bench.
    const node = rm.nodeMap.nodes.find((n) => n.row === 0);
    const { max } = resolveDeployLimits({
      base: deployLimitsForParams(rm.getBattleParams(node)),
      deployBonus: rm.getDeployBonus(),
    });
    expect(rm.roster.length).toBeGreaterThan(max);
    const params = applyGenerationFields(rm.getBattleParams(node), { deployCount: max });
    const seed = battleGenerationSeed(params, { runSeed: rm.runSeed, nodeId: node.id });
    const config = generateSeededBattle(params, data, seed);
    expect(config.playerSpawns.length).toBeGreaterThanOrEqual(max);
    rm.lockBattleConfig(node.id, config);

    // Save and reload: the run keeps all six and its members.
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.ngPlus).toEqual(rm.ngPlus);
    for (const u of vetUnits) expect(loaded.roster.some((r) => r.unitUid === u.unitUid)).toBe(true);
    expect(loaded.getLockedBattleConfig(node.id).playerSpawns).toEqual(config.playerSpawns);

    // The end: one veteran falls, the run is won. Five stay, the fallen one leaves, and the
    // ride offers every survivor.
    const fallen = loaded.roster.find((u) => u.unitUid === vetUnits[2].unitUid);
    loaded.roster = loaded.roster.filter((u) => u !== fallen);
    loaded.fallenUnits.push(fallen);
    winRun(loaded, meta);
    const state = freshMeta().getNgPlus();
    const kept = state.barracks.filter((r) => r.kind === 'recruit').map((r) => r.id);
    expect(kept).toEqual(ids.filter((id) => id !== ids[2]));
    expect(state.bring).toEqual(ids.filter((id) => id !== ids[2]));
    expect(state.wins).toBe(1);
    const survivors = state.pendingRide.candidates.filter(
      (c) => c.recordId && kept.includes(c.recordId),
    );
    expect(survivors).toHaveLength(5);
  });
});
