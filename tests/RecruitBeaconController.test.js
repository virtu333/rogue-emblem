// RecruitBeaconController: the recruit battle's banner follows scene.npcUnits and is
// pure rendering (docs/specs/strategy-layer.md). It never opens a dialog: the recruit is
// introduced by the Guidance field note guide_recruit_on_map (tests/Guidance.test.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ui/HintDisplay.js', () => ({
  showMinorHint: vi.fn(() => Promise.resolve()),
  showImportantHint: vi.fn(() => Promise.resolve(true)),
  showContextualHint: vi.fn(() => false),
}));

import * as RecruitBeacon from '../src/ui/RecruitBeaconController.js';
import {
  RecruitBeaconController,
  RECRUIT_BEACON_DEPTH,
  recruitObjectiveLine,
} from '../src/ui/RecruitBeaconController.js';
import { showContextualHint, showImportantHint, showMinorHint } from '../src/ui/HintDisplay.js';

beforeEach(() => {
  showMinorHint.mockClear();
  showImportantHint.mockClear();
  showContextualHint.mockClear();
});

const noHints = () => {
  expect(showMinorHint).not.toHaveBeenCalled();
  expect(showImportantHint).not.toHaveBeenCalled();
  expect(showContextualHint).not.toHaveBeenCalled();
};

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
  it('marks the recruit and names them in the objective, without opening a dialog', () => {
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
    expect(scene.tweens.add).toHaveBeenCalledTimes(1);
    // Playtest 4: the old intro note was a >12-word minor hint, i.e. a modal "Field
    // notes" dialog at the start of every recruit battle, even with helpers off.
    noHints();
    expect(RecruitBeacon.recruitIntroHint).toBeUndefined();
  });

  it('opens no dialog in any recruit battle: fresh, resumed, tutorial or repeated', () => {
    for (const setup of [
      () => {},
      (s) => (s._resumeCheckpoint = {}),
      (s) => (s.battleParams.tutorialMode = true),
    ]) {
      const scene = makeScene([npc()]);
      setup(scene);
      const beacon = new RecruitBeaconController(scene);
      beacon.create();
      beacon.sync();
      beacon.destroy();
      new RecruitBeaconController(scene).create(); // the next recruit battle
    }
    noHints();
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

  it('still marks a resumed battle and draws nothing without a recruit', () => {
    const resumed = makeScene([npc()]);
    resumed._resumeCheckpoint = {};
    new RecruitBeaconController(resumed).create();
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

  it('builds the objective line from the recruit', () => {
    expect(recruitObjectiveLine(null)).toBeNull();
    expect(recruitObjectiveLine(npc({ name: 'Ada' }))).toBe(
      'Recruit: reach Ada with a lord · Talk',
    );
  });
});
