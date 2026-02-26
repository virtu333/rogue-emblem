import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/ColosseumEngine.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, generateMercenaryCandidates: vi.fn(mod.generateMercenaryCandidates) };
});

import { ColosseumOverlay } from '../src/ui/ColosseumOverlay.js';
import { getAvailableTiers, generateMercenaryCandidates } from '../src/engine/ColosseumEngine.js';
import { createRecruitUnit, getDisplayLevel } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';
import { ROSTER_CAP } from '../src/utils/constants.js';

function makeDisplayObject(seed = {}) {
  return {
    kind: 'display',
    destroyed: false,
    active: true,
    visible: true,
    interactive: false,
    input: null,
    handlers: {},
    style: {},
    ...seed,
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setAlpha(alpha) {
      this.alpha = alpha;
      return this;
    },
    setColor(color) {
      this.style = { ...this.style, color };
      return this;
    },
    setBackgroundColor(backgroundColor) {
      this.style = { ...this.style, backgroundColor };
      return this;
    },
    setInteractive(options) {
      this.interactive = true;
      this._interactiveOptions = options || null;
      this.input = { enabled: true };
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy() {
      this.destroyed = true;
      this.active = false;
      if (this.input) this.input.enabled = false;
    },
  };
}

function makeScene() {
  const objects = [];
  const timers = [];
  return {
    add: {
      rectangle: (x, y, width, height, color, alpha) => {
        const obj = makeDisplayObject({
          kind: 'rectangle',
          x,
          y,
          width,
          height,
          color,
          alpha,
        });
        objects.push(obj);
        return obj;
      },
      text: (x, y, text, style = {}) => {
        const obj = makeDisplayObject({
          kind: 'text',
          x,
          y,
          text,
          style: { ...style },
        });
        objects.push(obj);
        return obj;
      },
    },
    time: {
      delayedCall: (delay, callback) => {
        const timer = makeDisplayObject({
          kind: 'timer',
          delay,
          callback,
          remove: vi.fn(() => timer.destroy()),
        });
        timers.push(timer);
        objects.push(timer);
        return timer;
      },
    },
    tweens: {
      add: vi.fn(),
    },
    cameras: {
      main: { centerX: 320, centerY: 240 },
    },
    registry: {
      get: () => null,
    },
    _objects: objects,
    _timers: timers,
  };
}

function activeObjects(scene) {
  return scene._objects.filter((obj) => !obj.destroyed);
}

function activeTexts(scene) {
  return activeObjects(scene).filter((obj) => obj.kind === 'text');
}

function clickText(scene, matcher) {
  const matches = activeTexts(scene).find((obj) => {
    const matched = typeof matcher === 'string' ? obj.text === matcher : matcher(obj);
    return matched && obj.interactive && typeof obj.handlers.pointerdown === 'function';
  });
  if (!matches) {
    throw new Error(`Clickable text not found: ${String(matcher)}`);
  }
  matches.handlers.pointerdown();
}

function hasText(scene, substring) {
  return activeTexts(scene).some((obj) => String(obj.text).includes(substring));
}

function makeRunManager(overrides = {}) {
  return {
    gold: 1000,
    currentAct: 'act1',
    difficultyId: 'normal',
    difficultyMode: null,
    metaEffects: {},
    roster: [],
    getRosterCap() {
      return ROSTER_CAP + (this.metaEffects?.rosterCapBonus || 0);
    },
    awardGold(amount) {
      this.gold += amount;
    },
    spendGold(amount) {
      if (this.gold < amount) return false;
      this.gold -= amount;
      return true;
    },
    markNodeComplete: vi.fn(),
    ...overrides,
  };
}

function makeUnit(gameData, name, level = 5, className = 'Myrmidon') {
  const classData =
    gameData.classes.find((c) => c.name === className) ||
    gameData.classes.find((c) => c.tier === 'base');
  const unit = createRecruitUnit(
    { name, className: classData.name, level },
    classData,
    gameData.weapons,
    null,
    null,
    null,
    gameData.classes,
  );
  unit.faction = 'player';
  return unit;
}

let gameData;

beforeEach(() => {
  gameData = loadGameData();
});

describe('ColosseumOverlay', () => {
  it('uses difficultyId for max fights override', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'LunaticCapUnit');
    const runManager = makeRunManager({
      difficultyId: 'lunatic',
      difficultyMode: null,
      roster: [unit],
    });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-diff-1' }, vi.fn());

    expect(overlay._maxFights).toBe(2);
  });

  it('falls back to difficultyMode for backward compatibility', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'CompatDiffUnit');
    const runManager = makeRunManager({
      difficultyId: null,
      difficultyMode: 'lunatic',
      roster: [unit],
    });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-diff-2' }, vi.fn());

    expect(overlay._maxFights).toBe(2);
  });

  it('disables unaffordable tier buttons with clear reason text', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'ArenaUnit');
    const runManager = makeRunManager({ gold: 0, roster: [unit] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-1' }, vi.fn());
    overlay._selectedUnit = unit;
    overlay._showTierSelect();

    const tiers = getAvailableTiers(runManager.currentAct, gameData.colosseum);
    for (const [tierName] of tiers) {
      const label = `[ ${tierName.charAt(0).toUpperCase() + tierName.slice(1)} ]`;
      const tierLabel = activeTexts(scene).find((obj) => obj.text === label);
      expect(tierLabel).toBeTruthy();
      expect(tierLabel.interactive).toBe(false);
    }
    expect(hasText(scene, 'Need')).toBe(true);
    expect(hasText(scene, 'have 0G')).toBe(true);
  });

  it('blocks _executeFight when tier is unaffordable without mutating combat state', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'LowGoldUnit');
    const runManager = makeRunManager({ gold: 0, roster: [unit] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-2' }, vi.fn());
    overlay._selectedUnit = unit;
    overlay._selectedTier = {
      name: 'bronze',
      entryFee: 50,
      goldReward: 120,
      xpMultiplier: 1,
      levelOffset: [0, 0],
    };
    overlay._challenger = { unit: makeUnit(gameData, 'EnemyUnit') };

    const hpBefore = unit.currentHP;
    overlay._executeFight();

    expect(unit.currentHP).toBe(hpBefore);
    expect(overlay._fightsPerUnit[unit.name] || 0).toBe(0);
    expect(hasText(scene, 'Arena — Select Tier')).toBe(true);
    expect(hasText(scene, 'Not enough gold')).toBe(true);
  });

  it('hides Fight Again when post-result gold is below entry fee', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'ResultUnit');
    const runManager = makeRunManager({ gold: 10, roster: [unit] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);
    const tier = {
      name: 'bronze',
      entryFee: 50,
      goldReward: 120,
      xpMultiplier: 1,
      levelOffset: [0, 0],
    };

    overlay.show({ id: 'col-3' }, vi.fn());
    overlay._selectedUnit = unit;
    overlay._selectedTier = tier;
    overlay._challenger = { unit: makeUnit(gameData, 'ResultEnemy') };
    overlay._fightsPerUnit[unit.name] = 0;

    overlay._showResult('draw', tier);

    expect(activeTexts(scene).some((obj) => obj.text === '[ Fight Again ]')).toBe(false);
    expect(activeTexts(scene).some((obj) => obj.text === '[ Back to Menu ]')).toBe(true);
  });

  it('supports paginated unit selection so all roster units are reachable', () => {
    const scene = makeScene();
    const roster = Array.from({ length: 14 }, (_, i) =>
      makeUnit(gameData, `Unit${String(i + 1).padStart(2, '0')}`),
    );
    const runManager = makeRunManager({ roster });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-4' }, vi.fn());
    overlay._showUnitSelect();

    expect(hasText(scene, 'Page 1/2')).toBe(true);
    expect(hasText(scene, 'Unit01')).toBe(true);
    expect(hasText(scene, 'Unit08')).toBe(true);
    expect(hasText(scene, 'Unit09')).toBe(false);

    clickText(scene, '[ Next ]');

    expect(hasText(scene, 'Page 2/2')).toBe(true);
    expect(hasText(scene, 'Unit09')).toBe(true);
    expect(hasText(scene, 'Unit14')).toBe(true);
    expect(hasText(scene, 'Unit01')).toBe(false);
  });

  it('clamps pagination when roster size shrinks', () => {
    const scene = makeScene();
    const roster = Array.from({ length: 14 }, (_, i) =>
      makeUnit(gameData, `Shrink${String(i + 1).padStart(2, '0')}`),
    );
    const runManager = makeRunManager({ roster });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-5' }, vi.fn());
    overlay._unitSelectPage = 99;
    overlay._showUnitSelect();
    expect(overlay._unitSelectPage).toBe(1);

    runManager.roster = runManager.roster.slice(0, 3);
    overlay._showUnitSelect();
    expect(overlay._unitSelectPage).toBe(0);
    expect(hasText(scene, 'Shrink01')).toBe(true);
  });

  it('hireMercenary mutates roster on successful spend', () => {
    const scene = makeScene();
    const runManager = makeRunManager({ gold: 1000, roster: [] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);
    const merc = makeUnit(gameData, 'MercHire', 6);

    overlay.show({ id: 'col-6' }, vi.fn());
    overlay._mercCandidates = [{ unit: merc, hireCost: 100 }];

    const hired = overlay._hireMercenary(0);

    expect(hired).toBe(true);
    expect(runManager.roster).toContain(merc);
    expect(merc.faction).toBe('player');
    expect(merc._hired).toBe(true);
    expect(overlay._mercHired).toBe(true);
  });

  it('merc board respects rosterCapBonus for full-roster gating', () => {
    const scene = makeScene();
    const roster = Array.from({ length: 12 }, (_, i) =>
      makeUnit(gameData, `CapUnit${String(i + 1).padStart(2, '0')}`),
    );
    const runManager = makeRunManager({
      gold: 1000,
      roster,
      metaEffects: { rosterCapBonus: 3 },
    });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);
    const merc = makeUnit(gameData, 'CapMerc', 6);

    overlay.show({ id: 'col-cap-1' }, vi.fn());
    overlay._mercCandidates = [{ unit: merc, hireCost: 100 }];
    overlay._showMercBrowse();

    expect(activeTexts(scene).some((obj) => obj.text === '[ Hire ]')).toBe(true);
    expect(hasText(scene, 'Roster full')).toBe(false);
  });

  it('hireMercenary does not mutate roster when spendGold fails', () => {
    const scene = makeScene();
    const runManager = makeRunManager({
      gold: 10,
      roster: [],
      spendGold: vi.fn(() => false),
    });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);
    const merc = makeUnit(gameData, 'MercFail', 6);

    overlay.show({ id: 'col-7' }, vi.fn());
    overlay._mercCandidates = [{ unit: merc, hireCost: 100 }];

    const hired = overlay._hireMercenary(0);

    expect(hired).toBe(false);
    expect(runManager.roster).toHaveLength(0);
    expect(merc._hired).not.toBe(true);
    expect(overlay._mercHired).toBe(false);
  });

  it('hireMercenary rejects stale second hire without charging or mutating', () => {
    const scene = makeScene();
    const spendSpy = vi.fn(() => true);
    const runManager = makeRunManager({
      gold: 1000,
      roster: [],
      spendGold: spendSpy,
    });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);
    const merc = makeUnit(gameData, 'MercStaleSecond', 6);

    overlay.show({ id: 'col-hire-guard-1' }, vi.fn());
    overlay._mercCandidates = [{ unit: merc, hireCost: 100 }];
    overlay._mercHired = true;

    const hired = overlay._hireMercenary(0);

    expect(hired).toBe(false);
    expect(spendSpy).not.toHaveBeenCalled();
    expect(runManager.roster).toHaveLength(0);
    expect(merc._hired).not.toBe(true);
  });

  it('hireMercenary rejects already-hired candidate without charging or mutating', () => {
    const scene = makeScene();
    const spendSpy = vi.fn(() => true);
    const runManager = makeRunManager({
      gold: 1000,
      roster: [],
      spendGold: spendSpy,
    });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);
    const merc = makeUnit(gameData, 'MercAlreadyHired', 6);
    merc._hired = true;

    overlay.show({ id: 'col-hire-guard-2' }, vi.fn());
    overlay._mercCandidates = [{ unit: merc, hireCost: 100 }];

    const hired = overlay._hireMercenary(0);

    expect(hired).toBe(false);
    expect(spendSpy).not.toHaveBeenCalled();
    expect(runManager.roster).toHaveLength(0);
  });

  it('hireMercenary rejects full-roster commit-time guard without charging or mutating', () => {
    const scene = makeScene();
    const spendSpy = vi.fn(() => true);
    const runManager = makeRunManager({
      gold: 1000,
      roster: Array.from({ length: ROSTER_CAP }, (_, i) =>
        makeUnit(gameData, `FullUnit${String(i + 1).padStart(2, '0')}`),
      ),
      spendGold: spendSpy,
    });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);
    const merc = makeUnit(gameData, 'MercRosterFull', 6);

    overlay.show({ id: 'col-hire-guard-3' }, vi.fn());
    overlay._mercCandidates = [{ unit: merc, hireCost: 100 }];

    const hired = overlay._hireMercenary(0);

    expect(hired).toBe(false);
    expect(spendSpy).not.toHaveBeenCalled();
    expect(runManager.roster).toHaveLength(ROSTER_CAP);
    expect(merc._hired).not.toBe(true);
  });

  it('unit select list uses getDisplayLevel for extended levels', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'ExtDispUnit', 5);
    unit.level = 20;
    unit.tier = 'promoted';
    unit.className = 'Swordmaster';
    unit.extendedLevels = 3;
    const runManager = makeRunManager({ gold: 1000, roster: [unit] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-ext-disp' }, vi.fn());
    overlay._showUnitSelect();

    // getDisplayLevel should return "20+3" for this unit
    expect(getDisplayLevel(unit)).toBe('20+3');
    // The unit select list should contain the display level
    expect(hasText(scene, '20+3')).toBe(true);
    // Unit line should include the extended display level
    const texts = activeTexts(scene);
    const unitLine = texts.find((obj) => String(obj.text).includes('ExtDispUnit'));
    expect(unitLine).toBeTruthy();
    expect(String(unitLine.text)).toContain('20+3');
  });

  it('hide() does NOT invoke callback; leave() does', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'FlowUnit');
    const runManager = makeRunManager({ gold: 1000, roster: [unit] });
    const onLeave = vi.fn();
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-8' }, onLeave);
    expect(hasText(scene, 'Colosseum')).toBe(true);

    // ESC path: hide() should NOT invoke callback
    overlay.hide();
    expect(onLeave).not.toHaveBeenCalled();
    expect(overlay.visible).toBe(false);

    // Re-show and use Leave button path: leave() should invoke callback
    overlay.show({ id: 'col-8b' }, onLeave);
    expect(hasText(scene, 'Colosseum')).toBe(true);
    expect(overlay._unitSelectPage).toBe(0);

    overlay.leave();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('Leave button calls leave() which invokes callback', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'LeaveBtnUnit');
    const runManager = makeRunManager({ gold: 1000, roster: [unit] });
    const onLeave = vi.fn();
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-leave-btn' }, onLeave);
    clickText(scene, '[ Leave ]');
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(overlay.visible).toBe(false);
  });

  it('ESC re-entry preserves arena state (_fightsPerUnit, _mercCandidates)', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'ReentryUnit');
    const runManager = makeRunManager({ gold: 1000, roster: [unit] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-reentry' }, vi.fn());
    overlay._fightsPerUnit['ReentryUnit'] = 2;
    overlay._mercCandidates = [{ unit: makeUnit(gameData, 'Merc1'), hireCost: 300 }];

    // ESC hide
    overlay.hide();
    expect(overlay._fightsPerUnit['ReentryUnit']).toBe(2);
    expect(overlay._mercCandidates).toHaveLength(1);

    // Re-show same node
    overlay.show({ id: 'col-reentry' }, vi.fn());
    expect(overlay._fightsPerUnit['ReentryUnit']).toBe(2);
    expect(overlay._mercCandidates).toHaveLength(1);
  });

  it('after hide(), visible is false so onNodeClick guard passes', () => {
    const scene = makeScene();
    const runManager = makeRunManager({ gold: 1000, roster: [] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-vis' }, vi.fn());
    expect(overlay.visible).toBe(true);

    overlay.hide();
    expect(overlay.visible).toBe(false);
    // colosseumOverlay?.visible would be false — no soft-lock
  });

  it('draw outcome shows Draw text and does not change gold', () => {
    const scene = makeScene();
    const unit = makeUnit(gameData, 'DrawUnit', 5);
    const runManager = makeRunManager({ gold: 1000, roster: [unit] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);
    const tier = {
      name: 'bronze',
      entryFee: 50,
      goldReward: 120,
      xpMultiplier: 1,
      levelOffset: [0, 0],
    };

    overlay.show({ id: 'col-draw' }, vi.fn());
    overlay._selectedUnit = unit;
    overlay._selectedTier = tier;
    overlay._challenger = { unit: makeUnit(gameData, 'DrawEnemy', 5) };

    // Test via _showResult which handles the outcome string
    overlay._showResult('draw', tier);

    expect(hasText(scene, 'Draw')).toBe(true);
    // Gold should not change for draw
    expect(runManager.gold).toBe(1000);
  });

  it('merc generation failure falls back to empty candidates with Back button', () => {
    const scene = makeScene();
    const runManager = makeRunManager({ gold: 1000, roster: [] });
    // Provide broken gameData to trigger error
    const brokenData = { ...gameData, colosseum: { ...gameData.colosseum }, recruits: null };
    const overlay = new ColosseumOverlay(scene, runManager, brokenData);

    overlay.show({ id: 'col-merc-fail' }, vi.fn());
    // Force re-gen by clearing cached candidates
    overlay._mercCandidates = null;
    overlay._showMercBrowse();

    expect(overlay._mercCandidates).toEqual([]);
    expect(hasText(scene, 'No mercenaries available')).toBe(true);
    expect(activeTexts(scene).some((obj) => obj.text === '[ Back ]')).toBe(true);
  });

  it('malformed merc candidates are filtered out during _showMercBrowse', () => {
    const scene = makeScene();
    const runManager = makeRunManager({ gold: 1000, roster: [] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-merc-filter' }, vi.fn());
    // Clear cached candidates so _showMercBrowse triggers generation
    overlay._mercCandidates = null;
    vi.mocked(generateMercenaryCandidates).mockReturnValueOnce([
      { unit: { name: 'Good', stats: { HP: 20 }, className: 'Fighter' }, hireCost: 300 },
      { unit: null, hireCost: 100 },
      { unit: { name: 'NoStats' }, hireCost: 200 },
      { unit: { name: 'NoCost', stats: { HP: 20 } }, hireCost: undefined },
    ]);
    overlay._showMercBrowse();

    expect(overlay._mercCandidates).toHaveLength(1);
    expect(overlay._mercCandidates[0].unit.name).toBe('Good');
    vi.mocked(generateMercenaryCandidates).mockRestore();
  });

  it('non-array merc candidate generation falls back to empty list', () => {
    const scene = makeScene();
    const runManager = makeRunManager({ gold: 1000, roster: [] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-merc-non-array' }, vi.fn());
    overlay._mercCandidates = null;
    vi.mocked(generateMercenaryCandidates).mockReturnValueOnce(null);

    expect(() => overlay._showMercBrowse()).not.toThrow();
    expect(overlay._mercCandidates).toEqual([]);
    expect(hasText(scene, 'No mercenaries available')).toBe(true);
  });
});
