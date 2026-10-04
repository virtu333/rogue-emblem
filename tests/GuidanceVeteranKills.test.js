// guide_veteran_kills: Gaspar joins strong but earns little XP and barely grows, so a
// new player who lets him take the kills starves Edric and the recruits. The note fires
// when such a veteran (a policy flag in data/specialChars.json, never his name) is
// selected with an enemy in view, once per save slot, on Full and Light.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { domHost, notes } = vi.hoisted(() => ({ domHost: { on: true }, notes: [] }));
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

import { GuidanceController } from '../src/ui/GuidanceController.js';
import { GUIDANCE_NOTES, guidanceAllows, guidanceText, noteScope } from '../src/engine/Guidance.js';
import { isLowGrowthVeteran } from '../src/engine/SpecialCharacterPolicy.js';
import { createVeteranKnight } from '../src/engine/SpecialCharacters.js';
import { HELP_TABS } from '../src/data/helpContent.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function battle(overrides = {}) {
  const seen = new Set();
  const hints = { hasSeen: (id) => seen.has(id), markSeen: vi.fn((id) => seen.add(id)) };
  const settings = { getHints: () => true, getGuidance: () => 'full', setGuidance: vi.fn() };
  const gaspar = Object.assign(createVeteranKnight(data), { col: 3, row: 2 });
  const edric = {
    name: 'Edric',
    faction: 'player',
    isCommander: true,
    isLord: true,
    col: 1,
    row: 2,
    currentHP: 20,
    stats: { HP: 20, DEF: 5 },
    proficiencies: [{ type: 'Sword' }],
    inventory: [],
  };
  const garrick = {
    name: 'Garrick',
    faction: 'player',
    col: 2,
    row: 3,
    currentHP: 22,
    stats: { HP: 22, DEF: 6 },
    proficiencies: [{ type: 'Lance' }],
    inventory: [],
  };
  const enemy = { faction: 'enemy', col: 9, row: 2, currentHP: 20 };
  const scene = {
    _battleSession: 1,
    registry: { get: (key) => ({ hints, settings, meta: { runsCompleted: 0 } })[key] },
    battleParams: {},
    battleState: 'UNIT_SELECTED',
    selectedUnit: gaspar,
    turnManager: { currentPhase: 'player', turnNumber: 2 },
    playerUnits: [edric, gaspar, garrick],
    enemyUnits: [enemy],
    npcUnits: [],
    grid: { fogEnabled: false },
    isMobileInput: true,
    findAttackTargets: () => [],
    ...overrides,
  };
  return {
    scene,
    hints,
    settings,
    gaspar,
    edric,
    garrick,
    enemy,
    g: new GuidanceController(scene),
  };
}

beforeEach(() => {
  domHost.on = true;
  notes.length = 0;
});

describe('isLowGrowthVeteran', () => {
  it('reads the special character policy, not a name', () => {
    expect(isLowGrowthVeteran(createVeteranKnight(data))).toBe(true);
    expect(isLowGrowthVeteran({ name: 'Gaspar' })).toBe(false); // a recruit who borrows the name
    expect(isLowGrowthVeteran({ specialCharId: 'nobody' })).toBe(false);
    expect(isLowGrowthVeteran(null)).toBe(false);
    const growing = [{ id: 'x', classProgression: true, canPromote: true }];
    expect(isLowGrowthVeteran({ specialCharId: 'x' }, growing)).toBe(false);
    const fixed = [{ id: 'x', classProgression: false, canPromote: false }];
    expect(isLowGrowthVeteran({ specialCharId: 'x' }, fixed)).toBe(true);
  });
});

describe('guide_veteran_kills', () => {
  it('is an essential, unit-scoped note whose copy names the veteran and the commander', () => {
    expect(GUIDANCE_NOTES.guide_veteran_kills.tier).toBe('essential');
    expect(noteScope('guide_veteran_kills')).toBe('unit');
    expect(guidanceAllows('light', GUIDANCE_NOTES.guide_veteran_kills.tier)).toBe(true);
    const text = guidanceText('guide_veteran_kills', {
      unit: { name: 'Gaspar' },
      commander: { name: 'Edric' },
    });
    expect(text).toBe(
      'Gaspar is strong now but barely grows and earns little XP. Weaken enemies with Gaspar, then leave the final blow to Edric and your recruits: they grow from it.',
    );
    // touch and desktop read the same; stays short enough for a phone note
    expect(guidanceText('guide_veteran_kills', { unit: { name: 'Gaspar' }, touch: false })).toMatch(
      /^Gaspar is strong now/,
    );
    expect(text.length).toBeLessThanOrEqual(guidanceText('guide_zombie_remains', {}).length);
    // names come from the context, never hard-coded
    expect(
      guidanceText('guide_veteran_kills', { unit: { name: 'Ode' }, commander: { name: 'Lyra' } }),
    ).toMatch(/^Ode is strong.*with Ode, then leave the final blow to Lyra and your recruits/);
  });

  it('is picked when Gaspar is selected with a living enemy and another non-special ally', () => {
    const { g, gaspar, edric } = battle();
    const pick = g.pick();
    expect(pick).toMatchObject({ id: 'guide_veteran_kills', anchor: gaspar });
    expect(pick.context.unit).toBe(gaspar);
    expect(pick.context.commander).toBe(edric);
    expect(guidanceText(pick.id, pick.context)).toMatch(/^Gaspar is .*final blow to Edric and/);
  });

  it('also shows while he plans an action, and for a roster of just commander + Gaspar', () => {
    const { g, scene, garrick } = battle({ battleState: 'UNIT_ACTION_MENU' });
    expect(g.pick()?.id).toBe('guide_veteran_kills');
    scene.playerUnits = scene.playerUnits.filter((u) => u !== garrick);
    expect(g.pick()?.id).toBe('guide_veteran_kills'); // the commander still needs the XP
  });

  it('is not picked when nothing is selected, or a normal recruit is', () => {
    const { g, scene, garrick, hints } = battle();
    hints.markSeen('guide_first_turn');
    scene.selectedUnit = garrick;
    expect(g.pick()).toBeNull();
    Object.assign(scene, { battleState: 'PLAYER_IDLE', selectedUnit: null });
    expect(g.pick()).toBeNull();
  });

  it('is not picked without a living, visible enemy', () => {
    const none = battle();
    none.scene.enemyUnits = [];
    expect(none.g.pick()).toBeNull();
    const dead = battle();
    dead.enemy.currentHP = 0;
    expect(dead.g.pick()).toBeNull();
    const fogged = battle({ grid: { fogEnabled: true, isVisible: () => false } });
    expect(fogged.g.pick()).toBeNull();
    fogged.scene.grid.isVisible = () => true;
    expect(fogged.g.pick()?.id).toBe('guide_veteran_kills');
  });

  it('is not picked when nobody else can grow from the kills', () => {
    const { g, scene, gaspar } = battle();
    scene.playerUnits = [gaspar];
    expect(g.pick()).toBeNull();
    const { g: g2, scene: s2, garrick } = battle();
    garrick.currentHP = 0; // a fallen recruit is nobody to leave the kill to
    s2.playerUnits = s2.playerUnits.filter((u) => u.isCommander !== true);
    expect(g2.pick()).toBeNull();
  });

  it('is not picked once Gaspar has acted', () => {
    const { g, gaspar } = battle();
    gaspar.hasActed = true;
    expect(g.pick()).toBeNull();
  });

  it('is once per save slot, and never on Off, legacy hints off or in a tutorial', () => {
    const { g, hints, settings, scene } = battle();
    expect(g.pick()?.id).toBe('guide_veteran_kills');
    settings.getGuidance = () => 'off';
    expect(g.pick()).toBeNull();
    settings.getGuidance = () => 'full';
    settings.getHints = () => false;
    expect(g.pick()).toBeNull();
    settings.getHints = () => true;
    scene.battleParams.prologueChapter = 'p1_banner_at_dawn';
    expect(g.pick()).toBeNull();
    delete scene.battleParams.prologueChapter;
    expect(g.pick()?.id).toBe('guide_veteran_kills');
    hints.markSeen('guide_veteran_kills');
    expect(g.pick()).toBeNull();
  });

  it('is not picked in the enemy phase', () => {
    const { g, scene } = battle();
    scene.turnManager.currentPhase = 'enemy';
    expect(g.pick()).toBeNull();
  });

  it('still shows on Light guidance (essential), and on a veteran save (auto)', () => {
    const { g, settings, scene } = battle();
    settings.getGuidance = () => 'light';
    expect(g.pick()?.id).toBe('guide_veteran_kills');
    settings.getGuidance = () => 'auto';
    scene.registry = {
      get: (key) => ({ hints: scene.registry.hints, settings, meta: { runsCompleted: 3 } })[key],
    };
    scene.registry.hints = { hasSeen: () => false, markSeen: () => {} };
    expect(g.level()).toBe('light');
    expect(g.pick()?.id).toBe('guide_veteran_kills');
  });

  it('does not spend a coaching slot', () => {
    const { g } = battle();
    g.sync();
    expect(notes.map((n) => n.id)).toEqual(['guide_veteran_kills']);
    expect(g.coachShown).toBe(0);
  });

  describe('priority at the same moment', () => {
    it('the commander at half HP wins while that note is unread', () => {
      const { g, edric, hints } = battle();
      edric.currentHP = 8;
      expect(g.pick()).toBeNull(); // Gaspar selected: it waits; the idle map shows the warning
      g.scene.battleState = 'PLAYER_IDLE';
      g.scene.selectedUnit = null;
      expect(g.pick()?.id).toBe('guide_commander_low_hp');
      hints.markSeen('guide_commander_low_hp');
      g.scene.battleState = 'UNIT_SELECTED';
      g.scene.selectedUnit = g.scene.playerUnits[1];
      expect(g.pick()?.id).toBe('guide_veteran_kills');
    });

    it('a recruit on the map wins while that note is unread', () => {
      const { g, scene, hints, gaspar } = battle();
      scene.npcUnits = [{ name: 'Bram', faction: 'npc', col: 5, row: 5, currentHP: 18 }];
      expect(g.pick()).toBeNull();
      Object.assign(scene, { battleState: 'PLAYER_IDLE', selectedUnit: null });
      expect(g.pick()?.id).toBe('guide_recruit_on_map');
      hints.markSeen('guide_recruit_on_map');
      Object.assign(scene, { battleState: 'UNIT_SELECTED', selectedUnit: gaspar });
      expect(g.pick()?.id).toBe('guide_veteran_kills');
    });

    it('the first-turn note wins on Full while unread; Light has no such note', () => {
      const { g, scene, settings, hints, gaspar } = battle();
      scene.turnManager.turnNumber = 1;
      expect(g.pick()).toBeNull();
      Object.assign(scene, { battleState: 'PLAYER_IDLE', selectedUnit: null });
      expect(g.pick()?.id).toBe('guide_first_turn');
      Object.assign(scene, { battleState: 'UNIT_SELECTED', selectedUnit: gaspar });
      settings.getGuidance = () => 'light';
      expect(g.pick()?.id).toBe('guide_veteran_kills');
      settings.getGuidance = () => 'full';
      hints.markSeen('guide_first_turn');
      expect(g.pick()?.id).toBe('guide_veteran_kills');
    });

    it('a note already on screen is not replaced; the veteran note comes after it closes', () => {
      const { g, scene, edric, gaspar } = battle({
        battleState: 'PLAYER_IDLE',
        selectedUnit: null,
      });
      edric.currentHP = 8;
      g.sync();
      expect(notes.map((n) => n.id)).toEqual(['guide_commander_low_hp']);
      Object.assign(scene, { battleState: 'UNIT_SELECTED', selectedUnit: gaspar });
      g.sync();
      expect(notes).toHaveLength(1);
      notes[0].close(true); // Got it
      g.sync();
      expect(notes.map((n) => n.id)).toEqual(['guide_commander_low_hp', 'guide_veteran_kills']);
    });
  });

  describe('scoped to his moment', () => {
    it('steps aside unread when the player moves on, and can show later', () => {
      const { g, scene, gaspar, garrick, hints } = battle();
      g.sync();
      const [note] = notes;
      expect(note.id).toBe('guide_veteran_kills');
      // Moving him is following the advice's unit: stays open through the move
      scene.battleState = 'UNIT_MOVING';
      gaspar.col = 4;
      g.sync();
      expect(note.close).not.toHaveBeenCalled();
      // Choosing another unit closes it without marking it read
      Object.assign(scene, { battleState: 'UNIT_SELECTED', selectedUnit: garrick });
      g.sync();
      expect(note.close).toHaveBeenCalledWith(false);
      expect(hints.hasSeen('guide_veteran_kills')).toBe(false);
      // ...and he is taught it when picked again
      Object.assign(scene, { selectedUnit: gaspar });
      g.sync();
      expect(notes.map((n) => n.id)).toEqual(['guide_veteran_kills', 'guide_veteran_kills']);
    });

    it('goes when he acts or the turn moves on', () => {
      const acted = battle();
      acted.g.sync();
      acted.gaspar.hasActed = true;
      Object.assign(acted.scene, { battleState: 'PLAYER_IDLE', selectedUnit: null });
      acted.g.sync();
      expect(notes[0].close).toHaveBeenCalledWith(false);

      const turn = battle();
      turn.g.sync();
      turn.scene.turnManager.turnNumber = 3;
      turn.g.sync();
      expect(notes[1].close).toHaveBeenCalledWith(false);
    });
  });
});

describe('Gaspar the Veteran help page', () => {
  it('says he earns little XP, inside the help line budget', () => {
    const page = HELP_TABS.flatMap((tab) => tab.pages).find(
      (p) => p.title === 'Gaspar the Veteran',
    );
    expect(page.lines.map((l) => l.text).join(' ')).toMatch(/earns little XP/);
    expect(page.lines.length).toBeLessThanOrEqual(15);
    for (const line of page.lines) expect(line.text.length).toBeLessThanOrEqual(42);
  });
});
