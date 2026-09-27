// The Ruins offer Rest (heal, revive) OR Scavenge (wares), one per node, kept on
// the run. Each test targets one way the rule could break: a second choice, a
// choice that does not survive a save, an invalid path or node, a closed side
// that still works, or a legacy save.
import { describe, it, expect, beforeEach } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { createUnit } from '../src/engine/UnitManager.js';
import {
  ruinsChoice,
  ruinsChoiceBlock,
  chooseRuinsPath,
  ruinsServiceBlock,
  healAtRuins,
  reviveAtRuins,
  ruinsReviveBlock,
} from '../src/engine/RuinsCommands.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
let run;
let ruinsId;

function wound() {
  // Every unit at 1 HP; expected heal target is each unit's own max HP.
  for (const u of run.roster) u.currentHP = 1;
  return run.roster.map((u) => u.stats.HP);
}
function addFallen(level = 3) {
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    level,
    data.weapons,
    { name: 'Ruins Fallen' },
  );
  unit.currentHP = 0;
  run.fallenUnits.push(unit);
  return unit;
}
// Save as the game does: toJSON, through a JSON string, then fromJSON.
const roundTrip = (r) => RunManager.fromJSON(JSON.parse(JSON.stringify(r.toJSON())), data);

beforeEach(() => {
  run = new RunManager(data);
  run.startRun({ runSeed: 1234 });
  run.gold = 5000;
  ruinsId = run.nodeMap.nodes.find((n) => n.type === 'ruins').id;
});

describe('Ruins choice', () => {
  it('starts with no path and both sides closed', () => {
    expect(ruinsChoice(run, ruinsId)).toBeNull();
    expect(ruinsServiceBlock(run, ruinsId, 'heal')).toBe('Choose Rest first.');
    expect(ruinsServiceBlock(run, ruinsId, 'revive')).toBe('Choose Rest first.');
    expect(ruinsServiceBlock(run, ruinsId, 'wares')).toBe('Choose Scavenge first.');
    const hp = wound();
    expect(healAtRuins(run, ruinsId).ok).toBe(false);
    expect(run.roster.map((u) => u.currentHP)).toEqual(hp.map(() => 1));
  });

  it('Rest heals everyone at once, opens heal and revive, and closes the wares', () => {
    const maxHp = wound();
    const result = chooseRuinsPath(run, ruinsId, 'rest');
    expect(result.ok).toBe(true);
    expect(ruinsChoice(run, ruinsId)).toBe('rest');
    expect(run.roster.map((u) => u.currentHP)).toEqual(maxHp);
    expect(ruinsServiceBlock(run, ruinsId, 'heal')).toBe('');
    expect(ruinsServiceBlock(run, ruinsId, 'revive')).toBe('');
    expect(ruinsServiceBlock(run, ruinsId, 'wares')).toBe(
      'You chose to rest here. The wares stay buried.',
    );
  });

  it('Rest revives for the church price; Scavenge cannot revive or heal', () => {
    const fallen = addFallen(3);
    // 500 base + 3 levels × 300, unpromoted.
    const cost = 1400;
    chooseRuinsPath(run, ruinsId, 'rest');
    expect(ruinsReviveBlock(run, ruinsId, fallen)).toBe('');
    const gold = run.gold;
    expect(reviveAtRuins(run, ruinsId, fallen).ok).toBe(true);
    expect(run.gold).toBe(gold - cost);
    expect(run.roster).toContain(fallen);
    expect(run.fallenUnits).not.toContain(fallen);

    run = new RunManager(data);
    run.startRun({ runSeed: 1234 });
    run.gold = 5000;
    const other = addFallen(3);
    const hp = wound();
    expect(chooseRuinsPath(run, ruinsId, 'scavenge').ok).toBe(true);
    // Scavenge does not heal.
    expect(run.roster.map((u) => u.currentHP)).toEqual(hp.map(() => 1));
    expect(ruinsServiceBlock(run, ruinsId, 'wares')).toBe('');
    expect(ruinsReviveBlock(run, ruinsId, other)).toBe(
      'You chose to scavenge here. No rest tonight.',
    );
    const r = reviveAtRuins(run, ruinsId, other);
    expect(r.ok).toBe(false);
    expect(run.gold).toBe(5000);
    expect(run.fallenUnits).toContain(other);
    expect(healAtRuins(run, ruinsId).ok).toBe(false);
    expect(run.roster.map((u) => u.currentHP)).toEqual(hp.map(() => 1));
  });

  it('cannot choose twice, either path', () => {
    expect(chooseRuinsPath(run, ruinsId, 'scavenge').ok).toBe(true);
    const hp = wound();
    const again = chooseRuinsPath(run, ruinsId, 'rest');
    expect(again).toEqual({
      ok: false,
      reason: 'You chose to scavenge here. No rest tonight.',
    });
    expect(chooseRuinsPath(run, ruinsId, 'scavenge')).toEqual({
      ok: false,
      reason: 'Already chosen.',
    });
    expect(ruinsChoice(run, ruinsId)).toBe('scavenge');
    // The refused Rest did not heal.
    expect(run.roster.map((u) => u.currentHP)).toEqual(hp.map(() => 1));
  });

  it.each([['both'], ['REST'], [''], [undefined], [null], [1]])(
    'refuses the path %s and records nothing',
    (path) => {
      expect(ruinsChoiceBlock(run, ruinsId, path)).toBe('Choose rest or scavenge.');
      expect(chooseRuinsPath(run, ruinsId, path).ok).toBe(false);
      expect(run.ruinsChoiceByNodeId).toEqual({});
    },
  );

  it('refuses a node that is not ruins, or not on this map', () => {
    const battle = run.nodeMap.nodes.find((n) => n.type === 'battle');
    for (const id of [battle.id, 'act9_1_1', '', null, undefined, '__proto__']) {
      expect(chooseRuinsPath(run, id, 'rest').ok).toBe(false);
      expect(ruinsServiceBlock(run, id, 'heal')).toBe('There are no ruins here.');
    }
    expect(run.ruinsChoiceByNodeId).toEqual({});
    expect(ruinsServiceBlock(run, ruinsId, 'forge')).toBe('Unknown service.');
  });

  it('the choice survives a save round trip and still cannot change', () => {
    chooseRuinsPath(run, ruinsId, 'scavenge');
    const restored = roundTrip(run);
    expect(restored.ruinsChoiceByNodeId).toEqual({ [ruinsId]: 'scavenge' });
    expect(ruinsChoice(restored, ruinsId)).toBe('scavenge');
    expect(chooseRuinsPath(restored, ruinsId, 'rest').ok).toBe(false);
    expect(ruinsServiceBlock(restored, ruinsId, 'heal')).not.toBe('');
    const twice = roundTrip(restored);
    expect(ruinsChoice(twice, ruinsId)).toBe('scavenge');
  });

  it('a legacy save without the field has no path chosen yet', () => {
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    delete saved.ruinsChoiceByNodeId;
    const legacy = RunManager.fromJSON(saved, data);
    expect(legacy.ruinsChoiceByNodeId).toEqual({});
    expect(ruinsChoice(legacy, ruinsId)).toBeNull();
    expect(chooseRuinsPath(legacy, ruinsId, 'rest').ok).toBe(true);
    expect(ruinsChoice(roundTrip(legacy), ruinsId)).toBe('rest');
  });

  it('a save keeps only known paths', () => {
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    saved.ruinsChoiceByNodeId = { [ruinsId]: 'rest', other: 'both', third: 5, fourth: 'scavenge' };
    expect(RunManager.fromJSON(saved, data).ruinsChoiceByNodeId).toEqual({
      [ruinsId]: 'rest',
      fourth: 'scavenge',
    });
    for (const bad of [['rest'], 'rest', 7, null]) {
      saved.ruinsChoiceByNodeId = bad;
      expect(RunManager.fromJSON(saved, data).ruinsChoiceByNodeId).toEqual({});
    }
  });

  it('a new act and a new run start with no choices', () => {
    chooseRuinsPath(run, ruinsId, 'rest');
    run.advanceAct();
    expect(run.ruinsChoiceByNodeId).toEqual({});
    const nextRuins = run.nodeMap.nodes.find((n) => n.type === 'ruins').id;
    expect(ruinsChoice(run, nextRuins)).toBeNull();
    chooseRuinsPath(run, nextRuins, 'scavenge');
    run.startRun({ runSeed: 99 });
    expect(run.ruinsChoiceByNodeId).toEqual({});
  });
});
