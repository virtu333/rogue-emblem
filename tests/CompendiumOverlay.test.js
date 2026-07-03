import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompendiumOverlay, TAB_DEFS } from '../src/ui/CompendiumOverlay.js';
import { PauseOverlay } from '../src/ui/PauseOverlay.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

// Foes-tab boss gating reads act-reached milestones across all save slots via
// hasAnySlotMilestone → localStorage. Mock it so tests can seed unlock state.
const lsStore = {};
const localStorageMock = {
  getItem: (k) => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => {
    lsStore[k] = String(v);
  },
  removeItem: (k) => {
    delete lsStore[k];
  },
  clear: () => {
    for (const k of Object.keys(lsStore)) delete lsStore[k];
  },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const ALL_ACT_MILESTONES = [
  'reachedAct1',
  'reachedAct2',
  'reachedAct3',
  'reachedAct4',
  'reachedFinalBoss',
];

function seedSlotMilestones(slot, milestones) {
  lsStore[`emblem_rogue_slot_${slot}_meta`] = JSON.stringify({ milestones });
}

function unlockAllActs(slot = 1) {
  seedSlotMilestones(slot, ALL_ACT_MILESTONES);
}

beforeEach(() => {
  localStorageMock.clear();
});

function makeDisplayObject(extra = {}) {
  return {
    handlers: {},
    style: {},
    x: 0,
    y: 0,
    setDepth() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setColor(color) {
      this.style.color = color;
      return this;
    },
    on(event, handler) {
      this.handlers[event] = handler;
      return this;
    },
    destroy: vi.fn(),
    ...extra,
  };
}

function makeScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      rectangle: (x, y, width, height, _color, _alpha) =>
        makeDisplayObject({ x, y, width, height }),
      graphics: () => ({
        ...makeDisplayObject(),
        lineStyle() {
          return this;
        },
        beginPath() {
          return this;
        },
        moveTo() {
          return this;
        },
        lineTo() {
          return this;
        },
        strokePath() {
          return this;
        },
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

  it('has 10 category tabs', () => {
    const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
    overlay.show();
    // Tab labels should appear in rendered objects
    const labels = [
      'Arms',
      'Skills',
      'Arts',
      'Class',
      'Items',
      'Lords',
      'Bless',
      'Terrain',
      'Affixes',
      'Foes',
    ];
    for (const label of labels) {
      const found = overlay.objects.find((o) => o.text === label);
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
    const expected =
      gameData.consumables.length + gameData.accessories.length + gameData.whetstones.length;
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
      expect(filtered.every((i) => i.type === 'Sword')).toBe(true);
    });

    it('Skills "Attack" filter maps to trigger on-attack', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 1; // Skills
      overlay.activeFilterIndex = 4; // "Attack"
      const filtered = overlay._getFilteredItems();
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((i) => i.trigger === 'on-attack')).toBe(true);
    });

    it('Bless "T1" returns only tier-1 blessings', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 6; // Bless
      overlay.activeFilterIndex = 1; // "T1"
      const filtered = overlay._getFilteredItems();
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((i) => i.tier === 1)).toBe(true);
    });

    it('Class "base" returns only base-tier classes', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 3; // Class
      overlay.activeFilterIndex = 1; // "base"
      const filtered = overlay._getFilteredItems();
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((i) => i.tier === 'base')).toBe(true);
    });

    it('"All" filter returns all items', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 0; // Arms
      overlay.activeFilterIndex = 0; // "All"
      expect(overlay._getFilteredItems().length).toBe(gameData.weapons.length);
    });
  });

  describe('pagination', () => {
    it('pages Arms correctly at its per-page count', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 0;
      const perPage = overlay._itemsPerPage();
      const total = gameData.weapons.length;
      const expectedPages = Math.ceil(total / perPage);
      // Verify page count by checking filtered items vs per-page
      expect(Math.ceil(overlay._getFilteredItems().length / perPage)).toBe(expectedPages);
    });

    it('per-page counts: lore-bearing tabs shrink, others stay at 10', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const expectByTab = { 0: 6, 1: 10, 4: 6, 5: 6, 6: 6, 9: 5 }; // Arms, Skills, Items, Lords, Bless, Foes
      for (const [tabIndex, expected] of Object.entries(expectByTab)) {
        overlay.activeTabIndex = Number(tabIndex);
        expect(overlay._itemsPerPage(), `tab ${tabIndex}`).toBe(expected);
      }
    });
  });

  describe('Foes tab (bestiary)', () => {
    const bossCount = Object.values(gameData.enemies.bosses).reduce((n, arr) => n + arr.length, 0);

    it('TAB_DEFS[9] is the Foes tab with All/Bosses/Classes filters', () => {
      expect(TAB_DEFS[9]).toEqual({
        label: 'Foes',
        key: 'foes',
        filters: ['All', 'Bosses', 'Classes'],
      });
    });

    it('returns all bosses (act-flattened) followed by all classes', () => {
      unlockAllActs();
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const items = overlay._getItemsForTab(9);
      expect(bossCount).toBe(11);
      expect(items.length).toBe(bossCount + gameData.classes.length);
      expect(items.slice(0, bossCount).every((i) => i._kind === 'boss')).toBe(true);
      expect(items.slice(bossCount).every((i) => i._kind === 'class')).toBe(true);
      expect(items[0]._actLabel).toBe('Act 1');
      // Memoized: identities stable across calls (search index depends on this)
      expect(overlay._getItemsForTab(9)).toBe(items);
    });

    it('Bosses/Classes filters split the list', () => {
      unlockAllActs();
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 9;
      overlay.activeFilterIndex = 1; // Bosses
      expect(overlay._getFilteredItems().length).toBe(bossCount);
      overlay.activeFilterIndex = 2; // Classes
      expect(overlay._getFilteredItems().length).toBe(gameData.classes.length);
    });

    it('renders a boss row with act/class/level meta and wrapped lore', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const boss = {
        name: 'Iron Captain',
        className: 'Cavalier',
        level: 3,
        _kind: 'boss',
        _actLabel: 'Act 1',
        lore: 'He held the border for twenty years. No order ever came to relieve him.',
      };
      overlay._renderFoe(boss, 100, 20, 500);
      const nameObj = overlay.objects.find((o) => o.text === 'Iron Captain');
      expect(nameObj).toBeTruthy();
      expect(nameObj.style.color).toBe('#ff8866');
      const metaObj = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.includes('Act 1') && o.text.includes('Lv3'),
      );
      expect(metaObj).toBeTruthy();
      const loreObj = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.includes('held the border'),
      );
      expect(loreObj).toBeTruthy();
      expect(loreObj.style.color).toBe('#c8b878');
    });

    it('renders finalBoss difficulty tag and class rows without one', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const entity = {
        name: 'The Entity',
        className: 'Entity',
        level: 20,
        difficultyFilter: ['lunatic'],
        _kind: 'boss',
        _actLabel: 'Final',
        lore: 'It was here before the ritual. The ritual only taught it our names.',
      };
      overlay._renderFoe(entity, 100, 20, 500);
      const metaObj = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.includes('[lunatic]'),
      );
      expect(metaObj).toBeTruthy();

      const overlay2 = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const klass = {
        name: 'Myrmidon',
        tier: 'base',
        moveType: 'Infantry',
        _kind: 'class',
        lore: 'Sword schools of the frontier teach speed first; armor is for the wealthy.',
      };
      overlay2._renderFoe(klass, 100, 20, 500);
      const classNameObj = overlay2.objects.find((o) => o.text === 'Myrmidon');
      expect(classNameObj.style.color).toBe('#e0e0e0');
      const classMeta = overlay2.objects.find(
        (o) => typeof o.text === 'string' && o.text.includes('Class') && o.text.includes('base'),
      );
      expect(classMeta).toBeTruthy();
      expect(overlay2.objects.some((o) => o.text?.includes?.('['))).toBe(false);
    });

    it('_wrapLore wraps, caps at maxLines with ellipsis, and handles empty', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      expect(overlay._wrapLore('', 20, 2)).toEqual([]);
      expect(overlay._wrapLore(null, 20, 2)).toEqual([]);
      expect(overlay._wrapLore('short line', 20, 2)).toEqual(['short line']);

      const wrapped = overlay._wrapLore('one two three four five six seven', 10, 5);
      expect(wrapped.length).toBeGreaterThan(1);
      expect(wrapped.every((l) => l.length <= 10)).toBe(true);

      const capped = overlay._wrapLore('one two three four five six seven eight nine', 10, 2);
      expect(capped.length).toBe(2);
      expect(capped[1].endsWith('…')).toBe(true);
    });

    it('lore is searchable and boss hits jump to the Foes tab', () => {
      unlockAllActs();
      const data = { ...gameData, enemies: structuredClone(gameData.enemies) };
      data.enemies.bosses.act1[0].lore = 'He held the xyzzy pass alone.';
      const overlay = new CompendiumOverlay(makeScene(), data, vi.fn());
      overlay.show();
      overlay.searchInputActive = true;
      overlay._setSearchQuery('xyzzy');
      expect(overlay.searchResults.length).toBe(1);
      expect(overlay.activeTabIndex).toBe(9);
      overlay.hide();
    });

    it('class names index once (Class tab), not again under Foes', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.show();
      overlay.searchInputActive = true;
      overlay._setSearchQuery('Myrmidon');
      expect(overlay.searchResults.length).toBeGreaterThan(0);
      expect(overlay.searchResults.every((r) => r.tabIndex !== 9)).toBe(true);
      overlay.hide();
    });
  });

  describe('Foes tab boss gating', () => {
    const bossesOf = (overlay) => overlay._getFoesItems().filter((i) => i._kind === 'boss');
    const labelsOf = (overlay) => new Set(bossesOf(overlay).map((b) => b._actLabel));

    it('hides every boss on a fresh save but keeps all classes', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      expect(bossesOf(overlay)).toHaveLength(0);
      const classes = overlay._getFoesItems().filter((i) => i._kind === 'class');
      expect(classes.length).toBe(gameData.classes.length);
    });

    it('reveals only the acts that have been reached', () => {
      seedSlotMilestones(1, ['reachedAct1', 'reachedAct2']);
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      expect(labelsOf(overlay)).toEqual(new Set(['Act 1', 'Act 2']));
    });

    it('gates the final boss behind reachedFinalBoss', () => {
      seedSlotMilestones(1, ['reachedAct4']);
      let overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      expect(labelsOf(overlay).has('Final')).toBe(false);

      seedSlotMilestones(1, ['reachedAct4', 'reachedFinalBoss']);
      overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      expect(labelsOf(overlay).has('Final')).toBe(true);
    });

    it('takes the cross-slot union so a milestone in another slot unlocks it', () => {
      // No registry meta (Title-screen access); milestone lives only in slot 2.
      seedSlotMilestones(2, ['reachedAct3']);
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      expect(labelsOf(overlay).has('Act 3')).toBe(true);
    });

    it('excludes hidden bosses from the search index', () => {
      const data = { ...gameData, enemies: structuredClone(gameData.enemies) };
      data.enemies.bosses.act1[0].lore = 'He held the xyzzy pass alone.';
      const overlay = new CompendiumOverlay(makeScene(), data, vi.fn());
      overlay.show(); // no milestones seeded → act1 boss hidden
      overlay.searchInputActive = true;
      overlay._setSearchQuery('xyzzy');
      expect(overlay.searchResults.length).toBe(0);
      overlay.hide();
    });

    it('re-reads milestones on each show() (real-time unlock)', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.show();
      expect(bossesOf(overlay)).toHaveLength(0);
      overlay.hide();

      seedSlotMilestones(1, ['reachedAct1']);
      overlay.show();
      expect(labelsOf(overlay)).toEqual(new Set(['Act 1']));
      overlay.hide();
    });

    it('renders the empty state under the Bosses filter on a fresh save', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay.activeTabIndex = 9; // Foes
      overlay.activeFilterIndex = 1; // Bosses
      overlay.show();
      expect(overlay._getFilteredItems()).toHaveLength(0);
      const emptyMsg = overlay.objects.find((o) => o.text === 'No foes encountered yet.');
      expect(emptyMsg).toBeTruthy();
      // No page indicator for a single (empty) page — never "Page 1/0".
      expect(
        overlay.objects.some((o) => typeof o.text === 'string' && o.text.includes('Page 1/0')),
      ).toBe(false);
      overlay.hide();
    });
  });

  describe('lore row rendering (Arms/Items)', () => {
    it('weapon rows show a quoted parchment lore line when lore exists, none otherwise', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const sword = {
        name: 'Iron Sword',
        type: 'Sword',
        might: 5,
        hit: 95,
        lore: 'Issued by the crate to the border levies.',
      };
      overlay._renderWeapon(sword, 100, 20, 500);
      const loreObj = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.startsWith('"') && o.y === 128,
      );
      expect(loreObj).toBeTruthy();
      expect(loreObj.style.color).toBe('#c8b878');

      const overlay2 = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      overlay2._renderWeapon({ name: 'Bare Sword', type: 'Sword' }, 100, 20, 500);
      expect(overlay2.objects.some((o) => o.text?.startsWith?.('"'))).toBe(false);
    });

    it('blessing rows show the parchment lore line at the third row', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const blessing = {
        id: 'test_bless',
        name: 'Test Blessing',
        tier: 1,
        description: '+3 Hit for all units.',
        lore: 'The shrine answers whether or not you say the name right.',
      };
      overlay._renderBlessing(blessing, 100, 20, 500);
      const loreObj = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.startsWith('"') && o.y === 128,
      );
      expect(loreObj).toBeTruthy();
      expect(loreObj.style.color).toBe('#c8b878');
    });

    it('item rows show the lore line and ellipsize past the row budget', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const longLore = 'x'.repeat(120);
      overlay._renderItem(
        { name: 'Test Ring', type: 'Accessory', effects: { STR: 1 }, lore: longLore },
        100,
        20,
        500,
      );
      const loreObj = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.startsWith('"') && o.y === 128,
      );
      expect(loreObj).toBeTruthy();
      expect(loreObj.text.length).toBeLessThanOrEqual(84);
      expect(loreObj.text.endsWith('…')).toBe(true);
    });
  });

  describe('renderer schema contracts', () => {
    it('renders scroll teaches line from teachesWeaponArtId when skillId is absent', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const artScroll = gameData.weapons.find(
        (w) => w.type === 'Scroll' && !w.skillId && w.teachesWeaponArtId,
      );
      expect(artScroll).toBeTruthy();

      overlay._renderWeapon(artScroll, 100, 20, 500);
      const teachesLine = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.startsWith('Teaches:'),
      );
      expect(teachesLine).toBeTruthy();
      expect(teachesLine.text).toContain(artScroll.teachesWeaponArtId);
    });

    it('renders class weaponProficiencies when stored as a string', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const klass = gameData.classes.find((c) => typeof c.weaponProficiencies === 'string');
      expect(klass).toBeTruthy();

      overlay._renderClass(klass, 100, 20, 500);
      const classLine = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.includes(klass.weaponProficiencies),
      );
      expect(classLine).toBeTruthy();
    });

    it('renders accessory preventEnemyDouble and doubleThresholdReduction combat effects', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());

      const counterSeal = gameData.accessories.find((a) => a.name === 'Counter Seal');
      expect(counterSeal).toBeTruthy();
      overlay._renderItem(counterSeal, 100, 20, 500);
      const preventDoubleLine = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.includes('Prevent Double'),
      );
      expect(preventDoubleLine).toBeTruthy();

      const overlay2 = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const pursuitRing = gameData.accessories.find((a) => a.name === 'Pursuit Ring');
      expect(pursuitRing).toBeTruthy();
      overlay2._renderItem(pursuitRing, 100, 20, 500);
      const thresholdLine = overlay2.objects.find(
        (o) => typeof o.text === 'string' && o.text.includes('Dbl Thres -2'),
      );
      expect(thresholdLine).toBeTruthy();
    });

    it('renders lord weapon from weapon string, not first character of promotionWeapons', () => {
      const overlay = new CompendiumOverlay(makeScene(), gameData, vi.fn());
      const lord = gameData.lords.find((l) => typeof l.weapon === 'string');
      expect(lord).toBeTruthy();

      overlay._renderLord(lord, 100, 20, 500);
      const lordLine = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.startsWith('Skill:'),
      );
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
      const noMatches = overlay.objects.find((o) => o?.text === 'No matches');
      expect(noMatches).toBeTruthy();
    });
  });

  describe('null-safety', () => {
    it('missing weaponArts/blessings/affixes returns empty arrays', () => {
      const sparseData = {
        ...gameData,
        weaponArts: undefined,
        blessings: undefined,
        affixes: undefined,
      };
      const overlay = new CompendiumOverlay(makeScene(), sparseData, vi.fn());
      expect(overlay._getItemsForTab(2)).toEqual([]); // Arts
      expect(overlay._getItemsForTab(6)).toEqual([]); // Bless
      expect(overlay._getItemsForTab(8)).toEqual([]); // Affixes
    });

    it('show() with sparse data does not throw', () => {
      const sparseData = {
        weapons: [],
        skills: [],
        classes: [],
        consumables: [],
        accessories: [],
        whetstones: [],
        lords: [],
        terrain: [],
      };
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
      expect(scene.game.events.emit).toHaveBeenCalledWith(
        'mobile:pushContext',
        expect.objectContaining({ context: 'overlay_tabs' }),
      );
      const pushCount = scene.game.events.emit.mock.calls.filter(
        (c) => c[0] === 'mobile:pushContext',
      ).length;
      expect(pushCount).toBe(1);

      overlay.hide();
      const popCount = scene.game.events.emit.mock.calls.filter(
        (c) => c[0] === 'mobile:popContext',
      ).length;
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

      const nav = overlay.objects.find(
        (o) => typeof o.text === 'string' && o.text.startsWith('Page '),
      );
      expect(nav).toBeTruthy();
      const navY = nav.y;

      const contentTexts = overlay.objects.filter(
        (o) =>
          typeof o.text === 'string' &&
          typeof o.y === 'number' &&
          o.y >= 130 &&
          o.text !== '\u25C0 Prev' &&
          o.text !== 'Next \u25B6' &&
          !o.text.startsWith('Page '),
      );
      expect(contentTexts.length).toBeGreaterThan(0);
      const maxContentY = Math.max(...contentTexts.map((o) => o.y));
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
    const compendiumBtn = pause.objects.find((o) => o.text === 'Compendium');
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
    const compendiumBtn = pause.objects.find((o) => o.text === 'Compendium');
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
    const compendiumBtn = pause.objects.find((o) => o.text === 'Compendium');
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
    const abandonBtn = pause.objects.find((o) => o.text === 'Abandon Run');
    expect(abandonBtn).toBeTruthy();
    abandonBtn.handlers.pointerdown();
    expect(pause.confirmObjects.length).toBeGreaterThan(0);

    // Open Compendium — should auto-dismiss confirm
    const compendiumBtn = pause.objects.find((o) => o.text === 'Compendium');
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
    const compendiumBtn = pause.objects.find((o) => o.text === 'Compendium');
    expect(compendiumBtn).toBeFalsy();
  });
});
