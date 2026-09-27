import { describe, expect, it, vi } from 'vitest';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import * as recruits from '../src/engine/BattleRecruits.js';
import { restoreBattleWorldState } from '../src/engine/BattleSnapshotState.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
function fixture() {
  const original = new RunManager(data);
  original.startRun({ runSeed: 2, applyBlessingsAtStart: false });
  const node = original.nodeMap.nodes.find((n) => n.type === 'recruit');
  const npc = original.getRecruitNodeUnit(node).unit;
  Object.assign(npc, { faction: 'player', battleEntityId: 'u9', level: 2 });
  const merc = structuredClone(npc);
  Object.assign(merc, { level: 4 });
  delete merc.battleEntityId;
  original.roster.push(merc);
  for (const u of original.roster) delete u.unitUid;
  delete npc.unitUid;
  const json = JSON.parse(JSON.stringify(original.toJSON()));
  delete json.nextUnitUid;
  const rm = RunManager.fromJSON(json, data);
  const army = rm.getRoster();
  for (const u of army) delete u.unitUid;
  return { rm, army, npc, node, records: recruits.recordBattleRecruit([], npc) };
}

describe('legacy recruit identity at the restore boundary', () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    'retains the correct units when hire survives=%s and recruit survives=%s',
    (hireLives, recruitLives) => {
      const { rm, army, npc, node, records } = fixture();
      const mercUid = rm.roster.at(-1).unitUid;
      const scene = {
        runManager: rm,
        playerUnits: [
          ...army.slice(0, -1),
          ...(hireLives ? [army.at(-1)] : []),
          ...(recruitLives ? [npc] : []),
        ],
        enemyUnits: [],
        npcUnits: [],
      };
      restoreBattleWorldState(scene, JSON.parse(JSON.stringify({ battleRecruits: records })));
      const survivors = scene.playerUnits.map(serializeUnit);
      const fallenRecruits = recruits.fallenBattleRecruits(
        scene._battleRecruits,
        survivors,
        rm.roster,
      );
      rm.completeBattle(survivors, node.id, 0, { fallenRecruits });
      const living = rm.roster.filter((u) => u.name === npc.name);
      const dead = rm.fallenUnits.filter((u) => u.name === npc.name);
      expect(living.map((u) => u.level).sort()).toEqual(
        [...(hireLives ? [4] : []), ...(recruitLives ? [2] : [])].sort(),
      );
      expect(dead.map((u) => u.level).sort()).toEqual(
        [...(hireLives ? [] : [4]), ...(recruitLives ? [] : [2])].sort(),
      );
      expect([...living, ...dead].find((u) => u.level === 4).unitUid).toBe(mercUid);
      expect(new Set([...living, ...dead].map((u) => u.unitUid)).size).toBe(2);
    },
  );

  it('links escaped recruits, stays stable on recapture, and does not consume RNG', () => {
    const { rm, npc, records } = fixture();
    const scene = { runManager: rm, playerUnits: [], escapedUnits: [npc] };
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('RNG consumed');
    });
    try {
      restoreBattleWorldState(scene, { battleRecruits: records });
      const uid = npc.unitUid,
        next = rm.nextUnitUid;
      expect(uid).toBeTruthy();
      expect(scene._battleRecruits[0].unit.unitUid).toBe(uid);
      restoreBattleWorldState(scene, { battleRecruits: scene._battleRecruits });
      expect(npc.unitUid).toBe(uid);
      expect(rm.nextUnitUid).toBe(next);
      restoreBattleWorldState(scene, { battleRecruits: [] });
      expect(scene._battleRecruits).toEqual([]);
      expect(rm.nextUnitUid).toBe(next);
    } finally {
      random.mockRestore();
    }
  });

  it.each([false, true])('reserves later saved IDs before allocation (reverse=%s)', (reverse) => {
    const rm = new RunManager(data);
    rm.nextUnitUid = 5;
    const records = [
      { name: 'New', entityId: 'u1', unit: { name: 'New' } },
      { name: 'Old', entityId: 'u2', unit: { name: 'Old', unitUid: 'ru5' } },
    ];
    if (reverse) records.reverse();
    const units = [
      { name: 'New', battleEntityId: 'u1' },
      { name: 'Old', battleEntityId: 'u2' },
    ];
    recruits.reconcileRecruitIdentities(records, units, (u) => rm.assignUnitUid(u));
    expect(units.map((u) => u.unitUid)).toEqual(['ru6', 'ru5']);
    const next = rm.nextUnitUid;
    recruits.reconcileRecruitIdentities(records, units, (u) => rm.assignUnitUid(u));
    expect(rm.nextUnitUid).toBe(next);
  });

  it('never links by missing entity ID or by a different name', () => {
    const rm = new RunManager(data);
    const records = [
      { name: 'Same', entityId: null, unit: { name: 'Same' } },
      { name: 'Other', entityId: 'u1', unit: { name: 'Other' } },
    ];
    const units = [
      { name: 'Same', battleEntityId: null },
      { name: 'Wrong', battleEntityId: 'u1' },
    ];
    recruits.reconcileRecruitIdentities(records, units, (u) => rm.assignUnitUid(u));
    expect(units.every((u) => !u.unitUid)).toBe(true);
    expect(records.every((r) => r.unit.unitUid)).toBe(true);
    const copy = structuredClone(records);
    recruits.reconcileRecruitIdentities(records, units);
    expect(records).toEqual(copy);
  });
});
