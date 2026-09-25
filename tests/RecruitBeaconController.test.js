// RecruitBeaconController: the recruit battle's banner follows scene.npcUnits and is
// pure rendering (docs/specs/strategy-layer.md).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/ui/HintDisplay.js', () => ({ showMinorHint: vi.fn(() => Promise.resolve()) }));

import {
  RecruitBeaconController,
  RECRUIT_BEACON_DEPTH,
  recruitObjectiveLine,
  recruitIntroHint,
} from '../src/ui/RecruitBeaconController.js';
import { showMinorHint } from '../src/ui/HintDisplay.js';

function displayObject(kind) {
  const obj = { kind, destroyed: false, depth: 0, name: '' };
  const chain = (fn) =>
    vi.fn((...args) => {
      fn?.(...args);
      return obj;
    });
  obj.setDepth = chain((d) => (obj.depth = d));
  obj.setOrigin = chain();
  obj.setStrokeStyle = chain();
  obj.destroy = vi.fn(() => (obj.destroyed = true));
  return obj;
}

function makeScene(npcs = []) {
  const made = [];
  const add = (kind) =>
    vi.fn(() => {
      const o = displayObject(kind);
      made.push(o);
      return o;
    });
  return {
    made,
    npcUnits: npcs,
    battleParams: {},
    grid: { gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }) },
    add: { rectangle: add('rect'), triangle: add('triangle'), text: add('text') },
    tweens: { add: vi.fn(), killTweensOf: vi.fn() },
    updateObjectiveText: vi.fn(),
    _reduceMotion: () => false,
  };
}

const npc = (over = {}) => ({
  name: 'Garrick',
  className: 'Cavalier',
  col: 3,
  row: 2,
  currentHP: 20,
  ...over,
});

describe('RecruitBeaconController', () => {
  it('marks the recruit, names them in the objective and tells the player once', () => {
    const recruit = npc();
    const scene = makeScene([recruit]);
    const beacon = new RecruitBeaconController(scene);
    beacon.create();
    expect(beacon.npc).toBe(recruit);
    const label = scene.made.find((o) => o.name === 'recruit-beacon-label');
    expect(label).toBeTruthy();
    expect(label.depth).toBe(RECRUIT_BEACON_DEPTH);
    expect(scene.add.text.mock.calls[0][2]).toBe('RECRUIT');
    expect(scene.updateObjectiveText).toHaveBeenCalledTimes(1);
    expect(beacon.getObjectiveSuffix()).toBe('Recruit: reach Garrick with a lord · Talk');
    expect(showMinorHint).toHaveBeenCalledWith(scene, recruitIntroHint(recruit));
    expect(scene.tweens.add).toHaveBeenCalledTimes(1);
  });

  it('follows the recruit and clears the moment they join or fall', () => {
    const recruit = npc();
    const scene = makeScene([recruit]);
    const beacon = new RecruitBeaconController(scene);
    beacon.create();
    const first = [...scene.made];
    beacon.sync();
    expect(scene.made).toHaveLength(first.length); // no rebuild while nothing moved
    recruit.col = 4;
    beacon.sync();
    expect(first.every((o) => o.destroyed)).toBe(true);
    expect(scene.made.length).toBe(first.length * 2);
    recruit.currentHP = 0;
    beacon.sync();
    expect(scene.made.every((o) => o.destroyed)).toBe(true);
    expect(beacon.npc).toBeNull();
    expect(beacon.getObjectiveSuffix()).toBeNull();
  });

  it('is silent on a resumed battle and draws nothing without a recruit', () => {
    showMinorHint.mockClear();
    const resumed = makeScene([npc()]);
    resumed._resumeCheckpoint = {};
    new RecruitBeaconController(resumed).create();
    expect(showMinorHint).not.toHaveBeenCalled();
    expect(resumed.made.length).toBeGreaterThan(0);

    const empty = makeScene([]);
    const beacon = new RecruitBeaconController(empty);
    beacon.create();
    expect(empty.made).toHaveLength(0);
    expect(empty.updateObjectiveText).not.toHaveBeenCalled();
    beacon.destroy();
    expect(beacon.scene).toBeNull();
  });

  it('skips the halo pulse under reduced motion', () => {
    const scene = makeScene([npc()]);
    scene._reduceMotion = () => true;
    new RecruitBeaconController(scene).create();
    expect(scene.tweens.add).not.toHaveBeenCalled();
  });

  it('builds the objective and hint lines from the recruit', () => {
    expect(recruitObjectiveLine(null)).toBeNull();
    expect(recruitIntroHint(npc({ name: 'Ada', className: 'Mage' }))).toMatch(
      /^Ada \(Mage\) holds out under the gold banner\./,
    );
  });
});
