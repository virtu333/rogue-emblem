// The deed rite (GrowthCeremonyController.showDeeds): presentation only,
// batched title cards, two presses per card, "Skip all", Instant / reduced
// motion, cleanup with the scene, and the roster's Deeds section.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { GrowthCeremonyController, buildDeedCard } from '../src/ui/GrowthCeremonyController.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { commitBattleDeeds, emptyBattleDeeds } from '../src/engine/DeedSystem.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { deedCardContent } from '../src/ui/growthContent.js';
import { _resetInputFocus, activeInputOwner } from '../src/utils/inputFocus.js';
import { hasOpenOverlay } from '../src/utils/overlayStack.js';
import { DOM_UI_DEPTHS } from '../src/utils/uiDepths.js';

const gameData = loadGameData();

function makeScene({ reduceMotion = false, speed = 'normal' } = {}) {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  const audio = { playSFX: vi.fn() };
  return {
    gameData,
    textures: { exists: () => false },
    registry: {
      get: (key) =>
        key === 'settings'
          ? { getReduceMotion: () => reduceMotion, getBattleSpeed: () => speed }
          : key === 'audio'
            ? audio
            : null,
    },
    events: {
      once: (name, fn) => listeners(name).add(fn),
      on: (name, fn) => listeners(name).add(fn),
      off: (name, fn) => listeners(name).delete(fn),
      emit: (name) => {
        const fns = [...listeners(name)];
        listeners(name).clear();
        for (const fn of fns) fn();
      },
    },
    audio,
  };
}

// The longest name in the recruit pool with the longest epithet in the game.
function announcements() {
  const unit = createUnit(
    gameData.classes.find((c) => c.name === 'Fighter'),
    5,
    gameData.weapons,
    { name: 'Stormclaw' },
  );
  unit._battleDeeds = {
    ...emptyBattleDeeds(),
    bossKills: 1,
    bossNames: ['Knight Commander'],
    crits: 3,
    heldPhases: 3,
    heldPlaces: ['Bridge', 'Bridge', 'Bridge'],
  };
  return { unit, entries: commitBattleDeeds([unit], gameData.deeds, {}) };
}

let dom;
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

const layers = () => dom.doc.querySelectorAll('.ce-layer');
const pointer = (node) =>
  node.dispatchEvent(new dom.FakeEvent('pointerdown', { button: 0, pointerId: 1 }));

describe('deed rite', () => {
  it('plays one title card per deed; each card reveals, then moves on', async () => {
    const scene = makeScene();
    const growth = new GrowthCeremonyController(scene);
    const { entries } = announcements();
    expect(entries.map((e) => e.deedId)).toEqual(['held_the_line', 'bossbane', 'keen_edge']);
    let settled = false;
    const done = growth.showDeeds({ entries }).then(() => (settled = true));
    const rite = layers()[0];
    expect(rite.classList.contains('gr-deed-layer')).toBe(true);
    expect(rite.getAttribute('role')).toBe('dialog');
    expect(rite.style.zIndex).toBe(String(DOM_UI_DEPTHS.RITE));
    expect(rite.getAttribute('aria-label')).toBe(
      'Deed. Stormclaw, Who Held the Bridge. Held the Line',
    );
    expect(rite.querySelector('.gr-deed-name').textContent).toBe('Stormclaw,');
    expect(rite.querySelector('.gr-deed-epithet-text').textContent).toBe('Who Held the Bridge');
    expect(rite.querySelector('.gr-deed-seal-mark').textContent).toBe('H');
    expect(rite.querySelector('.gr-deed-count').textContent).toBe('1 / 3');
    expect(rite.querySelector('.gr-deed-oath')).toBeNull(); // a higher deed swears first
    expect(rite.querySelector('.gr-deed-skip')).not.toBeNull();
    expect(hasOpenOverlay(scene)).toBe(true);
    const button = () => rite.querySelector('.gr-deed-next');
    expect(button().getAttribute('aria-label')).toBe('Skip');
    vi.advanceTimersByTime(250);
    pointer(rite); // reveal
    expect(rite.classList.contains('is-done')).toBe(true);
    expect(button().getAttribute('aria-label')).toBe('Next deed');
    pointer(rite); // next card
    expect(rite.classList.contains('is-done')).toBe(false);
    expect(rite.querySelector('.gr-deed-epithet-text').textContent).toBe(
      'Bane of the Knight Commander',
    );
    expect(rite.querySelector('.gr-deed-oath').textContent).toBe('Oath at promotion · Fiendish Blow'); // prettier-ignore
    await vi.advanceTimersByTimeAsync(4000); // reveals by itself
    expect(button().getAttribute('aria-label')).toBe('Next deed');
    pointer(rite);
    expect(rite.querySelector('.gr-deed-count').textContent).toBe('3 / 3');
    expect(rite.querySelector('.gr-deed-skip')).toBeNull(); // nothing left to skip
    pointer(rite);
    expect(button().getAttribute('aria-label')).toBe('Continue');
    pointer(rite);
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(settled).toBe(true);
    expect(layers()).toHaveLength(0);
    expect(activeInputOwner()).toBeNull();
    expect(hasOpenOverlay(scene)).toBe(false);
    expect(dom.win.listenerCount('keydown')).toBe(0);
  });

  it('"Skip all" ends the batch at once', async () => {
    const growth = new GrowthCeremonyController(makeScene());
    const { entries } = announcements();
    let settled = false;
    void growth.showDeeds({ entries }).then(() => (settled = true));
    const rite = layers()[0];
    vi.advanceTimersByTime(250);
    rite.querySelector('.gr-deed-skip').click();
    await vi.advanceTimersByTimeAsync(400);
    expect(settled).toBe(true);
    expect(layers()).toHaveLength(0);
  });

  it('Enter drives it; Instant speed and reduced motion open each card revealed', async () => {
    for (const prefs of [{ speed: 'instant' }, { reduceMotion: true }]) {
      const growth = new GrowthCeremonyController(makeScene(prefs));
      const { entries } = announcements();
      let settled = false;
      void growth.showDeeds({ entries }).then(() => (settled = true));
      const rite = layers()[0];
      expect(rite.classList.contains('is-static')).toBe(true);
      expect(rite.classList.contains('is-done')).toBe(true);
      vi.advanceTimersByTime(250);
      for (let i = 0; i < 3; i++) dom.key('Enter');
      await vi.advanceTimersByTimeAsync(400);
      expect(settled).toBe(true);
      growth.destroy();
    }
  });

  it('shows nothing for no deeds, never touches units or the RNG, and dies with the scene', async () => {
    const scene = makeScene();
    const growth = new GrowthCeremonyController(scene);
    expect(await growth.showDeeds({ entries: [] })).toBe(false);
    const { unit, entries } = announcements();
    const before = JSON.stringify(unit.deeds);
    const spy = vi.spyOn(Math, 'random');
    let resolved = 0;
    void growth.showDeeds({ entries }).then(() => resolved++);
    await vi.advanceTimersByTimeAsync(3000);
    expect(spy).not.toHaveBeenCalled();
    scene.events.emit('shutdown');
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(1);
    expect(layers()).toHaveLength(0);
    expect(dom.win.listenerCount('keydown')).toBe(0);
    expect(JSON.stringify(unit.deeds)).toBe(before);
    spy.mockRestore();
  });

  it('builds a faceless card when there is no portrait', () => {
    const { entries } = announcements();
    const content = deedCardContent(entries[0], { skills: gameData.skills });
    const view = buildDeedCard(null, entries[0].unit, content);
    expect(view.card.classList.contains('is-faceless')).toBe(true);
    expect(view.skip).toBeNull();
  });
});

describe('roster Deeds section', () => {
  it('shows the epithet under the name, the tallies, the Oath and each deed', () => {
    const { unit } = announcements();
    const scene = makeScene();
    const sheet = new MobileRosterSheet({ scene, units: [unit], gameData, onClose: vi.fn() });
    const root = dom.doc.querySelector('.mr-sheet');
    expect(root.querySelector('.mr-unit-epithet').textContent).toBe('Bane of the Knight Commander');
    expect(root.querySelector('.mr-epithet').textContent).toBe('Bane of the Knight Commander');
    const deeds = root.querySelectorAll('.mr-deed');
    expect(deeds).toHaveLength(3);
    expect(deeds[0].classList.contains('is-title')).toBe(true);
    const text = root.textContent;
    expect(text).toContain('This march: 3 critical hits · 1 battle');
    expect(text).toContain('Oath of the Bane · sworn at promotion');
    sheet.destroy();
  });

  it('an empty state for a unit without deeds', () => {
    const unit = createUnit(gameData.classes.find((c) => c.name === 'Fighter'), 1, gameData.weapons, { name: 'New' }); // prettier-ignore
    const sheet = new MobileRosterSheet({ scene: makeScene(), units: [unit], gameData, onClose: vi.fn() }); // prettier-ignore
    const root = dom.doc.querySelector('.mr-sheet');
    expect(root.querySelector('.mr-unit-epithet')).toBeNull();
    expect(root.textContent).toContain('No deeds yet');
    sheet.destroy();
  });
});
