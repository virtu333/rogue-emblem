// Hidden recruits (docs/specs/lord-recruit-odds.md): a recruit node's card says who waits there
// only once the node is a next step (or the party stands on it). Further down the road it says
// only that someone waits, so a player cannot route a whole act toward the cards showing a lord.
//
// Failures caught: a future or cut-off card still naming the recruit or saying "a lord"
// (in its place line, its text or its recruit block), the card building the unit anyway,
// or a next-step card losing its recruit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { renderLoomCard } from '../src/ui/LoomPanels.js';
import { RECRUIT_HIDDEN_TEXT, describeLoomNode } from '../src/ui/loomModel.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

/** A run whose Act 1 holds a recruit node that shows a lord (Hero's Call maxed out). */
function runWithLordCard() {
  for (let seed = 1; seed < 200; seed++) {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: seed, difficultyId: 'normal', applyBlessingsAtStart: false });
    rm.metaEffects = { ...(rm.metaEffects || {}), lordRecruitChanceBonus: 1 };
    const node = rm.nodeMap.nodes.find(
      (n) => n.type === 'recruit' && rm.getRecruitNodeUnit(n)?.isLord,
    );
    if (node) return { rm, node, name: rm.getRecruitNodeUnit(node).unit.name };
  }
  throw new Error('no seed with a lord recruit card');
}

describe('the route card of a recruit node', () => {
  beforeEach(() => installFakeDom(vi));
  afterEach(() => vi.unstubAllGlobals());

  const render = (rm, node, state) => {
    const card = document.createElement('section');
    renderLoomCard(card, node, {
      model: { nodeState: () => state, steps: new Map() },
      actId: rm.currentAct,
      gameData: rm.gameData,
      runManager: rm,
      isFirstBattle: () => false,
    });
    return card;
  };

  it('names the recruit, a lord included, once the node is a next step', () => {
    const { rm, node, name } = runWithLordCard();
    for (const state of ['live', 'current']) {
      const card = render(rm, node, state);
      expect(card.querySelector('.re-loom-recruit'), state).not.toBeNull();
      expect(card.textContent, state).toContain(name);
      expect(card.textContent, state).toContain('a lord');
    }
  });

  it('further down the road says only that someone waits, and never builds the unit', () => {
    const { rm, node, name } = runWithLordCard();
    const built = vi.spyOn(rm, 'getRecruitNodeUnit');
    for (const state of ['future', 'cut']) {
      const card = render(rm, node, state);
      expect(card.querySelector('.re-loom-recruit'), state).toBeNull();
      expect(card.textContent, state).not.toContain(name);
      expect(card.textContent, state).not.toContain('a lord');
      expect(card.textContent, state).not.toContain('LORD');
      expect(card.textContent, state).toContain(RECRUIT_HIDDEN_TEXT);
      expect(card.textContent, state).toContain('A potential ally');
    }
    expect(built).not.toHaveBeenCalled();
  });
});

describe('describeLoomNode', () => {
  const node = { id: 'r', type: 'recruit', battleParams: { objective: 'rout' } };
  const recruit = { name: 'Kira', isLord: true };

  it('drops a recruit it was handed for a node that is not a next step', () => {
    for (const state of ['future', 'cut']) {
      const info = describeLoomNode(node, { state, recruit });
      expect(info.recruit, state).toBeNull();
      expect(info.place, state).toBe('A potential ally');
      expect(info.text, state).toBe(RECRUIT_HIDDEN_TEXT);
    }
    expect(describeLoomNode(node, { state: 'live', recruit }).place).toBe('Kira, a lord');
    // A walked node keeps its old line.
    expect(describeLoomNode(node, { state: 'done', recruit }).text).toBe(
      'Battle with a potential ally.',
    );
  });
});
