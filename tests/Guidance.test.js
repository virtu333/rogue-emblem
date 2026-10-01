import { describe, it, expect, vi, beforeEach } from 'vitest';

// The note itself is DOM (GuidanceNote.js); these tests drive the controller with a
// handle that behaves like it: close(false) never marks a note read, close(true) does.
const { domHost, notes } = vi.hoisted(() => ({ domHost: { on: false }, notes: [] }));
vi.mock('../src/utils/domUI.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasDOMHost: () => domHost.on,
}));
vi.mock('../src/ui/GuidanceNote.js', () => ({
  showGuidanceNote: vi.fn((_scene, { id, onRead }) => {
    const handle = {
      id,
      read: false,
      closed: false,
      onClose: null,
      isRead: () => handle.read,
      readFor: () => {
        // stayed on screen long enough to read (GuidanceNote's reading window)
        handle.read = true;
        onRead?.();
      },
      close: vi.fn((acknowledged = false) => {
        if (handle.closed) return;
        handle.closed = true;
        if (acknowledged && !handle.read) handle.readFor();
        handle.onClose?.(handle.read);
      }),
    };
    notes.push(handle);
    return handle;
  }),
}));
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
    _battleSession: 1,
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

  it('names a recruit in fog (always in view), but never a hidden caravan', () => {
    const recruit = garrick();
    const caravan = createCaravanUnit('act2', { col: 6, row: 4 });
    const { scene, settings } = guidanceScene({
      npcUnits: [caravan, recruit],
      grid: { fogEnabled: true, isVisible: () => false },
    });
    settings.getGuidance = () => 'light';
    const g = new GuidanceController(scene);
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

  it('greys Attack for an unarmed fighter on Full only; a pure healer keeps it hidden', () => {
    const { scene, settings, edric } = guidanceScene();
    const g = new GuidanceController(scene);
    edric.proficiencies = [{ type: 'Sword', rank: 'Prof' }];
    const sword = { name: 'Iron Sword', type: 'Sword', range: '1', rankRequired: 'Prof' };
    const axe = { name: 'Iron Axe', type: 'Axe', range: '1', rankRequired: 'Prof' };
    edric.inventory = [];
    edric.weapon = null;
    expect(g.unarmedAttackReason(edric)).toBe('Unarmed: no weapon to attack with');
    // Carrying only what it can't wield is still unarmed.
    edric.inventory = [axe];
    expect(g.unarmedAttackReason(edric)).toBe('Unarmed: no weapon to attack with');
    edric.inventory = [sword];
    edric.weapon = sword;
    expect(g.unarmedAttackReason(edric)).toBeNull();
    const cleric = {
      name: 'Saul',
      faction: 'player',
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
      inventory: [],
      weapon: null,
    };
    expect(g.unarmedAttackReason(cleric)).toBeNull();
    expect(g.unarmedAttackReason({ ...cleric, faction: 'enemy' })).toBeNull();
    edric.inventory = [];
    edric.weapon = null;
    settings.getGuidance = () => 'light';
    expect(g.unarmedAttackReason(edric)).toBeNull();
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

describe('unit-scoped notes step aside when their moment is over', () => {
  beforeEach(() => {
    domHost.on = true;
    notes.length = 0;
  });

  // Sera moved to a tile with no enemy in reach: guide_no_attack names her.
  function noAttackMoment() {
    notes.length = 0;
    const env = guidanceScene();
    const { scene, hints, sera } = env;
    hints.markSeen('guide_first_turn'); // keep the idle map quiet between moments
    hints.markSeen.mockClear();
    Object.assign(scene, {
      battleState: 'UNIT_ACTION_MENU',
      selectedUnit: sera,
      preMoveLoc: { col: 2, row: 2 },
      _threatSight: { current: { col: 4, row: 2, result: { count: 0 } } },
    });
    const g = new GuidanceController(scene);
    g.sync();
    expect(notes.map((n) => n.id)).toEqual(['guide_no_attack']);
    expect(g.coachShown).toBe(1);
    return { ...env, g, note: notes[0] };
  }

  it('Wait closes an unread note unacknowledged: still unseen, coaching slot given back', () => {
    const { scene, hints, sera, g, note } = noAttackMoment();
    sera.hasActed = true; // Wait
    Object.assign(scene, { battleState: 'PLAYER_IDLE', selectedUnit: null });
    g.sync();
    expect(note.close).toHaveBeenCalledWith(false);
    expect(g.note).toBeNull();
    expect(hints.markSeen).not.toHaveBeenCalled();
    expect(hints.hasSeen('guide_no_attack')).toBe(false);
    expect(g.coachShown).toBe(0);
    // A later unit in the same spot is taught it after all.
    sera.hasActed = false;
    Object.assign(scene, {
      battleState: 'UNIT_ACTION_MENU',
      selectedUnit: sera,
      preMoveLoc: { col: 2, row: 2 },
    });
    g.sync();
    expect(notes.map((n) => n.id)).toEqual(['guide_no_attack', 'guide_no_attack']);
    expect(g.coachShown).toBe(1);
  });

  it('closes when another unit is selected, or Back takes the unit to another tile', () => {
    const first = noAttackMoment();
    first.scene.selectedUnit = first.edric;
    first.scene.battleState = 'UNIT_SELECTED';
    first.g.sync();
    expect(first.note.close).toHaveBeenCalledWith(false);

    const back = noAttackMoment();
    back.sera.col = 2; // Back: the move is undone
    back.scene.battleState = 'UNIT_SELECTED';
    back.g.sync();
    expect(back.note.close).toHaveBeenCalledWith(false);
    expect(back.hints.markSeen).not.toHaveBeenCalled();
  });

  it('closes on the enemy phase and on a new turn', () => {
    const phase = noAttackMoment();
    phase.scene.turnManager.currentPhase = 'enemy';
    phase.g.sync();
    expect(phase.note.close).toHaveBeenCalledWith(false);

    const turn = noAttackMoment();
    turn.scene.turnManager.turnNumber = 2;
    turn.g.sync();
    expect(turn.note.close).toHaveBeenCalledWith(false);
  });

  it('stays open while its moment lasts', () => {
    const { g, note } = noAttackMoment();
    g.sync();
    g.sync();
    expect(note.close).not.toHaveBeenCalled();
    expect(g.note).toBe(note);
  });

  it('a note already read stays read and keeps its slot when it steps aside', () => {
    const { scene, hints, sera, g, note } = noAttackMoment();
    note.readFor();
    expect(hints.markSeen).toHaveBeenCalledTimes(1);
    sera.hasActed = true;
    Object.assign(scene, { battleState: 'PLAYER_IDLE', selectedUnit: null });
    g.sync();
    expect(note.close).toHaveBeenCalledWith(false);
    expect(hints.hasSeen('guide_no_attack')).toBe(true);
    expect(hints.markSeen).toHaveBeenCalledTimes(1);
    expect(g.coachShown).toBe(1);
  });

  it('the healer note follows the healer as it moves, and goes when it acts', () => {
    const { scene, hints, sera, edric } = guidanceScene();
    hints.markSeen('guide_first_turn');
    edric.currentHP = 14;
    Object.assign(scene, { battleState: 'UNIT_SELECTED', selectedUnit: sera });
    const g = new GuidanceController(scene);
    g.sync();
    const [note] = notes;
    expect(note.id).toBe('guide_healer_heals');
    // Moving next to the hurt ally is following the advice.
    scene.battleState = 'UNIT_MOVING';
    sera.col = 2;
    g.sync();
    scene.battleState = 'UNIT_ACTION_MENU';
    g.sync();
    expect(note.close).not.toHaveBeenCalled();
    sera.hasActed = true; // healed (or waited)
    Object.assign(scene, { battleState: 'PLAYER_IDLE', selectedUnit: null });
    g.sync();
    expect(note.close).toHaveBeenCalledWith(false);
  });

  it('general notes (first turn, commander at half HP, recruit) never auto-close', () => {
    for (const setup of [
      () => {},
      ({ edric }) => (edric.currentHP = 9),
      ({ scene }) =>
        (scene.npcUnits = [{ name: 'Bram', faction: 'npc', col: 5, row: 5, currentHP: 18 }]),
    ]) {
      notes.length = 0;
      const env = guidanceScene();
      setup(env);
      const { scene, sera } = env;
      const g = new GuidanceController(scene);
      g.sync();
      const [note] = notes;
      expect(note).toBeTruthy();
      Object.assign(scene, { battleState: 'UNIT_SELECTED', selectedUnit: sera });
      g.sync();
      sera.hasActed = true;
      Object.assign(scene, { battleState: 'PLAYER_IDLE', selectedUnit: null });
      scene.turnManager.currentPhase = 'enemy';
      g.sync();
      scene.turnManager = { currentPhase: 'player', turnNumber: 2 };
      g.sync();
      expect(note.close, note.id).not.toHaveBeenCalled();
      expect(g.note, note.id).toBe(note);
    }
  });
});

describe('Zombie remains note', () => {
  it('teaches the countdown, Smash and Light once, pointing at a pile the player has seen', () => {
    const text = guidanceText('guide_zombie_remains', {});
    expect(text).toMatch(/enemy phases/);
    expect(text).toMatch(/Smash/);
    expect(text).toMatch(/Light/);
    expect(GUIDANCE_NOTES.guide_zombie_remains.tier).toBe('essential');
    const pile = { col: 5, row: 3, turnsRemaining: 3, count: 1 };
    const { scene, hints, settings } = guidanceScene();
    settings.getGuidance = () => 'light';
    const g = new GuidanceController(scene);
    expect(g.pick()).toBeNull(); // no remains yet
    scene._remainsCtrl = { knownTiles: () => [pile], markers: { shown: [pile] } };
    expect(g.pick()).toMatchObject({ id: 'guide_zombie_remains', anchor: pile });
    hints.markSeen('guide_zombie_remains');
    expect(g.pick()).toBeNull();
  });

  it('says nothing about remains the fog hides', () => {
    const { scene, settings } = guidanceScene();
    settings.getGuidance = () => 'light';
    scene._remainsCtrl = { knownTiles: () => [], markers: { shown: [] } };
    expect(new GuidanceController(scene).pick()).toBeNull();
  });
});
