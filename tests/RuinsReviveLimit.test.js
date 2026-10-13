// The Ruins revive one of the fallen per visit, and that unit comes back with a Lingering
// Injury. Each test targets one way the rule could break: a second revival at the same ruins, a
// limit that a save, reload or the other ruins forgets, an injury that the same ruins' free Heal
// all quietly mends, an injury on a stat the unit never fights with, or a church that starts
// injuring its revivals too.
import { describe, it, expect, beforeEach } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { createUnit } from '../src/engine/UnitManager.js';
import {
  chooseRuinsPath,
  healAtRuins,
  reviveAtRuins,
  ruinsReviveBlock,
  ruinsReviveInjury,
} from '../src/engine/RuinsCommands.js';
import { reviveAtChurch, healRosterAtChurch } from '../src/engine/ChurchCommands.js';
import { burdenOf, woundHealLine } from '../src/engine/Burdens.js';
import { unitUidOf } from '../src/engine/UnitIdentity.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
let run;
let ruinsId;

function addFallen(className, name, level = 3) {
  const unit = createUnit(
    data.classes.find((c) => c.name === className),
    level,
    data.weapons,
    { name },
  );
  unit.currentHP = 0;
  run.fallenUnits.push(unit);
  return unit;
}
const roundTrip = (r) => RunManager.fromJSON(JSON.parse(JSON.stringify(r.toJSON())), data);

function startRun(difficultyId) {
  run = new RunManager(data);
  run.startRun({ runSeed: 1234, ...(difficultyId ? { difficultyId } : {}) });
  run.gold = 20000;
  ruinsId = run.nodeMap.nodes.find((n) => n.type === 'ruins').id;
}

beforeEach(() => startRun());

describe('Ruins: one revival per visit', () => {
  it('revives one fallen ally, then refuses the second without spending gold', () => {
    const first = addFallen('Fighter', 'First Fallen');
    const second = addFallen('Fighter', 'Second Fallen');
    chooseRuinsPath(run, ruinsId, 'rest');
    expect(reviveAtRuins(run, ruinsId, first).ok).toBe(true);
    const gold = run.gold;
    const refused = reviveAtRuins(run, ruinsId, second);
    expect(refused).toEqual({ ok: false, reason: 'The ruins give back only one of the fallen.' });
    expect(ruinsReviveBlock(run, ruinsId, second)).toBe(
      'The ruins give back only one of the fallen.',
    );
    expect(run.gold).toBe(gold);
    expect(run.fallenUnits).toContain(second);
    expect(run.roster).not.toContain(second);
  });

  it('keeps the limit across a save and reload', () => {
    const first = addFallen('Fighter', 'First Fallen');
    addFallen('Fighter', 'Second Fallen');
    chooseRuinsPath(run, ruinsId, 'rest');
    reviveAtRuins(run, ruinsId, first);
    const restored = roundTrip(run);
    const second = restored.fallenUnits.find((u) => u.name === 'Second Fallen');
    expect(reviveAtRuins(restored, ruinsId, second).ok).toBe(false);
    expect(restored.fallenUnits).toContain(second);
  });

  it("a failed revival (too little gold) leaves the ruins' one revival unspent", () => {
    const pricey = addFallen('Fighter', 'Pricey', 10);
    const cheap = addFallen('Fighter', 'Cheap', 1);
    chooseRuinsPath(run, ruinsId, 'rest');
    run.gold = 900; // Cheap costs 800 (500 + 1 × 300); Pricey 3500.
    expect(reviveAtRuins(run, ruinsId, pricey).ok).toBe(false);
    expect(reviveAtRuins(run, ruinsId, cheap).ok).toBe(true);
    expect(run.roster).toContain(cheap);
  });

  it('a save from before the rule allows its one revival', () => {
    const fallen = addFallen('Fighter', 'Legacy Fallen');
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    delete saved.ruinsRevivedByNodeId;
    const legacy = RunManager.fromJSON(saved, data);
    expect(legacy.ruinsRevivedByNodeId).toEqual({});
    chooseRuinsPath(legacy, ruinsId, 'rest');
    const unit = legacy.fallenUnits.find((u) => u.name === fallen.name);
    expect(reviveAtRuins(legacy, ruinsId, unit).ok).toBe(true);
  });

  it('a church still revives as many as the player can pay for, uninjured', () => {
    const a = addFallen('Fighter', 'Church A');
    const b = addFallen('Fighter', 'Church B');
    expect(reviveAtChurch(run, a).ok).toBe(true);
    expect(reviveAtChurch(run, b).ok).toBe(true);
    expect(burdenOf(run, 'wounded')).toBeNull();
  });
});

describe('Ruins: the revived unit returns injured', () => {
  it("takes −2 to a fighter's STR for 3 battles (Nightfall)", () => {
    startRun('hard');
    const fallen = addFallen('Fighter', 'Axe Fallen');
    chooseRuinsPath(run, ruinsId, 'rest');
    const result = reviveAtRuins(run, ruinsId, fallen);
    expect(result.ok).toBe(true);
    expect(unitUidOf(fallen)).toBeTruthy();
    expect(burdenOf(run, 'wounded')).toMatchObject({
      unitUid: unitUidOf(fallen),
      unitName: 'Axe Fallen',
      stat: 'STR',
      value: -2,
      battles: 3,
      takenAt: ruinsId,
    });
    expect(result.message).toContain('Axe Fallen carries a lingering injury: -2 STR for 3 battles');
  });

  it("a mage's injury falls on MAG, and First Light's lasts 2 battles", () => {
    startRun('normal');
    const fallen = addFallen('Mage', 'Tome Fallen');
    expect(ruinsReviveInjury(run, fallen)).toEqual({ stat: 'MAG', value: -2, battles: 2 });
    chooseRuinsPath(run, ruinsId, 'rest');
    reviveAtRuins(run, ruinsId, fallen);
    expect(burdenOf(run, 'wounded')).toMatchObject({ stat: 'MAG', value: -2, battles: 2 });
  });

  it("the same ruins' Heal all leaves the injury; a church's mends it", () => {
    const fallen = addFallen('Fighter', 'Hurt Fallen');
    chooseRuinsPath(run, ruinsId, 'rest');
    reviveAtRuins(run, ruinsId, fallen);
    expect(woundHealLine(run, { nodeId: ruinsId })).toBe(
      "Hurt Fallen's lingering injury needs a church: Heal all here leaves it.",
    );
    expect(healAtRuins(run, ruinsId).mended).toBeNull();
    expect(burdenOf(run, 'wounded')).not.toBeNull();
    // Saved and reloaded, the ruins still leave it.
    const restored = roundTrip(run);
    expect(burdenOf(restored, 'wounded')?.takenAt).toBe(ruinsId);
    expect(healAtRuins(restored, ruinsId).mended).toBeNull();
    // Any other heal (a church's) mends it, as every injury.
    const mended = healRosterAtChurch(restored, { nodeId: 'some_church' });
    expect(mended.mended).toMatchObject({ unitName: 'Hurt Fallen' });
    expect(burdenOf(restored, 'wounded')).toBeNull();
  });

  it('the injury reaches the next battle as a stat penalty on that unit', () => {
    const fallen = addFallen('Fighter', 'Next Fight');
    chooseRuinsPath(run, ruinsId, 'rest');
    reviveAtRuins(run, ruinsId, fallen);
    const battleNode = run.nodeMap.nodes.find((n) => n.type === 'battle');
    expect(run.getBattleParams(battleNode).battleDebuffs).toEqual([
      { unitUid: unitUidOf(fallen), stat: 'STR', value: -2, source: 'wounded' },
    ]);
  });
});
