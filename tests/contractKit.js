// A run that has signed a contract and stands beside the battle it will settle on: shared by the
// contract standing and battle HUD tests (docs/specs/event-nodes-phase2.md §2E). Plain data; the
// only engine used is the one a player's own choices go through (EventCommands).
import { arriveAtEvent, chooseEventOption, leaveEvent } from '../src/engine/EventCommands.js';
import { expect } from 'vitest';
import { eventNode, runWithEvents } from './eventKit.js';
import { contractEvent } from './eventPhase2Kit.js';

/** @returns {{ run: object, nodeId: string }} nodeId: the next battle, the one the contract settles on */
export function signedContract(goal, terms = {}) {
  const run = runWithEvents([contractEvent({ goal, ...terms })], { seed: 61 });
  const node = eventNode(run);
  arriveAtEvent(run, node.id);
  expect(chooseEventOption(run, node.id, 'sign').ok).toBe(true);
  expect(leaveEvent(run, node.id).ok).toBe(true);
  const battle = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
  run.currentNodeId = battle.id;
  return { run, nodeId: battle.id };
}
