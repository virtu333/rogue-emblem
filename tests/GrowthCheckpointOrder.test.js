// Checkpoint safety for the growth ceremonies: every path commits (and
// checkpoints / saves) its gains BEFORE the ceremony shows, so a refresh
// mid-ceremony can never lose or repeat a stat gain, skill, promotion or cost.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));
vi.mock('../src/ui/BossRecruitOverlay.js', () => ({
  BossRecruitOverlay: class {
    constructor() {
      this.displayObjects = [];
    }
    show(onComplete) {
      onComplete(globalThis.__growthRecruit);
    }
  },
}));
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { GrowthCeremonyController } from '../src/ui/GrowthCeremonyController.js';
import { PromotionController } from '../src/ui/PromotionController.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { ChurchMenu } from '../src/ui/ChurchMenu.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { ColosseumOverlay } from '../src/ui/ColosseumOverlay.js';
import { ArenaMenu } from '../src/ui/ArenaMenu.js';
import { createLordUnit, createRecruitUnit } from '../src/engine/UnitManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { CHURCH_PROMOTE_COST } from '../src/utils/constants.js';

const gameData = loadGameData();
const cls = (name) => gameData.classes.find((c) => c.name === name);

function eventsFor() {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    once: (name, fn) => listeners(name).add(fn),
    on: (name, fn) => listeners(name).add(fn),
    off: (name, fn) => listeners(name).delete(fn),
    emit: (name) => {
      const fns = [...listeners(name)];
      listeners(name).clear();
      for (const fn of fns) fn();
    },
  };
}

let riteSpy;
let seen;
beforeEach(() => {
  vi.useFakeTimers();
  installFakeDom(vi);
  _resetInputFocus();
  seen = [];
  riteSpy = vi
    .spyOn(GrowthCeremonyController.prototype, 'showPromotionRite')
    .mockImplementation(async function ({ unit, content }) {
      seen.push({ unit, content, at: this.snapshot?.() });
      return true;
    });
});
afterEach(() => {
  riteSpy.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
  vi.clearAllMocks();
});

describe('battle Master Seal', () => {
  it('promotes, spends the seal and captures the resolved action before the rite', async () => {
    const unit = createRecruitUnit({ name: 'Ilse', level: 10 }, cls('Myrmidon'), gameData.weapons);
    unit.level = 10;
    const seal = structuredClone(gameData.consumables.find((i) => i.effect === 'promote'));
    unit.consumables = [seal];
    const order = [];
    const scene = {
      gameData,
      events: eventsFor(),
      registry: { get: () => null },
      textures: { exists: () => false },
      sys: { isActive: () => true },
      showActionMenu: vi.fn(),
      removeUnitGraphic: vi.fn(),
      addUnitGraphic: vi.fn(),
      updateHPBar: vi.fn(),
      finishUnitAction: vi.fn(() => order.push('finish')),
      showBriefBanner: vi.fn(),
      _captureSuspendCheckpoint: vi.fn(() =>
        order.push({ checkpoint: unit.className, seal: unit.consumables.length }),
      ),
    };
    riteSpy.mockImplementation(async ({ content }) => {
      order.push({ rite: content.toClass, classNow: unit.className, seals: unit.consumables.length, pending: scene._pendingActionCompletion?.kind }); // prettier-ignore
      return true;
    });
    // Two paths: the chooser picks Duelist.
    const { PromotionChoicePanel } = await import('../src/ui/PromotionChoicePanel.js');
    const choose = vi
      .spyOn(PromotionChoicePanel.prototype, 'show')
      .mockResolvedValue(cls('Duelist'));
    const ok = await new PromotionController(scene).executePromotion(unit, seal);
    choose.mockRestore();
    expect(ok).toBe(true);
    expect(order).toEqual([
      { checkpoint: 'Duelist', seal: 0 },
      { rite: 'Duelist', classNow: 'Duelist', seals: 0, pending: 'finish' },
      'finish',
    ]);
    // The rite's content carries the before values (projected pre-promotion).
    const content = riteSpy.mock.calls[0][0].content;
    expect(content.fromClass).toBe('Myrmidon');
    expect(riteSpy.mock.calls[0][0].beforeUnit.className).toBe('Myrmidon');
  });
});

describe('church', () => {
  it('spends gold, promotes and saves before the rite; never twice', async () => {
    const edric = createLordUnit(gameData.lords.find((l) => l.name === 'Edric'), gameData.classes, gameData.weapons); // prettier-ignore
    edric.level = 10;
    const order = [];
    const run = {
      roster: [edric],
      fallenUnits: [],
      gold: 10000,
      getDifficultyModifier: (_k, d) => d,
      getChurchPromotionCount: () => 0,
      setChurchPromotionCount: vi.fn(),
      spendGold(n) {
        this.gold -= n;
        return true;
      },
    };
    vi.mocked(saveServiceRun).mockImplementation(() => {
      order.push({ save: edric.className, gold: run.gold });
      return '';
    });
    riteSpy.mockImplementation(async () => {
      order.push({ rite: edric.className, gold: run.gold });
      return true;
    });
    const scene = {
      gameData,
      runManager: run,
      events: eventsFor(),
      registry: { get: () => null },
      textures: { exists: () => false },
      _churchNode: { id: 'church-1' },
    };
    const menu = new ChurchMenu({ scene, leaveChurchNode: vi.fn() });
    menu.promote(edric, 'church-1');
    const chooser = menu.child;
    expect(chooser.surface.root.getAttribute('aria-label')).toBe('Promote Edric');
    await chooser.confirm();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([
      { save: 'Great Lord', gold: 10000 - CHURCH_PROMOTE_COST },
      { rite: 'Great Lord', gold: 10000 - CHURCH_PROMOTE_COST },
    ]);
    expect(riteSpy).toHaveBeenCalledTimes(1);
    expect(riteSpy.mock.calls[0][0].frame).toBe('screen');
    menu.destroy();
  });
});

describe('roster Master Seal', () => {
  it('persists through the context before the rite (rewards pass their own persist)', async () => {
    const unit = createRecruitUnit({ name: 'Ilse', level: 10 }, cls('Myrmidon'), gameData.weapons);
    unit.level = 10;
    const seal = structuredClone(gameData.consumables.find((i) => i.effect === 'promote'));
    unit.consumables = [seal];
    const order = [];
    const persist = vi.fn(() => {
      order.push({ persist: unit.className, seals: unit.consumables.length });
      return true;
    });
    riteSpy.mockImplementation(async () => {
      order.push({ rite: unit.className });
      return true;
    });
    const scene = {
      gameData,
      events: eventsFor(),
      registry: { get: () => null },
      textures: { exists: () => false },
      sys: { settings: { key: 'Battle' } },
    };
    const sheet = new MobileRosterSheet({
      scene,
      units: [unit],
      run: { roster: [unit] },
      gameData,
      persist,
      onClose: vi.fn(),
    });
    sheet.changeClass(unit, seal);
    const chooser = sheet.picker;
    chooser.selected = cls('Swordmaster');
    await chooser.confirm();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([{ persist: 'Swordmaster', seals: 0 }, { rite: 'Swordmaster' }]);
    sheet.destroy();
  });
});

describe('boss recruit', () => {
  it('saves the joined unit before the card, then moves on to the loot screen', async () => {
    const recruit = createRecruitUnit({ name: 'Astrid', level: 1 }, cls('Sky Lancer'), gameData.weapons); // prettier-ignore
    globalThis.__growthRecruit = recruit;
    const order = [];
    const run = {
      roster: [],
      grantRecruitBlessingConsumables: vi.fn(),
      shouldTriggerThirdLord: () => false,
    };
    const recruitSpy = vi
      .spyOn(GrowthCeremonyController.prototype, 'showRecruit')
      .mockImplementation(async ({ unit, kind }) => {
        order.push({ card: unit.name, kind, inRoster: run.roster.includes(unit) });
        return true;
      });
    const scene = {
      gameData,
      runManager: run,
      events: eventsFor(),
      registry: { get: () => null },
      scene: { isActive: () => true },
      sys: { isActive: () => true },
      _persistBattleRunState: vi.fn(() => order.push({ saved: run.roster.map((u) => u.name) })),
      showLootScreen: vi.fn(() => order.push('loot')),
    };
    new PostCombatController(scene).showBossRecruitScreen();
    await vi.advanceTimersByTimeAsync(0);
    recruitSpy.mockRestore();
    delete globalThis.__growthRecruit;
    expect(order).toEqual([
      { saved: ['Astrid'] },
      { card: 'Astrid', kind: 'boss', inRoster: true },
      'loot',
    ]);
  });
});

describe('colosseum', () => {
  it('arena levels play the level-up card once, after the fight is settled and saved', async () => {
    const order = [];
    const levelSpy = vi
      .spyOn(GrowthCeremonyController.prototype, 'showLevelUp')
      .mockImplementation(async ({ result, frame }) => {
        order.push({ card: result.newLevel, frame });
        return true;
      });
    const resultSpy = vi.spyOn(ArenaMenu, 'result').mockImplementation(() => {
      order.push('result');
      return { destroy() {} };
    });
    const unit = { name: 'Edric', className: 'Lord', stats: { HP: 20, STR: 7 } };
    const settled = {
      reward: { goldDelta: 100, xpGained: 60 },
      levelUpInfo: { from: '4', to: '5', ups: [{ newLevel: 5, gains: { STR: 1 } }], learnedSkills: [] }, // prettier-ignore
    };
    const overlay = Object.assign(Object.create(ColosseumOverlay.prototype), {
      scene: { events: eventsFor(), registry: { get: () => null }, gameData },
      gameData,
      visible: true,
      _selectedUnit: unit,
      _settleFight: () => {
        order.push('settled+saved');
        return settled;
      },
      _clearScreen: () => {},
    });
    overlay._showResult('win', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['settled+saved', { card: 5, frame: 'screen' }, 'result']);
    // Re-showing the same settled result never replays the card.
    overlay._showResult('win', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(levelSpy).toHaveBeenCalledTimes(1);
    levelSpy.mockRestore();
    resultSpy.mockRestore();
  });
});
