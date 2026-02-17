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
    x: 0,
    y: 0,
    width: 0,
    height: 14,
    depth: 0,
    originX: 0,
    originY: 0,
    list: null,
    ...seed,
    handlers: {},
    setOrigin(x = 0, y = x) { this.originX = x; this.originY = y; return this; },
    setDepth(depth) { this.depth = depth; return this; },
    setInteractive() { this.interactive = true; return this; },
    setStrokeStyle() { return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setScrollFactor() { return this; },
    on(event, cb) { this.handlers[event] = cb; return this; },
    getBounds() {
      const left = this.x - (this.width * this.originX);
      const top = this.y - (this.height * this.originY);
      return {
        left,
        top,
        right: left + this.width,
        bottom: top + this.height,
      };
    },
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
  scene.time = {
    delayedCall: vi.fn((ms, cb) => {
      const timer = {
        ms,
        cb,
        removed: false,
        remove: vi.fn(() => {
          timer.removed = true;
        }),
      };
      scene._testDelayedTimers.push(timer);
      return timer;
    }),
  };
  scene.add = {
    rectangle: (x, y, width, height) => makeDisplayObject({ x, y, width, height }),
    text: (...args) => {
      textCalls.push(args);
      const content = typeof args[2] === 'string' ? args[2] : '';
      const obj = makeDisplayObject({
        x: Number(args[0]) || 0,
        y: Number(args[1]) || 0,
        text: content,
        width: Math.max(1, content.length) * 6,
      });
      scene._testTextObjects.push(obj);
      return obj;
    },
    container: (x, y, children = []) => makeDisplayObject({ x, y, list: children }),
  };
  scene._testTextObjects = [];
  scene._testDelayedTimers = [];
  scene.hideLootRoster = vi.fn();
  scene.showLootScreen = vi.fn();
  scene.runManager = {
    currentAct: 'act2',
    roster: [],
    getEffectiveMetaEffects: () => ({}),
  };
  scene.gameData = {
    classes: [
      { name: 'Wyvern Rider', description: 'A flying juggernaut — tough and strong in the air, but magic cuts deep.' },
    ],
  };
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
    expect(labels.some((text) => text.includes('flying juggernaut'))).toBe(false);

    const nameObj = scene._testTextObjects.find((obj) => obj.text === 'Rhea');
    const classObj = scene._testTextObjects.find((obj) => obj.text === 'Wyvern Rider');
    expect(nameObj?.interactive).toBe(true);
    expect(classObj?.interactive).toBe(true);
    expect(typeof nameObj?.handlers.pointerover).toBe('function');
    expect(typeof nameObj?.handlers.pointerdown).toBe('function');
    expect(typeof nameObj?.handlers.pointerup).toBe('function');
    expect(typeof classObj?.handlers.pointerover).toBe('function');
    expect(typeof classObj?.handlers.pointerdown).toBe('function');
    expect(typeof classObj?.handlers.pointerup).toBe('function');
  });

  it('tap on recruit name/class selects recruit (same flow as card)', () => {
    generateBossRecruitCandidatesMock.mockReturnValue([
      {
        isLord: false,
        displayName: 'Rhea',
        unit: {
          name: 'Rhea',
          className: 'Wyvern Rider',
          level: 10,
          mov: 8,
          stats: { HP: 32, STR: 14, MAG: 3, SPD: 12, DEF: 11, RES: 6 },
          proficiencies: [],
          skills: [],
        },
      },
    ]);

    const textCalls = [];
    const scene = makeScene(textCalls);

    BattleScene.prototype.showBossRecruitScreen.call(scene);
    const classObj = scene._testTextObjects.find((obj) => obj.text === 'Wyvern Rider');
    expect(classObj).toBeTruthy();

    classObj.handlers.pointerdown({ id: 1, x: 10, y: 10 });
    classObj.handlers.pointerup({ id: 1, x: 10, y: 10 });

    expect(scene.runManager.roster).toHaveLength(1);
    expect(scene.runManager.roster[0]?.name).toBe('Rhea');
    expect(scene.hideLootRoster).toHaveBeenCalledTimes(1);
    expect(scene.showLootScreen).toHaveBeenCalledTimes(1);
  });

  it('long-press shows class tooltip above modal and suppresses recruit select', () => {
    generateBossRecruitCandidatesMock.mockReturnValue([
      {
        isLord: false,
        displayName: 'Rhea',
        unit: {
          name: 'Rhea',
          className: 'Wyvern Rider',
          level: 10,
          mov: 8,
          stats: { HP: 32, STR: 14, MAG: 3, SPD: 12, DEF: 11, RES: 6 },
          proficiencies: [],
          skills: [],
        },
      },
    ]);

    const textCalls = [];
    const scene = makeScene(textCalls);

    BattleScene.prototype.showBossRecruitScreen.call(scene);
    const nameObj = scene._testTextObjects.find((obj) => obj.text === 'Rhea');
    expect(nameObj).toBeTruthy();

    nameObj.handlers.pointerdown({ id: 7, x: 120, y: 200 });
    const pressTimer = scene._testDelayedTimers[scene._testDelayedTimers.length - 1];
    expect(pressTimer).toBeTruthy();
    pressTimer.cb();
    nameObj.handlers.pointerup({ id: 7, x: 120, y: 200 });

    expect(scene.runManager.roster).toHaveLength(0);
    expect(scene.showLootScreen).not.toHaveBeenCalled();
    expect(scene._menuTooltip).toBeTruthy();
    expect(scene._menuTooltip?.depth).toBeGreaterThanOrEqual(703);
  });

  it('renders without crash when gameData.classes is missing', () => {
    generateBossRecruitCandidatesMock.mockReturnValue([
      {
        isLord: false,
        displayName: 'Rhea',
        unit: {
          name: 'Rhea',
          className: 'Wyvern Rider',
          level: 10,
          mov: 8,
          stats: { HP: 32, STR: 14, MAG: 3, SPD: 12, DEF: 11, RES: 6 },
          proficiencies: [],
          skills: [],
        },
      },
    ]);

    const textCalls = [];
    const scene = makeScene(textCalls);
    scene.gameData = {}; // no classes array

    expect(() => {
      BattleScene.prototype.showBossRecruitScreen.call(scene);
    }).not.toThrow();

    const labels = textCalls.map((call) => call[2]).filter((text) => typeof text === 'string');
    // No description text should appear
    expect(labels.some((text) => text.includes('flying juggernaut'))).toBe(false);
  });
});
