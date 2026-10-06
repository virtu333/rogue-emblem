// An event node (docs/specs/event-nodes.md) must read as an event wherever a node type is
// turned into a label, frame or colour, never as `undefined` or a blank battle. Each test
// names the table it guards.
import { describe, expect, it } from 'vitest';
import { describeLoomNode, loomShortLabel } from '../src/ui/loomModel.js';
import { nodeFrame, nodeLabel } from '../src/ui/RouteGraph.js';
import { NODE_GOLD_MULTIPLIER, NODE_TYPES } from '../src/utils/constants.js';
import { eclipseNode } from '../src/engine/EclipseSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const event = () => ({
  id: 'act2_4_1',
  row: 4,
  col: 1,
  type: NODE_TYPES.EVENT,
  edges: [],
  battleParams: null,
  completed: false,
});

describe('event node labels', () => {
  it('the route graph names it "Event" and gives it a frame (the ruins art until it has its own)', () => {
    expect(nodeLabel(event())).toBe('Event');
    expect(nodeFrame(event(), 'act2')).toBe(4);
  });

  it('the loom card is an EVENT with its own line, not a battle', () => {
    expect(loomShortLabel(event())).toBe('EVENT');
    const card = describeLoomNode(event(), { state: 'live', actId: 'act2' });
    expect(card.kind).toBe('EVENT');
    expect(card.text).toBe('Something waits on the road.');
    expect(card.objective).toBeNull();
  });

  it('a fallen event keeps its silhouette and says the dark took the road', () => {
    const node = event();
    eclipseNode(node, {
      runSeed: 7,
      config: data.eclipse,
      actId: 'act2',
      mapTemplates: data.mapTemplates,
      shadow: 30,
    });
    expect(nodeLabel(node)).toBe('Swallowed road');
    expect(nodeFrame(node, 'act2')).toBe(4);
    const card = describeLoomNode(node, { state: 'live', actId: 'act2' });
    expect(card.kind).toBe('ECLIPSED');
    expect(card.text).toMatch(/^The dark took this road\./);
  });

  it('an event battle pays like a battle (0 would read as 1.0 anyway, so say it)', () => {
    expect(NODE_GOLD_MULTIPLIER.event).toBe(1.0);
  });
});
