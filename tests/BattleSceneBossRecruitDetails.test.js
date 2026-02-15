import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateBossRecruitCandidatesMock } = vi.hoisted(() => ({
  generateBossRecruitCandidatesMock: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/BossRecruitSystem.js', async () => {
  const actual = await vi.importActual('../src/engine/BossRecruitSystem.js');
  return {
    ...actual,
    generateBossRecruitCandidates: generateBossRecruitCandidatesMock,
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    setOrigin() { return this; },
    setDepth() { return this; },
    setInteractive() { return this; },
    setStrokeStyle() { return this; },
    on(event, cb) { this.handlers[event] = cb; return this; },
    destroy() {},
  };
}

function makeScene(textCalls) {
  const scene = new BattleScene();
  scene.registry = {
    get: () => null,
  };
  scene.cameras = {
    main: { centerX: 320, centerY: 240, width: 640, height: 480 },
  };
  scene.add = {
    rectangle: () => makeDisplayObject(),
    text: (...args) => {
      textCalls.push(args);
      return makeDisplayObject();
    },
  };
  scene.runManager = {
    currentAct: 'act2',
    roster: [],
    getEffectiveMetaEffects: () => ({}),
  };
  scene.gameData = {};
  return scene;
}

describe('BattleScene boss recruit card details', () => {
  beforeEach(() => {
    generateBossRecruitCandidatesMock.mockReset();
  });

  it('shows compact comparison details (core stats, MOV, weapon signal, skill)', () => {
    generateBossRecruitCandidatesMock.mockReturnValue([
      {
        isLord: false,
        displayName: 'Rhea',
        unit: {
          name: 'Rhea',
          className: 'Wyvern Rider',
          level: 10,
          mov: 8,
          stats: {
            HP: 32,
            STR: 14,
            MAG: 3,
            SPD: 12,
            DEF: 11,
            RES: 6,
          },
          proficiencies: [
            { type: 'Lance', rank: 'Prof' },
            { type: 'Axe', rank: 'Adept' },
          ],
          skills: ['Adept'],
        },
      },
    ]);

    const textCalls = [];
    const scene = makeScene(textCalls);

    BattleScene.prototype.showBossRecruitScreen.call(scene);

    const labels = textCalls.map((call) => call[2]).filter((text) => typeof text === 'string');
    expect(labels.some((text) => text.includes('HP 32 STR 14 SPD 12'))).toBe(true);
    expect(labels.some((text) => text.includes('DEF 11 RES 6 MOV 8'))).toBe(true);
    expect(labels.some((text) => text.includes('Wpn: Lnc(P) Axe(A)'))).toBe(true);
    expect(labels.some((text) => text.includes('Skill: Adept'))).toBe(true);
  });
});
