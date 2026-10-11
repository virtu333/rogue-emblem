// previewObjectives reads a node's own objectives model before its set piece's (the Descent's gate
// fights the Glass, a seize piece, as a defeat of its boss: `battleParams.objectives`). Ways this
// breaks:
//   - the route map's card and the deploy screen name the legacy family ("Rout") or the piece's
//     seize for a gate that plays as a defeat
//   - the finale, which keeps the piece's own seize, is turned into a defeat
//   - a node with neither a model nor a set piece reads one it does not have
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { paramsObjectiveKind, previewObjectives } from '../src/engine/ObjectivePreview.js';
import { describeLoomNode } from '../src/ui/loomModel.js';

const baseData = loadGameData();
const data = { ...baseData, descent: { ...structuredClone(baseData.descent), enabled: true } };

function entityRoad() {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 13, difficultyId: 'hard', applyBlessingsAtStart: false });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  return rm;
}
const nodeOf = (rm, key) => rm.nodeMap.nodes.find((n) => n.descentKey === key);

describe('a node that carries its own objectives model', () => {
  it('the gate previews as the defeat it plays, and says so on its card', () => {
    const rm = entityRoad();
    const gate = nodeOf(rm, 'gate');
    // Facts of the fixture: the Glass itself is a seize piece; the gate overrides it.
    expect(baseData.setPieces.setPieces.find((p) => p.id === 'the_glass').objective).toBe('seize');
    expect(gate.battleParams.objectives).toBeDefined();
    expect(previewObjectives(gate.battleParams, data.setPieces).kind).toBe('defeat');
    expect(paramsObjectiveKind(gate.battleParams, data.setPieces)).toBe('defeat');
    const info = describeLoomNode(gate, {
      state: 'live',
      steps: 1,
      actId: 'finalBoss',
      setPieces: data.setPieces,
    });
    expect(info.objective).toBe('DEFEAT');
  });

  it('the finale keeps the piece’s own seize; a template node has no model', () => {
    // The Lieutenant road's finale is the Glass fought for its throne.
    const lieutenant = new RunManager(data);
    lieutenant.startRun({ runSeed: 13, difficultyId: 'normal', applyBlessingsAtStart: false });
    lieutenant.actIndex = lieutenant.actSequence.indexOf('finalBoss') - 1;
    lieutenant.advanceAct();
    const glass = nodeOf(lieutenant, 'lieutenant');
    expect(glass.battleParams.objectives).toBeUndefined();
    expect(paramsObjectiveKind(glass.battleParams, data.setPieces)).toBe('seize');
    expect(previewObjectives({ objective: 'rout' }, data.setPieces)).toBeNull();
  });
});
