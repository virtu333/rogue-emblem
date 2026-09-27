import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GUIDANCE_NOTES,
  guidanceAllows,
  guidanceText,
  isFragileUnit,
  isVeteranMeta,
  noTargetReason,
  reachFromRanges,
  reachText,
  resolveGuidance,
} from '../src/engine/Guidance.js';
import { parseRange } from '../src/engine/Combat.js';
import { SettingsManager, normalizeSettings } from '../src/utils/SettingsManager.js';
import { GuidanceController } from '../src/ui/GuidanceController.js';
import { createCaravanUnit } from '../src/engine/CaravanSystem.js';
import { loadGameData } from './testData.js';

describe('Guidance levels', () => {
  it('Auto is Full for a new save and Light once a run has finished', () => {
    expect(resolveGuidance('auto', { veteran: false })).toBe('full');
    expect(resolveGuidance('auto', { veteran: true })).toBe('light');
    expect(resolveGuidance('off', { veteran: false })).toBe('off');
    expect(resolveGuidance('full', { veteran: true })).toBe('full');
    expect(resolveGuidance('nonsense', { veteran: true })).toBe('light');
    expect(isVeteranMeta({ runsCompleted: 0, runsStarted: 3 })).toBe(false);
    expect(isVeteranMeta({ runsCompleted: 1 })).toBe(true);
    expect(isVeteranMeta(null)).toBe(false);
  });

  it('Full shows coaching and essentials, Light only essentials, Off nothing', () => {
    expect(guidanceAllows('full', 'coach')).toBe(true);
    expect(guidanceAllows('full', 'essential')).toBe(true);
    expect(guidanceAllows('light', 'coach')).toBe(false);
    expect(guidanceAllows('light', 'essential')).toBe(true);
    expect(guidanceAllows('off', 'essential')).toBe(false);
    expect(GUIDANCE_NOTES.guide_fragile_in_reach.tier).toBe('coach');
    expect(GUIDANCE_NOTES.guide_commander_low_hp.tier).toBe('essential');
  });

  it('treats healers and thin units as fragile', () => {
    const sera = {
      faction: 'player',
      stats: { HP: 18, DEF: 3 },
      proficiencies: [{ type: 'Light' }, { type: 'Staff' }],
    };
    const edric = {
      faction: 'player',
      stats: { HP: 20, DEF: 5 },
      proficiencies: [{ type: 'Sword' }],
    };
    const mage = {
      faction: 'player',
      stats: { HP: 17, DEF: 2 },
      proficiencies: [{ type: 'Tome' }],
    };
    expect(isFragileUnit(sera)).toBe(true);
    expect(isFragileUnit(edric)).toBe(false);
    expect(isFragileUnit(mage)).toBe(true);
    expect(isFragileUnit({ ...mage, faction: 'enemy' })).toBe(false);
  });

  it('writes plain, device-aware copy', () => {
    const unit = { name: 'Sera' };
    expect(guidanceText('guide_fragile_in_reach', { unit, count: 2, touch: true })).toBe(
      "Sera would be in reach of 2 enemies and can't take many hits. Tap Back to choose a safer tile.",
    );
    expect(guidanceText('guide_fragile_in_reach', { unit, count: 1, touch: false })).toContain(
      '1 enemy and',
    );
    expect(guidanceText('guide_fragile_in_reach', { unit, count: 1, touch: false })).toContain(
      'Press Esc or right-click',
    );
    expect(guidanceText('guide_commander_low_hp', { commander: { name: 'Edric' } })).toContain(
      'If Edric falls, the run ends.',
    );
    expect(guidanceText('guide_convoy')).toContain('5 weapons, 3 items');
    expect(noTargetReason(reachText([{ range: '1-2' }], parseRange))).toBe(
      'No target in range 1–2',
    );
    expect(reachText([{ range: '1' }, { range: '1' }], parseRange)).toBe('1');
    expect(reachText([], parseRange)).toBeNull();
  });
});

describe('Guidance setting', () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => delete store[k],
    };
  });

  it('maps legacy hints to guidance and keeps both in step', () => {
    expect(normalizeSettings({}).guidance).toBe('auto');
    expect(normalizeSettings({ hints: false }).guidance).toBe('off');
    expect(normalizeSettings({ hints: true, guidance: 'off' }).guidance).toBe('auto');
    expect(normalizeSettings({ hints: true, guidance: 'light' }).guidance).toBe('light');
    expect(normalizeSettings({ guidance: 'loud' }).guidance).toBe('auto');
    const settings = new SettingsManager();
    expect(settings.setGuidance('off')).toEqual({ ok: true });
    expect(settings.getHints()).toBe(false);
    settings.setHints(true);
    expect(settings.getGuidance()).toBe('auto');
    settings.setGuidance('light');
    expect(settings.getHints()).toBe(true);
    settings.setHints(false);
    expect(settings.getGuidance()).toBe('off');
    expect(settings.setGuidance('max')).toMatchObject({ ok: false });
    expect(JSON.parse(store.emblem_rogue_settings)).toMatchObject({
      hints: false,
      guidance: 'off',
    });
  });
});

function guidanceScene(overrides = {}) {
  const seen = new Set();
  const hints = {
    hasSeen: (id) => seen.has(id),
    markSeen: vi.fn((id) => seen.add(id)),
  };
  const settings = { getHints: () => true, getGuidance: () => 'auto', setGuidance: vi.fn() };
  const sera = {
    name: 'Sera',
    faction: 'player',
    col: 4,
    row: 2,
    currentHP: 18,
    stats: { HP: 18, DEF: 3 },
    proficiencies: [
      { type: 'Light', rank: 'Prof' },
      { type: 'Staff', rank: 'Prof' },
    ],
    inventory: [{ name: 'Glimmer', type: 'Light', range: '1-2', rankRequired: 'Prof' }],
  };
  const edric = {
    name: 'Edric',
    faction: 'player',
    isCommander: true,
    col: 1,
    row: 2,
    currentHP: 20,
    stats: { HP: 20, DEF: 5 },
    proficiencies: [{ type: 'Sword' }],
    inventory: [],
  };
  const scene = {
    registry: {
      get: (key) => ({ hints, settings, meta: { runsCompleted: 0 } })[key],
    },
    battleParams: {},
    battleState: 'PLAYER_IDLE',
    turnManager: { currentPhase: 'player', turnNumber: 1 },
    playerUnits: [edric, sera],
    enemyUnits: [{ faction: 'enemy', col: 9, row: 2, currentHP: 20 }],
    npcUnits: [],
    grid: { fogEnabled: false },
    isMobileInput: true,
    getUsableStaves: () => [{ name: 'Heal' }],
    findAttackTargets: () => [],
    ...overrides,
  };
  return { scene, hints, settings, sera, edric };
}

describe('Recruit battle intro (playtest 4: a field note, never a dialog)', () => {
  const garrick = () => ({
    name: 'Garrick',
    className: 'Cavalier',
    faction: 'npc',
    col: 6,
    row: 4,
    currentHP: 20,
  });

  it('names the recruit, the banner, the Lord and Talk, and the race', () => {
    const text = guidanceText('guide_recruit_on_map', { npc: garrick() });
    expect(text).toBe(
      'Garrick (Cavalier) under the gold banner can join you. Move a Lord next to them and choose Talk before enemies reach them.',
    );
    expect(guidanceText('guide_recruit_on_map', { npc: { name: 'Ada' } })).toMatch(
      /^Ada under the gold banner can join you\./,
    );
    expect(guidanceText('guide_recruit_on_map', {})).toMatch(
      /^The green unit under the gold banner can join you\./,
    );
    // Phone field note: no longer than the first-turn note it replaces on turn 1.
    const longest = guidanceText('guide_recruit_on_map', {
      npc: { name: 'Constance', className: 'Light Priestess' }, // longest name + class in data
    });
    expect(longest.length).toBeLessThanOrEqual(guidanceText('guide_first_turn', {}).length);
    expect(GUIDANCE_NOTES.guide_recruit_on_map.tier).toBe('essential');
  });

  it('shows on Full and Light (ahead of first-turn coaching), never on Off or legacy hints off', () => {
    const recruit = garrick();
    const { scene, settings } = guidanceScene({ npcUnits: [recruit] });
    const g = new GuidanceController(scene);
    for (const level of ['full', 'light', 'auto']) {
      settings.getGuidance = () => level;
      expect(g.pick()).toMatchObject({
        id: 'guide_recruit_on_map',
        context: { npc: recruit },
        anchor: recruit,
      });
    }
    settings.getGuidance = () => 'off';
    expect(g.level()).toBe('off');
    expect(g.allows('guide_recruit_on_map')).toBe(false);
    // Legacy "Contextual helpers: off" (hints:false) is Guidance Off whatever is stored.
    settings.getGuidance = () => 'full';
    settings.getHints = () => false;
    expect(g.level()).toBe('off');
    expect(g.allows('guide_recruit_on_map')).toBe(false);
  });

  it('is once per save slot: a later recruit battle opens quietly', () => {
    const { scene, hints, settings } = guidanceScene({ npcUnits: [garrick()] });
    const g = new GuidanceController(scene);
    expect(g.pick()?.id).toBe('guide_recruit_on_map');
    hints.markSeen('guide_recruit_on_map'); // read (Got it / reading window)
    const next = new GuidanceController(scene); // the next recruit battle, same slot
    expect(next.pick()?.id).toBe('guide_first_turn'); // Full: ordinary coaching only
    settings.getGuidance = () => 'light';
    expect(next.pick()).toBeNull();
  });

  it('names a fogged recruit the gold banner marks, but not other hidden green units', () => {
    const recruit = garrick();
    const { scene, settings } = guidanceScene({
      npcUnits: [recruit],
      grid: { fogEnabled: true, isVisible: () => false },
    });
    settings.getGuidance = () => 'light';
    const g = new GuidanceController(scene);
    expect(g.pick()).toBeNull(); // hidden and unmarked
    scene._recruitBeacon = { npc: recruit };
    expect(g.pick()).toMatchObject({ id: 'guide_recruit_on_map', anchor: recruit });
  });

  it('never spends the once-per-save recruit note on the merchant caravan', () => {
    const caravan = createCaravanUnit('act2', { col: 6, row: 4 });
    const { scene, settings } = guidanceScene({ npcUnits: [caravan] });
    settings.getGuidance = () => 'light';
    const g = new GuidanceController(scene);
    expect(g.pick()).toBeNull(); // visible, alive, green-ish: still not a recruit
    scene._recruitBeacon = { npc: caravan }; // even if something marked it
    expect(g.pick()).toBeNull();
    settings.getGuidance = () => 'full';
    expect(g.pick()?.id).toBe('guide_first_turn');
    // The note is still there for the first real recruit.
    const recruit = garrick();
    scene.npcUnits = [caravan, recruit];
    scene._recruitBeacon = { npc: recruit };
    expect(g.pick()).toMatchObject({ id: 'guide_recruit_on_map', anchor: recruit });
  });

  it('stays out of tutorial battles and of an enemy phase', () => {
    const { scene } = guidanceScene({ npcUnits: [garrick()] });
    const g = new GuidanceController(scene);
    scene.turnManager.currentPhase = 'enemy';
    expect(g.pick()).toBeNull();
    scene.turnManager.currentPhase = 'player';
    scene.battleParams.tutorialMode = true;
    expect(g.level()).toBe('off');
  });
});

describe('GuidanceController moments', () => {
  it('opens with the first-turn note on a new save', () => {
    const { scene } = guidanceScene();
    const g = new GuidanceController(scene);
    expect(g.pick()?.id).toBe('guide_first_turn');
  });

  it('warns when a fragile unit is moved into reach, not when it stays safe', () => {
    const { scene, sera } = guidanceScene();
    Object.assign(scene, {
      battleState: 'UNIT_ACTION_MENU',
      selectedUnit: sera,
      preMoveLoc: { col: 2, row: 2 },
      _threatSight: { current: { col: 4, row: 2, result: { count: 2 } } },
    });
    const g = new GuidanceController(scene);
    expect(g.pick()).toMatchObject({ id: 'guide_fragile_in_reach', context: { count: 2 } });
    scene._threatSight.current.result.count = 0;
    expect(g.pick()?.id).toBe('guide_no_attack');
    scene.preMoveLoc = { col: 4, row: 2 }; // not moved: planning menu
    expect(g.pick()?.id).not.toBe('guide_fragile_in_reach');
  });

  it('teaches healing when a healer is selected and an ally is hurt', () => {
    const { scene, sera, edric } = guidanceScene();
    edric.currentHP = 14;
    Object.assign(scene, { battleState: 'UNIT_SELECTED', selectedUnit: sera });
    expect(new GuidanceController(scene).pick()?.id).toBe('guide_healer_heals');
  });

  it('flags the commander at half HP, and recruits on the map, even on Light', () => {
    const { scene, settings, edric } = guidanceScene();
    settings.getGuidance = () => 'light';
    edric.currentHP = 10;
    const g = new GuidanceController(scene);
    expect(g.pick()?.id).toBe('guide_commander_low_hp');
    edric.currentHP = 20;
    scene.npcUnits = [{ name: 'Bram', faction: 'npc', col: 5, row: 5, currentHP: 18 }];
    expect(g.pick()?.id).toBe('guide_recruit_on_map');
    scene.npcUnits = [];
    expect(g.pick()).toBeNull(); // first-turn coaching is Full only
  });

  it('respects Off, legacy hints off, tutorials and already-seen notes', () => {
    const { scene, settings, hints } = guidanceScene();
    const g = new GuidanceController(scene);
    settings.getGuidance = () => 'off';
    expect(g.level()).toBe('off');
    settings.getGuidance = () => 'auto';
    settings.getHints = () => false;
    expect(g.level()).toBe('off');
    settings.getHints = () => true;
    scene.battleParams.tutorialMode = true;
    expect(g.level()).toBe('off');
    scene.battleParams.tutorialMode = false;
    hints.markSeen('guide_first_turn');
    expect(g.pick()).toBeNull();
  });

  it('greys Attack with a reason only on Full and only when nobody is in reach', () => {
    const { scene, settings, sera } = guidanceScene();
    const g = new GuidanceController(scene);
    expect(g.noTargetAttackReason(sera, [])).toBe('No target in range 1–2');
    expect(g.noTargetAttackReason(sera, [{}])).toBeNull();
    settings.getGuidance = () => 'light';
    expect(g.noTargetAttackReason(sera, [])).toBeNull();
    settings.getGuidance = () => 'full';
    scene.enemyUnits = [];
    expect(g.noTargetAttackReason(sera, [])).toBeNull();
  });

  describe('greyed Attack reach matches what targeting can strike', () => {
    const gameData = loadGameData();
    const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
    const reason = (unit, extra = {}) => {
      const { scene } = guidanceScene({ gameData: { skills: gameData.skills }, ...extra });
      return new GuidanceController(scene).noTargetAttackReason(unit, []);
    };
    const unit = (inventory, proficiencies, over = {}) => ({
      name: 'Test',
      faction: 'player',
      col: 1,
      row: 1,
      currentHP: 20,
      stats: { HP: 20, MAG: 6 },
      skills: [],
      inventory,
      weapon: inventory[0],
      proficiencies,
      ...over,
    });

    it('one weapon keeps its own range', () => {
      const sword = weapon('Iron Sword');
      expect(reason(unit([sword], [{ type: 'Sword', rank: 'Prof' }]))).toBe('No target in range 1');
    });

    it('two weapons: the distances either can strike, a gap written out', () => {
      const sword = weapon('Iron Sword'); // 1
      const bow = weapon('Iron Bow'); // 2
      const profs = [
        { type: 'Sword', rank: 'Prof' },
        { type: 'Bow', rank: 'Prof' },
        { type: 'Tome', rank: 'Mast' },
      ];
      expect(reason(unit([sword, bow], profs))).toBe('No target in range 1–2');
      // Sword 1 + Breachbolt 3–10: nothing strikes at 2, so the reach is not "1–10".
      expect(reason(unit([sword, weapon('Breachbolt')], profs))).toBe('No target in range 1, 3–10');
    });

    it('counts Foresight (+1 tome range), as combat does', () => {
      const fire = weapon('Fire'); // 1–2
      const mage = unit([fire], [{ type: 'Tome', rank: 'Prof' }], { skills: ['foresight'] });
      expect(reason(mage)).toBe('No target in range 1–3');
      mage.skills = [];
      expect(reason(mage)).toBe('No target in range 1–2');
    });

    it('leaves out a weapon with no uses left', () => {
      const fire = weapon('Fire'); // 1–2
      const bolt = weapon('Breachbolt'); // 3–10, one use per battle
      const profs = [{ type: 'Tome', rank: 'Mast' }];
      const mage = unit([fire, bolt], profs);
      expect(reason(mage)).toBe('No target in range 1–10');
      bolt._usesSpent = 1;
      expect(reason(mage)).toBe('No target in range 1–2');
      // Nothing left to attack with: Fire Emblem's hidden Attack, not a wrong range.
      expect(reason(unit([bolt], profs))).toBeNull();
    });

    it('writes merged spans', () => {
      expect(reachFromRanges([{ min: 1, max: 1 }])).toBe('1');
      expect(
        reachFromRanges([
          { min: 3, max: 10 },
          { min: 1, max: 2 },
        ]),
      ).toBe('1–10');
      expect(
        reachFromRanges([
          { min: 2, max: 3 },
          { min: 1, max: 1 },
          { min: 5, max: 5 },
        ]),
      ).toBe('1–3, 5');
      expect(reachFromRanges([])).toBeNull();
    });
  });

  it('never draws from Math.random', () => {
    const { scene } = guidanceScene();
    const random = vi.spyOn(Math, 'random');
    new GuidanceController(scene).pick();
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
