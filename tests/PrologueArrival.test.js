// A prologue service node's arrival (ui/PrologueArrival.js; docs/specs/prologue-chapter.md
// §6 "Route map, row 2"): Tamsin joins, the run is saved before anything is shown, and
// she speaks her authored line (the bow-rack line when the node handed her the bow).
// A second arrival (a reload at the node) joins, saves and says nothing; a standard
// run's shop is untouched.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));
vi.mock('../src/utils/domUI.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasDOMHost: () => false,
}));

import { readFileSync } from 'fs';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { arriveAtPrologueNode, prologueLine } from '../src/ui/PrologueArrival.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};

function sceneAt(nodeId, { villageBow = true } = {}) {
  const rm = new RunManager(data, null);
  rm.startPrologue(data, data.prologue);
  rm.completeBattle(rm.roster, 'prologue_0', 0);
  rm.completeBattle(rm.roster, 'prologue_1', 0);
  if (villageBow) rm.addToConvoy(structuredClone(data.weapons.find((w) => w.name === 'Iron Bow')));
  rm.currentNodeId = nodeId;
  const order = [];
  vi.mocked(saveServiceRun).mockImplementation(() => {
    order.push(['save', rm.roster.map((u) => u.name)]);
    return '';
  });
  const scene = {
    runManager: rm,
    gameData: data,
    dialogueOverlay: {
      show: vi.fn(async (speaker, line) => {
        order.push(['line', speaker, line]);
      }),
    },
  };
  return { scene, rm, order, node: rm.nodeMap.nodes.find((n) => n.id === nodeId) };
}

beforeEach(() => vi.clearAllMocks());

describe('arrival at the fork', () => {
  it('Tamsin joins, the run is saved, then she speaks', async () => {
    const { scene, order, node } = sceneAt('prologue_2b');
    const result = await arriveAtPrologueNode(scene, node);
    expect(result.joined).toEqual([{ name: 'Tamsin', line: 'tamsin_joins' }]);
    expect(order).toEqual([
      ['save', ['Edric', 'Gaspar', 'Tamsin']],
      ['line', 'Tamsin', data.dialogue.prologue.tamsin_joins[0].line],
    ]);
  });

  it('with no bow in the army, the node hands her one and her line says so', async () => {
    const { scene, rm, node } = sceneAt('prologue_2a', { villageBow: false });
    const result = await arriveAtPrologueNode(scene, node);
    expect(result.joined).toEqual([{ name: 'Tamsin', line: 'tamsin_joins_bow_rack' }]);
    expect(result.granted).toEqual(['Iron Bow']);
    expect(rm.convoy.weapons.map((w) => w.name)).toContain('Iron Bow');
    expect(scene.dialogueOverlay.show).toHaveBeenCalledWith(
      'Tamsin',
      prologueLine(data, 'tamsin_joins_bow_rack'),
      null,
    );
  });

  it('a second arrival (a reload at the node) does nothing', async () => {
    const { scene, rm, node } = sceneAt('prologue_2a');
    await arriveAtPrologueNode(scene, node);
    vi.clearAllMocks();
    const again = await arriveAtPrologueNode(scene, node);
    expect(again).toEqual({ joined: [], granted: [] });
    expect(saveServiceRun).not.toHaveBeenCalled();
    expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
    expect(rm.roster.filter((u) => u.name === 'Tamsin')).toHaveLength(1);
  });

  it('a standard run is untouched', async () => {
    const rm = new RunManager(data, null);
    rm.startRun({ difficultyId: 'normal' });
    const before = rm.roster.map((u) => u.name);
    const scene = { runManager: rm, gameData: data, dialogueOverlay: { show: vi.fn() } };
    const result = await arriveAtPrologueNode(scene, { id: 'prologue_2a', type: 'shop' });
    expect(result).toEqual({ joined: [], granted: [] });
    expect(rm.roster.map((u) => u.name)).toEqual(before);
    expect(saveServiceRun).not.toHaveBeenCalled();
  });
});
