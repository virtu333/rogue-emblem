import { describe, it, expect, vi } from 'vitest';
import { CompendiumOverlay } from '../src/ui/CompendiumOverlay.js';
import { PauseOverlay } from '../src/ui/PauseOverlay.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function makeDisplayObject(extra = {}) {
  return {
    handlers: {},
    style: {},
    x: 0,
    y: 0,
    setDepth() { return this; },
    setInteractive() { return this; },
    setStrokeStyle() { return this; },
    setOrigin() { return this; },
    setColor(color) { this.style.color = color; return this; },
    on(event, handler) { this.handlers[event] = handler; return this; },
    destroy: vi.fn(),
    ...extra,
  };
}

function makeScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      rectangle: (x, y, width, height, _color, _alpha) => makeDisplayObject({ x, y, width, height }),
      graphics: () => ({
        ...makeDisplayObject(),
        lineStyle() { return this; },
        beginPath() { return this; },
        moveTo() { return this; },
        lineTo() { return this; },
        strokePath() { return this; },
      }),
      text: (x, y, text, style = {}) => makeDisplayObject({ x, y, text, style: { ...style } }),
    },
    input: {
      keyboard: {
        addKey: () => ({ on: vi.fn(), off: vi.fn() }),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    game: {
      events: {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
  };
}

describe('CompendiumOverlay', () => {
  it('constructor defaults: visible=false, activeTabIndex=0, activeFilterIndex=0', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    expect(overlay.visible).toBe(false);
    expect(overlay.activeTabIndex).toBe(0);
    expect(overlay.activeFilterIndex).toBe(0);
  });

  it('show() sets visible=true; hide() sets visible=false and calls onClose', () => {
    const onClose = vi.fn();
    const overlay = new CompendiumOverlay(makeScene(), gameData, onClose);
    overlay.show();
    expect(overlay.visible).toBe(true);
    overlay.hide();
    expect(overlay.visible).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has 9 category tabs', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    overlay.show();
    // Tab labels should appear in rendered objects
    const labels = ['Arms', 'Skills', 'Arts', 'Class', 'Items', 'Lords', 'Bless', 'Terrain', 'Affixes'];
    for (const label of labels) {
      const found = overlay.objects.find(o => o.text === label);
      expect(found, `Tab "${label}" should exist`).toBeTruthy();
    }
  });

  it('Arms tab returns all weapons from gameData', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    expect(overlay._getItemsForTab(0).length).toBe(gameData.weapons.length);
  });

  it('Skills tab returns all skills from gameData', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    expect(overlay._getItemsForTab(1).length).toBe(gameData.skills.length);
  });

  it('Arts tab returns all weapon arts from gameData', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    expect(overlay._getItemsForTab(2).length).toBe(gameData.weaponArts.arts.length);
  });

  it('Class tab returns all classes from gameData', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    expect(overlay._getItemsForTab(3).length).toBe(gameData.classes.length);
  });

  it('Items tab returns consumables + accessories + whetstones', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    const expected = gameData.consumables.length + gameData.accessories.length + gameData.whetstones.length;
    expect(overlay._getItemsForTab(4).length).toBe(expected);
  });

  it('Lords tab returns all lords from gameData', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    expect(overlay._getItemsForTab(5).length).toBe(gameData.lords.length);
  });

  it('Blessings tab returns all blessings from gameData', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    expect(overlay._getItemsForTab(6).length).toBe(gameData.blessings.blessings.length);
  });

  it('Terrain tab returns all terrain from gameData', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    expect(overlay._getItemsForTab(7).length).toBe(gameData.terrain.length);
  });

  it('Affixes tab returns all affixes from gameData', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    expect(overlay._getItemsForTab(8).length).toBe(gameData.affixes.affixes.length);
  });

  describe('sub-filters', () => {
    it('Arms "Sword" filter returns only sword-type weapons', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 0; // Arms
      overlay.activeFilterIndex = 1; // "Sword"
      const filtered = overlay._getFilteredItems();
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(i => i.type === 'Sword')).toBe(true);
    });

    it('Skills "Attack" filter maps to trigger on-attack', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 1; // Skills
      overlay.activeFilterIndex = 4; // "Attack"
      const filtered = overlay._getFilteredItems();
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(i => i.trigger === 'on-attack')).toBe(true);
    });

    it('Bless "T1" returns only tier-1 blessings', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 6; // Bless
      overlay.activeFilterIndex = 1; // "T1"
      const filtered = overlay._getFilteredItems();
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(i => i.tier === 1)).toBe(true);
    });

    it('Class "base" returns only base-tier classes', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 3; // Class
      overlay.activeFilterIndex = 1; // "base"
      const filtered = overlay._getFilteredItems();
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(i => i.tier === 'base')).toBe(true);
    });

    it('"All" filter returns all items', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 0; // Arms
      overlay.activeFilterIndex = 0; // "All"
      expect(overlay._getFilteredItems().length).toBe(gameData.weapons.length);
    });
  });

  describe('pagination', () => {
    it('pages Arms correctly at 10 items per page', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 0;
      const total = gameData.weapons.length;
      const expectedPages = Math.ceil(total / 10);
      // Verify page count by checking filtered items vs per-page
      expect(Math.ceil(overlay._getFilteredItems().length / 10)).toBe(expectedPages);
    });

    it('Lords page at 6 items per page', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 5;
      expect(overlay._itemsPerPage()).toBe(6);
    });
  });

  describe('renderer schema contracts', () => {
    it('renders scroll teaches line from teachesWeaponArtId when skillId is absent', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const artScroll = gameData.weapons.find(w => w.type === 'Scroll' && !w.skillId && w.teachesWeaponArtId);
      expect(artScroll).toBeTruthy();

      overlay._renderWeapon(artScroll, 100, 20, 500);
      const teachesLine = overlay.objects.find(o => typeof o.text === 'string' && o.text.startsWith('Teaches:'));
      expect(teachesLine).toBeTruthy();
      expect(teachesLine.text).toContain(artScroll.teachesWeaponArtId);
    });

    it('renders class weaponProficiencies when stored as a string', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const klass = gameData.classes.find(c => typeof c.weaponProficiencies === 'string');
      expect(klass).toBeTruthy();

      overlay._renderClass(klass, 100, 20, 500);
      const classLine = overlay.objects.find(o => typeof o.text === 'string' && o.text.includes(klass.weaponProficiencies));
      expect(classLine).toBeTruthy();
    });

    it('renders accessory preventEnemyDouble and doubleThresholdReduction combat effects', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());

      const counterSeal = gameData.accessories.find(a => a.name === 'Counter Seal');
      expect(counterSeal).toBeTruthy();
      overlay._renderItem(counterSeal, 100, 20, 500);
      const preventDoubleLine = overlay.objects.find(o => typeof o.text === 'string' && o.text.includes('Prevent Double'));
      expect(preventDoubleLine).toBeTruthy();

      const overlay2 = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const pursuitRing = gameData.accessories.find(a => a.name === 'Pursuit Ring');
      expect(pursuitRing).toBeTruthy();
      overlay2._renderItem(pursuitRing, 100, 20, 500);
      const thresholdLine = overlay2.objects.find(o => typeof o.text === 'string' && o.text.includes('Dbl Thres -2'));
      expect(thresholdLine).toBeTruthy();
    });

    it('renders lord weapon from weapon string, not first character of promotionWeapons', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const lord = gameData.lords.find(l => typeof l.weapon === 'string');
      expect(lord).toBeTruthy();

      overlay._renderLord(lord, 100, 20, 500);
      const lordLine = overlay.objects.find(o => typeof o.text === 'string' && o.text.startsWith('Skill:'));
      expect(lordLine).toBeTruthy();
      expect(lordLine.text).toContain(`Weapon: ${lord.weapon}`);
    });
  });

  describe('search', () => {
    it('querying "Pavise" finds results', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.show();
      overlay.searchInputActive = true;
      overlay._setSearchQuery('Pavise');
      expect(overlay.searchResults.length).toBeGreaterThan(0);
    });

    it('search jump resets filter to "All" and page to 0', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.show();
      // Set a non-default filter first
      overlay.activeTabIndex = 0;
      overlay.activeFilterIndex = 1;
      overlay.currentPage = 2;
      // Search for something that exists
      overlay.searchInputActive = true;
      overlay._setSearchQuery('Iron Sword');
      expect(overlay.activeFilterIndex).toBe(0); // reset to "All"
      expect(overlay.currentPage).toBe(0);
    });

    it('jumped item is within rendered page range', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.show();
      overlay.searchInputActive = true;
      overlay._setSearchQuery('Iron Sword');
      expect(overlay.searchResults.length).toBeGreaterThan(0);
      const result = overlay.searchResults[overlay.activeSearchResult];
      const perPage = overlay._itemsPerPage();
      const startIdx = overlay.currentPage * perPage;
      const endIdx = startIdx + perPage;
      expect(result.itemIndex).toBeGreaterThanOrEqual(startIdx);
      expect(result.itemIndex).toBeLessThan(endIdx);
    });

    it('shows "No matches" for unknown query', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.show();
      overlay.searchInputActive = true;
      overlay._setSearchQuery('zzzz_no_result_term');
      const noMatches = overlay.objects.find(o => o?.text === 'No matches');
      expect(noMatches).toBeTruthy();
    });
  });

  describe('null-safety', () => {
    it('missing weaponArts/blessings/affixes returns empty arrays', () => {
      const sparseData = { ...gameData, weaponArts: undefined, blessings: undefined, affixes: undefined };
      const overlay = new CompendiumOverlay(makeScene(), sparseData, vi.fn());
      expect(overlay._getItemsForTab(2)).toEqual([]); // Arts
      expect(overlay._getItemsForTab(6)).toEqual([]); // Bless
      expect(overlay._getItemsForTab(8)).toEqual([]); // Affixes
    });

    it('show() with sparse data does not throw', () => {
      const sparseData = { weapons: [], skills: [], classes: [], consumables: [], accessories: [], whetstones: [], lords: [], terrain: [] };
      const overlay = new CompendiumOverlay(makeScene(), sparseData, vi.fn());
      expect(() => overlay.show()).not.toThrow();
      overlay.hide();
    });
  });

  describe('mobile context', () => {
    it('show() emits mobile:pushContext, hide() emits mobile:popContext — exactly once each', () => {
      const scene = makeScene();
      const overlay = new CompendiumOverlay(scene, gameData, vi.fn());
      overlay.show();
      expect(scene.game.events.emit).toHaveBeenCalledWith('mobile:pushContext', { context: 'overlay_tabs' });
      const pushCount = scene.game.events.emit.mock.calls.filter(c => c[0] === 'mobile:pushContext').length;
      expect(pushCount).toBe(1);

      overlay.hide();
      const popCount = scene.game.events.emit.mock.calls.filter(c => c[0] === 'mobile:popContext').length;
      expect(popCount).toBe(1);
    });
  });

  describe('ESC and layout regressions', () => {
    it('ESC consumes the keyboard event before closing overlay', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.show();
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      overlay._onEsc(null, event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
      expect(overlay.visible).toBe(false);
    });

    it('filtered tab content stays above page navigation controls', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.show();
      overlay.activeTabIndex = 0; // Arms (has filters and multiple pages)
      overlay.activeFilterIndex = 0;
      overlay.currentPage = 0;
      overlay._draw();

      const nav = overlay.objects.find(o => typeof o.text === 'string' && o.text.startsWith('Page '));
      expect(nav).toBeTruthy();
      const navY = nav.y;

      const contentTexts = overlay.objects.filter((o) => (
        typeof o.text === 'string'
        && typeof o.y === 'number'
        && o.y >= 130
        && o.text !== '\u25C0 Prev'
        && o.text !== 'Next \u25B6'
        && !o.text.startsWith('Page ')
      ));
      expect(contentTexts.length).toBeGreaterThan(0);
      const maxContentY = Math.max(...contentTexts.map(o => o.y));
      expect(maxContentY).toBeLessThan(navY);
    });
  });
});

describe('PauseOverlay — Compendium integration', () => {
  it('hasActiveSubOverlay() returns true when Compendium is open', () => {
    const scene = makeScene();
    const pause = new PauseOverlay(scene, {
      onResume: vi.fn(),
      gameData,
    });
    pause.show();
    // Open Compendium via the button
    const compendiumBtn = pause.objects.find(o => o.text === 'Compendium');
    expect(compendiumBtn, 'Compendium button should exist').toBeTruthy();
    compendiumBtn.handlers.pointerdown();
    expect(pause.compendiumOverlay).toBeTruthy();
    expect(pause.compendiumOverlay.visible).toBe(true);
    expect(pause.hasActiveSubOverlay()).toBe(true);
  });

  it('closeActiveSubOverlay() closes Compendium and returns true', () => {
    const scene = makeScene();
    const pause = new PauseOverlay(scene, {
      onResume: vi.fn(),
      gameData,
    });
    pause.show();
    const compendiumBtn = pause.objects.find(o => o.text === 'Compendium');
    compendiumBtn.handlers.pointerdown();
    expect(pause.closeActiveSubOverlay()).toBe(true);
    expect(pause.compendiumOverlay).toBeNull(); // onClose nulls it
    expect(pause.hasActiveSubOverlay()).toBe(false);
  });

  it('ESC closes Compendium before closing Pause (precedence test)', () => {
    const scene = makeScene();
    const onResume = vi.fn();
    const pause = new PauseOverlay(scene, {
      onResume,
      gameData,
    });
    pause.show();
    // Open Compendium
    const compendiumBtn = pause.objects.find(o => o.text === 'Compendium');
    compendiumBtn.handlers.pointerdown();
    expect(pause.compendiumOverlay?.visible).toBe(true);

    // First ESC should close Compendium only
    const closed = pause.closeActiveSubOverlay();
    expect(closed).toBe(true);
    expect(pause.visible).toBe(true); // Pause still open
    expect(onResume).not.toHaveBeenCalled();

    // Second ESC closes Pause
    pause.hide();
    expect(pause.visible).toBe(false);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('opening Compendium auto-dismisses confirm modal', () => {
    const scene = makeScene();
    const pause = new PauseOverlay(scene, {
      onResume: vi.fn(),
      onAbandon: vi.fn(),
      gameData,
    });
    pause.show();

    // Trigger abandon to open confirm modal
    const abandonBtn = pause.objects.find(o => o.text === 'Abandon Run');
    expect(abandonBtn).toBeTruthy();
    abandonBtn.handlers.pointerdown();
    expect(pause.confirmObjects.length).toBeGreaterThan(0);

    // Open Compendium — should auto-dismiss confirm
    const compendiumBtn = pause.objects.find(o => o.text === 'Compendium');
    compendiumBtn.handlers.pointerdown();
    expect(pause.confirmObjects.length).toBe(0);
  });

  it('Compendium button not rendered when gameData is null', () => {
    const scene = makeScene();
    const pause = new PauseOverlay(scene, {
      onResume: vi.fn(),
      gameData: null,
    });
    pause.show();
    const compendiumBtn = pause.objects.find(o => o.text === 'Compendium');
    expect(compendiumBtn).toBeFalsy();
  });
});
