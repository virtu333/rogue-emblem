// The Act 1 follow-through (docs/specs/prologue-chapter.md §7): what the prologue can
// only introduce, taught again at the point of use in a real run, once per save slot,
// filtered by the Guidance setting's tiers, never in the prologue (its own lessons stand
// in, and mark the same ids read), and never over its subject.
//   guide_first_shop / guide_first_church  the first market / church: its status line
//   guide_prepare            the first route map after a battle that left someone below
//                            half HP: HP carries, staves refill, consumables don't
//   guide_objective_changed  a seize map's boss fell: the throne is the goal (points at it)
//   guide_specialist_*       the first Dancer / flyer picked: its one job
//   guide_armor              the first blade forecast on armour: on the forecast itself
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));
const { domHost, notes, menus } = vi.hoisted(() => ({
  domHost: { on: true },
  notes: [],
  menus: [],
}));
vi.mock('../src/utils/domUI.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasDOMHost: () => domHost.on,
}));
vi.mock('../src/ui/GuidanceNote.js', () => ({
  showGuidanceNote: vi.fn((_scene, { id }) => {
    const handle = { id, isRead: () => false, readFor: () => {}, close: vi.fn() };
    notes.push(handle);
    return handle;
  }),
}));
vi.mock('../src/ui/ShopMenu.js', () => ({
  ShopMenu: class {
    constructor() {
      this.lines = [];
      menus.push(this);
    }
    render(message) {
      if (message != null) this.lines.push(message);
    }
    destroy() {}
  },
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => true),
  showMinorHint: vi.fn(async () => true),
}));

import { showMinorHint } from '../src/ui/HintDisplay.js';
import { GuidanceController } from '../src/ui/GuidanceController.js';
import { AttackFlowController } from '../src/ui/AttackFlowController.js';
import { ShopController } from '../src/ui/ShopController.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { canShowRunNote, guidanceLevelOf } from '../src/ui/guidanceGate.js';
import {
  GUIDANCE_NOTES,
  guidanceText,
  isArmoredFoe,
  specialistJob,
} from '../src/engine/Guidance.js';
import { PROLOGUE_SERVICE_LINES } from '../src/data/prologueContent.js';
import { TUTORIAL_HINT_IDS } from '../src/ui/prologueLessons.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const FOLLOW_THROUGH = [
  'guide_first_shop',
  'guide_first_church',
  'guide_prepare',
  'guide_objective_changed',
  'guide_specialist_dance',
  'guide_specialist_flyer',
  'guide_armor',
];

function slot({ guidance = 'full', hintsOn = true, runsCompleted = 0 } = {}) {
  const seen = new Set();
  const hints = {
    hasSeen: (id) => seen.has(id),
    markSeen: vi.fn((id) => seen.add(id)),
    shouldShow: () => false,
  };
  const settings = { getHints: () => hintsOn, getGuidance: () => guidance };
  const meta = { runsCompleted };
  return { hints, settings, meta, registry: { get: (k) => ({ hints, settings, meta })[k] } };
}

beforeEach(() => {
  domHost.on = true;
  notes.length = 0;
  menus.length = 0;
  vi.clearAllMocks();
});

describe('the notes', () => {
  it('are essential (Full and Light), and a finished prologue never stands in for them silently', () => {
    for (const id of FOLLOW_THROUGH) expect(GUIDANCE_NOTES[id]?.tier, id).toBe('essential');
    // The prologue marks only what it teaches as read: its seize gate and none of the rest.
    expect(TUTORIAL_HINT_IDS.has('guide_objective_changed')).toBe(true);
    for (const id of ['guide_prepare', 'guide_specialist_dance', 'guide_armor'])
      expect(TUTORIAL_HINT_IDS.has(id), id).toBe(false);
  });

  it('say what the spec says', () => {
    expect(guidanceText('guide_armor', { knight: true })).toBe(
      'Knights shrug off swords. Magic hits RES.',
    );
    expect(guidanceText('guide_prepare', { hurt: { name: 'Bram' } })).toBe(
      "Bram ended that battle badly hurt. HP carries between battles: staves refill, consumables don't. Roster › Item heals now, or a church or ruins Rest heals everyone.",
    );
    expect(guidanceText('guide_specialist_dance', { unit: { name: 'Lyre' } })).toMatch(
      /^Lyre dances: move next to an ally who has already acted and choose Dance/,
    );
    expect(guidanceText('guide_specialist_flyer', { unit: { name: 'Wren' } })).toMatch(
      /water, mountains and forest cost one step/,
    );
    expect(
      guidanceText('guide_objective_changed', { objective: 'seize', boss: 'Iron Captain' }),
    ).toBe(
      'Iron Captain has fallen. The objective is the throne now: move a Lord onto it (the SEIZE tile) and choose Seize.',
    );
  });
});

describe('guidanceGate (route map, shops, churches)', () => {
  it('a real run, unseen, its tier allowed; never the prologue run, Off, or hints off', () => {
    const real = { runManager: { mode: 'standard' }, ...slot() };
    expect(canShowRunNote(real, 'guide_prepare')).toBe(true);
    expect(canShowRunNote({ ...real, runManager: { mode: 'prologue' } }, 'guide_prepare')).toBe(
      false,
    );
    expect(canShowRunNote({ ...real, ...slot({ guidance: 'off' }) }, 'guide_prepare')).toBe(false);
    expect(canShowRunNote({ ...real, ...slot({ hintsOn: false }) }, 'guide_prepare')).toBe(false);
    expect(canShowRunNote({ ...real, ...slot({ guidance: 'light' }) }, 'guide_prepare')).toBe(true);
    expect(guidanceLevelOf({ ...slot({ guidance: 'auto', runsCompleted: 2 }) })).toBe('light'); // a veteran's auto
    real.hints.markSeen('guide_prepare');
    expect(canShowRunNote(real, 'guide_prepare')).toBe(false);
  });
});

function shopScene({ mode = 'standard', guidance = 'full' } = {}) {
  const s = slot({ guidance });
  return {
    ...s,
    gameData: { ...gameData, dialogue: { shopFlavor: { act1: ['flavor line'] } } },
    runManager: {
      mode,
      currentAct: 'act1',
      roster: [],
      gold: 500,
      consumeSkipFirstShop: () => false,
      getShopState: () => null,
      saveShopState: vi.fn(),
      getShopItemCountDelta: () => 0,
      getWeaponArtSpawnConfig: () => null,
      difficultyModifiers: {},
      markNodeComplete: vi.fn(),
    },
    shopRerollCount: 0,
    applyDifficultyShopPricing: (items) => items,
    applyRuinsMarkup: (items) => items,
    applyAmbushDiscount: (items) => items,
    checkActComplete: vi.fn(),
    _isPendingAmbushNode: () => false,
  };
}

/** The controller with the route map's delegation to it (NodeMapScene.showShopOverlay). */
function shopController(scene) {
  const ctrl = new ShopController(scene);
  scene.showShopOverlay = (...args) => ctrl.showShopOverlay(...args);
  return ctrl;
}

describe('guide_first_shop: the first market says what a shop is, as its status line', () => {
  it('once per slot in a real run; the flavor line after', () => {
    const scene = shopScene();
    const ctrl = shopController(scene);
    ctrl.handleShop({ id: 'n1', type: 'shop' });
    expect(menus.at(-1).lines).toEqual([guidanceText('guide_first_shop')]);
    expect(scene.hints.markSeen).toHaveBeenCalledWith('guide_first_shop');
    ctrl.handleShop({ id: 'n2', type: 'shop' });
    expect(menus.at(-1).lines).toEqual(['flavor line']);
  });

  it('Guidance Off keeps the flavor line; the prologue market teaches it and marks it read', () => {
    const off = shopScene({ guidance: 'off' });
    shopController(off).handleShop({ id: 'n1', type: 'shop' });
    expect(menus.at(-1).lines).toEqual(['flavor line']);
    const prologue = shopScene({ mode: 'prologue' });
    shopController(prologue).handleShop({ id: 'prologue_2a', type: 'shop', prologueStock: ['Vulnerary'] }); // prettier-ignore
    expect(menus.at(-1).lines).toEqual([PROLOGUE_SERVICE_LINES.shop]);
    expect(prologue.hints.hasSeen('guide_first_shop')).toBe(true);
  });
});

describe('guide_prepare: the route map after a battle that left someone below half HP', () => {
  const unit = (name, hp, max = 20) => ({ name, currentHP: hp, stats: { HP: max } });
  const mapScene = (
    roster,
    { completedBattles = 1, mode = 'standard', guidance = 'full' } = {},
  ) => ({
    ...slot({ guidance }),
    runManager: { mode, completedBattles, roster },
    sys: { isActive: () => true },
    _sceneLifecycleGeneration: 1,
  });

  it('names the most hurt unit under half HP; nobody, or before any battle, no note', () => {
    const pick = (scene) => NodeMapScene.prototype._preparationNoteUnit.call(scene);
    expect(pick(mapScene([unit('Edric', 9), unit('Bram', 4), unit('Ivy', 11)]))).toEqual({ name: 'Bram' }); // prettier-ignore
    expect(pick(mapScene([unit('Edric', 10), unit('Bram', 12)]))).toBeNull(); // half is not below
    expect(pick(mapScene([unit('Edric', 2)], { completedBattles: 0 }))).toBeNull();
    expect(pick(mapScene([unit('Edric', 2)], { mode: 'prologue' }))).toBeNull();
  });

  it('shows once per slot, after the route note, and honours Guidance Off', async () => {
    const show = async (scene, pending) => {
      scene._pendingNodeMapHints = pending;
      await NodeMapScene.prototype._showPendingNodeMapHints.call(scene, 1);
    };
    const scene = mapScene([unit('Edric', 3)]);
    await show(scene, { prepareFor: { name: 'Edric' } });
    expect(showMinorHint).toHaveBeenCalledWith(
      scene,
      guidanceText('guide_prepare', { hurt: { name: 'Edric' } }),
    );
    expect(scene.hints.hasSeen('guide_prepare')).toBe(true);
    vi.mocked(showMinorHint).mockClear();
    await show(scene, { prepareFor: { name: 'Edric' } });
    expect(showMinorHint).not.toHaveBeenCalled();
    // The route map's own first-visit note goes first; this one waits for a later visit.
    const first = mapScene([unit('Edric', 3)]);
    await show(first, { showIntro: true, prepareFor: { name: 'Edric' } });
    expect(first.hints.hasSeen('guide_prepare')).toBe(false);
    const off = mapScene([unit('Edric', 3)], { guidance: 'off' });
    vi.mocked(showMinorHint).mockClear();
    await show(off, { prepareFor: { name: 'Edric' } });
    expect(showMinorHint).not.toHaveBeenCalled();
  });
});

function battleScene({ guidance = 'full', ...overrides } = {}) {
  const s = slot({ guidance });
  const edric = { name: 'Edric', faction: 'player', isCommander: true, isLord: true, col: 1, row: 1, currentHP: 20, stats: { HP: 20, DEF: 5 }, proficiencies: [{ type: 'Sword' }], inventory: [] }; // prettier-ignore
  const scene = {
    _battleSession: 1,
    ...s,
    battleParams: {},
    battleState: 'PLAYER_IDLE',
    selectedUnit: null,
    turnManager: { currentPhase: 'player', turnNumber: 3 },
    playerUnits: [edric],
    enemyUnits: [],
    npcUnits: [],
    grid: { fogEnabled: false },
    isMobileInput: true,
    findAttackTargets: () => [],
    battleConfig: { objective: 'rout' },
    ...overrides,
  };
  s.hints.markSeen('guide_first_turn');
  return { scene, edric, g: new GuidanceController(scene) };
}

describe('guide_objective_changed: the boss of a seize map fell', () => {
  const seize = (bossHP) => ({
    battleConfig: { objective: 'seize', thronePos: { col: 7, row: 0 } },
    enemyUnits: [{ name: 'Iron Captain', faction: 'enemy', isBoss: true, currentHP: bossHP, col: 7, row: 0 }], // prettier-ignore
    _bossName: 'Iron Captain',
  });

  it('points at the throne once the boss is down and a lord stands; once per slot', () => {
    const { g, scene } = battleScene(seize(0));
    const pick = g.pick();
    expect(pick).toMatchObject({ id: 'guide_objective_changed', anchor: { col: 7, row: 0 } });
    expect(guidanceText(pick.id, pick.context)).toMatch(/^Iron Captain has fallen\. The objective is the throne/); // prettier-ignore
    scene.hints.markSeen('guide_objective_changed');
    expect(g.pick()).toBeNull();
  });

  it('not while the boss lives, not on a rout map, not without a lord, not scripted, not Off', () => {
    expect(battleScene(seize(10)).g.pick()).toBeNull();
    expect(battleScene({ ...seize(0), battleConfig: { objective: 'rout' } }).g.pick()).toBeNull();
    const lordless = battleScene(seize(0));
    lordless.edric.isLord = false;
    expect(lordless.g.pick()).toBeNull();
    const scripted = battleScene(seize(0));
    scripted.scene.battleParams.prologueChapter = 'p4_quarry_gate';
    expect(scripted.g.pick()).toBeNull();
    expect(battleScene({ ...seize(0), guidance: 'off' }).g.pick()).toBeNull();
    expect(battleScene({ ...seize(0), guidance: 'light' }).g.pick()?.id).toBe('guide_objective_changed'); // prettier-ignore
  });
});

describe('guide_specialist_*: a specialist picked for the first time', () => {
  const dancer = { name: 'Lyre', faction: 'player', className: 'Dancer', skills: ['dance'], col: 2, row: 2, currentHP: 16, stats: { HP: 16, DEF: 3 }, proficiencies: [{ type: 'Sword' }], inventory: [] }; // prettier-ignore
  const flyer = { name: 'Wren', faction: 'player', className: 'Pegasus Knight', moveType: 'Flying', skills: [], col: 3, row: 2, currentHP: 18, stats: { HP: 18, DEF: 5 }, proficiencies: [{ type: 'Lance' }], inventory: [] }; // prettier-ignore

  it('reads the job from the unit: Dance, or flight', () => {
    expect(specialistJob(dancer)).toBe('dance');
    expect(specialistJob(flyer)).toBe('flyer');
    expect(specialistJob({ ...flyer, faction: 'enemy' })).toBeNull();
    expect(specialistJob({ name: 'Bram', faction: 'player', skills: [] })).toBeNull();
  });

  it('on selection, once per slot each; not once it acted, not scripted, not Off', () => {
    const run = (unit, extra = {}) => {
      const u = structuredClone(unit);
      const b = battleScene({ battleState: 'UNIT_SELECTED', selectedUnit: u, ...extra });
      b.scene.playerUnits.push(u);
      return { ...b, u };
    };
    const d = run(dancer);
    expect(d.g.pick()).toMatchObject({ id: 'guide_specialist_dance', anchor: d.u });
    d.scene.hints.markSeen('guide_specialist_dance');
    expect(d.g.pick()).toBeNull();
    const f = run(flyer);
    expect(f.g.pick()).toMatchObject({ id: 'guide_specialist_flyer', anchor: f.u });
    const acted = run(flyer);
    acted.u.hasActed = true;
    expect(acted.g.pick()).toBeNull();
    const scripted = run(dancer);
    scripted.scene.battleParams.prologueChapter = 'p4_quarry_gate';
    expect(scripted.g.pick()).toBeNull();
    expect(run(dancer, { guidance: 'off' }).g.pick()).toBeNull();
  });
});

describe('guide_armor: the first blade forecast on armour, on the forecast itself', () => {
  const sword = gameData.weapons.find((w) => w.name === 'Iron Sword');
  const fire = gameData.weapons.find((w) => w.name === 'Fire');
  const knight = { name: 'Knight', faction: 'enemy', className: 'Knight', moveType: 'Armored', stats: { DEF: 11, RES: 1 } }; // prettier-ignore
  const brute = { name: 'Brute', faction: 'enemy', className: 'Fighter', moveType: 'Infantry', stats: { DEF: 10, RES: 2 } }; // prettier-ignore
  const plain = { name: 'Soldier', faction: 'enemy', className: 'Soldier', moveType: 'Infantry', stats: { DEF: 6, RES: 1 } }; // prettier-ignore
  const attacker = { name: 'Edric', faction: 'player' };
  const lesson = (scene, defender, weapon) =>
    AttackFlowController.prototype.armorLesson.call({ scene }, attacker, defender, weapon);

  it('who counts as armour: Armored, or DEF well above RES', () => {
    expect(isArmoredFoe(knight)).toBe(true);
    expect(isArmoredFoe(brute)).toBe(true);
    expect(isArmoredFoe(plain)).toBe(false);
    expect(isArmoredFoe({ ...knight, faction: 'player' })).toBe(false);
  });

  it('a Knight: the spec line; other armour: its DEF and RES; magic or plain foes: nothing', () => {
    const { scene, g } = battleScene();
    scene._guidance = g;
    expect(lesson(scene, knight, sword)).toBe('Knights shrug off swords. Magic hits RES.');
    expect(lesson(scene, brute, sword)).toBe(
      'Armour shrugs off blades: Brute has DEF 10, RES 2. Magic hits RES.',
    );
    expect(lesson(scene, knight, fire)).toBeNull();
    expect(lesson(scene, plain, sword)).toBeNull();
  });

  it('once per slot (read on Confirm or Cancel), never scripted, never Off', () => {
    const { scene, g } = battleScene();
    scene._guidance = g;
    scene.hints.markSeen('guide_armor');
    expect(lesson(scene, knight, sword)).toBeNull();
    const scripted = battleScene();
    scripted.scene._guidance = scripted.g;
    scripted.scene.battleParams.prologueChapter = 'p4_quarry_gate';
    expect(lesson(scripted.scene, knight, sword)).toBeNull();
    const off = battleScene({ guidance: 'off' });
    off.scene._guidance = off.g;
    expect(lesson(off.scene, knight, sword)).toBeNull();
  });
});
