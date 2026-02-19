import { describe, it, expect, vi } from 'vitest';
import { classifyNodes, CampaignMapOverlay } from '../src/ui/CampaignMapOverlay.js';

// --- Phaser scene mock ---

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setColor() {
      return this;
    },
    setAlpha() {
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy: vi.fn(),
  };
}

function makeScene() {
  const created = { circles: [], texts: [], rectangles: [], graphics: [] };
  return {
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    add: {
      rectangle: (x, y, w, h, color, alpha) => {
        const obj = makeDisplayObject({ kind: 'rect', x, y, w, h, color, alpha });
        created.rectangles.push(obj);
        return obj;
      },
      text: (x, y, text, style) => {
        const obj = makeDisplayObject({ kind: 'text', x, y, text, style });
        created.texts.push(obj);
        return obj;
      },
      circle: (x, y, radius, color, alpha) => {
        const obj = makeDisplayObject({ kind: 'circle', x, y, radius, color, alpha });
        created.circles.push(obj);
        return obj;
      },
      graphics: () => {
        const g = makeDisplayObject({
          kind: 'graphics',
          lineStyle() {
            return this;
          },
          lineBetween() {
            return this;
          },
        });
        created.graphics.push(g);
        return g;
      },
    },
    input: {
      keyboard: {
        addKey: () => ({ on: vi.fn(), off: vi.fn() }),
      },
    },
    tweens: { add: vi.fn() },
    created,
  };
}

// --- Test node map factory ---

function makeNodeMap() {
  // 3-row map: start (row 0) → mid (row 1) → boss (row 2)
  return {
    actId: 'act1',
    startNodeId: 'act1_0_2',
    bossNodeId: 'act1_2_2',
    nodes: [
      {
        id: 'act1_0_2',
        row: 0,
        col: 2,
        type: 'battle',
        edges: ['act1_1_1', 'act1_1_3'],
        completed: true,
      },
      { id: 'act1_1_1', row: 1, col: 1, type: 'shop', edges: ['act1_2_2'], completed: false },
      { id: 'act1_1_3', row: 1, col: 3, type: 'recruit', edges: ['act1_2_2'], completed: false },
      { id: 'act1_2_2', row: 2, col: 2, type: 'boss', edges: [], completed: false },
    ],
  };
}

// --- classifyNodes ---

describe('classifyNodes', () => {
  it('classifies active, completed, next, and locked nodes', () => {
    const nodeMap = makeNodeMap();
    // Player is currently battling the shop node (act1_1_1)
    const states = classifyNodes(nodeMap.nodes, 'act1_1_1');

    expect(states.get('act1_0_2')).toBe('completed'); // completed=true
    expect(states.get('act1_1_1')).toBe('active'); // activeNodeId match
    expect(states.get('act1_2_2')).toBe('next'); // edge from active
    expect(states.get('act1_1_3')).toBe('locked'); // not completed, not active, not next
  });

  it('marks active node even if it is also completed', () => {
    const nodes = [
      { id: 'n1', row: 0, col: 0, type: 'battle', edges: ['n2'], completed: true },
      { id: 'n2', row: 1, col: 0, type: 'boss', edges: [], completed: false },
    ];
    // active overrides completed
    const states = classifyNodes(nodes, 'n1');
    expect(states.get('n1')).toBe('active');
    expect(states.get('n2')).toBe('next');
  });

  it('handles null activeNodeId (all completed or locked)', () => {
    const nodes = [
      { id: 'n1', row: 0, col: 0, type: 'battle', edges: ['n2'], completed: true },
      { id: 'n2', row: 1, col: 0, type: 'boss', edges: [], completed: false },
    ];
    const states = classifyNodes(nodes, null);
    expect(states.get('n1')).toBe('completed');
    expect(states.get('n2')).toBe('locked'); // no active → no next
  });

  it('handles empty nodes array', () => {
    const states = classifyNodes([], 'nonexistent');
    expect(states.size).toBe(0);
  });

  it('returns empty Map for null input', () => {
    const states = classifyNodes(null, 'x');
    expect(states).toBeInstanceOf(Map);
    expect(states.size).toBe(0);
  });

  it('returns empty Map for undefined input', () => {
    const states = classifyNodes(undefined, 'x');
    expect(states).toBeInstanceOf(Map);
    expect(states.size).toBe(0);
  });
});

// --- CampaignMapOverlay ---

describe('CampaignMapOverlay', () => {
  it('show() creates objects and sets visible', () => {
    const scene = makeScene();
    const nodeMap = makeNodeMap();
    const overlay = new CampaignMapOverlay(scene, {
      nodeMap,
      currentNodeId: 'act1_0_2',
      actId: 'act1',
      activeNodeId: 'act1_1_1',
      onClose: vi.fn(),
    });

    overlay.show();
    expect(overlay.visible).toBe(true);
    expect(overlay.objects.length).toBeGreaterThan(0);
    // Should have circles for nodes + legend dots
    expect(scene.created.circles.length).toBeGreaterThanOrEqual(4); // 4 nodes
  });

  it('hide() destroys objects, calls onClose, sets visible=false', () => {
    const scene = makeScene();
    const nodeMap = makeNodeMap();
    const onClose = vi.fn();
    const overlay = new CampaignMapOverlay(scene, {
      nodeMap,
      currentNodeId: 'act1_0_2',
      actId: 'act1',
      activeNodeId: 'act1_1_1',
      onClose,
    });

    overlay.show();
    const objectCount = overlay.objects.length;
    expect(objectCount).toBeGreaterThan(0);

    overlay.hide();
    expect(overlay.visible).toBe(false);
    expect(overlay.objects).toHaveLength(0);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose if not previously visible', () => {
    const scene = makeScene();
    const onClose = vi.fn();
    const overlay = new CampaignMapOverlay(scene, {
      nodeMap: makeNodeMap(),
      currentNodeId: null,
      actId: 'act1',
      activeNodeId: null,
      onClose,
    });

    overlay.hide(); // never shown
    expect(onClose).not.toHaveBeenCalled();
  });

  it('handles empty nodes array without throwing', () => {
    const scene = makeScene();
    const overlay = new CampaignMapOverlay(scene, {
      nodeMap: { actId: 'act1', nodes: [], startNodeId: null, bossNodeId: null },
      currentNodeId: null,
      actId: 'act1',
      activeNodeId: null,
      onClose: vi.fn(),
    });

    expect(() => overlay.show()).not.toThrow();
    expect(overlay.visible).toBe(true);
  });

  it('handles null nodeMap without throwing', () => {
    const scene = makeScene();
    const overlay = new CampaignMapOverlay(scene, {
      nodeMap: null,
      currentNodeId: null,
      actId: 'act1',
      activeNodeId: null,
      onClose: vi.fn(),
    });

    expect(() => overlay.show()).not.toThrow();
  });

  it('active node gets a pulsing tween', () => {
    const scene = makeScene();
    const nodeMap = makeNodeMap();
    const overlay = new CampaignMapOverlay(scene, {
      nodeMap,
      currentNodeId: 'act1_0_2',
      actId: 'act1',
      activeNodeId: 'act1_1_1',
      onClose: vi.fn(),
    });

    overlay.show();
    expect(scene.tweens.add).toHaveBeenCalled();
  });

  it('"YOU" marker text is created for active node', () => {
    const scene = makeScene();
    const nodeMap = makeNodeMap();
    const overlay = new CampaignMapOverlay(scene, {
      nodeMap,
      currentNodeId: 'act1_0_2',
      actId: 'act1',
      activeNodeId: 'act1_1_1',
      onClose: vi.fn(),
    });

    overlay.show();
    const youTexts = scene.created.texts.filter(
      (t) => typeof t.text === 'string' && t.text.includes('YOU'),
    );
    expect(youTexts.length).toBe(1);
  });

  it('renders title fallback when actId is undefined', () => {
    const scene = makeScene();
    const overlay = new CampaignMapOverlay(scene, {
      nodeMap: { actId: 'act1', nodes: [], startNodeId: null, bossNodeId: null },
      currentNodeId: null,
      actId: undefined,
      activeNodeId: null,
      onClose: vi.fn(),
    });

    expect(() => overlay.show()).not.toThrow();
    const titleTexts = scene.created.texts.filter(
      (t) => typeof t.text === 'string' && t.text === 'Campaign Map',
    );
    expect(titleTexts.length).toBe(1);
  });

  it('title shows act name from ACT_CONFIG', () => {
    const scene = makeScene();
    const overlay = new CampaignMapOverlay(scene, {
      nodeMap: makeNodeMap(),
      currentNodeId: null,
      actId: 'act2',
      activeNodeId: null,
      onClose: vi.fn(),
    });

    overlay.show();
    const titleTexts = scene.created.texts.filter(
      (t) => typeof t.text === 'string' && t.text.includes('Act 2'),
    );
    expect(titleTexts.length).toBe(1);
    expect(titleTexts[0].text).toContain('Occupied Territory');
  });
});

// --- PauseOverlay button count ---

describe('PauseOverlay campaign map button', () => {
  // We need a minimal Phaser mock for PauseOverlay too
  it('adds Campaign Map button when campaignMapData is provided', async () => {
    // Dynamically import to avoid Phaser import issues at module level
    vi.mock('phaser', () => ({ default: { Scene: class {} } }));

    const { PauseOverlay } = await import('../src/ui/PauseOverlay.js');

    const scene = makeScene();
    const campaignMapData = {
      nodeMap: makeNodeMap(),
      currentNodeId: 'act1_0_2',
      actId: 'act1',
      activeNodeId: 'act1_1_1',
    };

    // With campaign map data: Resume + Settings + More Info + Campaign Map + Save + Abandon = 6
    const overlay = new PauseOverlay(scene, {
      onResume: vi.fn(),
      onSaveAndExit: vi.fn(),
      onAbandon: vi.fn(),
      campaignMapData,
    });
    overlay.show();

    const buttonTexts = scene.created.texts
      .filter((t) => typeof t.text === 'string')
      .map((t) => t.text);
    expect(buttonTexts).toContain('Campaign Map');
  });

  it('does not add Campaign Map button when campaignMapData is null', async () => {
    vi.mock('phaser', () => ({ default: { Scene: class {} } }));

    const { PauseOverlay } = await import('../src/ui/PauseOverlay.js');

    const scene = makeScene();
    const overlay = new PauseOverlay(scene, {
      onResume: vi.fn(),
      onSaveAndExit: vi.fn(),
      onAbandon: vi.fn(),
    });
    overlay.show();

    const buttonTexts = scene.created.texts
      .filter((t) => typeof t.text === 'string')
      .map((t) => t.text);
    expect(buttonTexts).not.toContain('Campaign Map');
  });
});
