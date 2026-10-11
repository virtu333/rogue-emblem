// While the Descent is dark (data/descent.json `enabled: false`, or no such file) a player
// can meet nothing of Act V, so Help and the Compendium must not teach or list it: the
// Court Circle page, the Circle Adept, the Hollowed and Greycord's "???" slot. With the
// Descent on they all appear; a save that has already met one keeps it. The flag is read
// through engine/DescentSwitch.js only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HELP_TABS, helpTabsFor } from '../src/data/helpContent.js';
import { HelpOverlay } from '../src/ui/HelpOverlay.js';
import { PauseOverlay } from '../src/ui/PauseOverlay.js';
import { CompendiumOverlay, TAB_DEFS } from '../src/ui/CompendiumOverlay.js';
import { compendiumEntries } from '../src/ui/ReferenceMenu.js';
import { discoveryView } from '../src/engine/CompendiumDiscovery.js';
import { descentEntryShown, isDescentEnabled, isDescentOnly } from '../src/engine/DescentSwitch.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (Object.hasOwn(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  },
  configurable: true,
  writable: true,
});
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

const base = loadGameData();
const dark = base; // this tree ships no descent.json: dark by absence
const darkByFlag = { ...base, descent: { enabled: false } };
const lit = { ...base, descent: { enabled: true } };

const HIDDEN_CLASSES = ['Circle Adept', 'Hollowed'];
const HIDDEN_WEAPON = 'Greycord';
const tab = (key) => TAB_DEFS.findIndex((t) => t.key === key);
const names = (list) => list.map((e) => e.name);

/** A Compendium view with a save that has met these items. */
function compendium(gameData, seenItems = []) {
  const view = Object.create(CompendiumOverlay.prototype);
  view.gameData = gameData;
  view.searchQuery = '';
  view._discovery = discoveryView({ items: seenItems });
  return view;
}

function helpTitles(tabs) {
  return tabs.flatMap((t) => t.pages.map((p) => p.title));
}

describe('the data tags', () => {
  it('marks exactly the three Descent-only entries', () => {
    expect(base.classes.filter(isDescentOnly).map((c) => c.name)).toEqual(HIDDEN_CLASSES);
    expect(base.weapons.filter(isDescentOnly).map((w) => w.name)).toEqual([HIDDEN_WEAPON]);
  });

  it('the switch reads only an explicit true', () => {
    expect(isDescentEnabled(dark)).toBe(false);
    expect(isDescentEnabled(darkByFlag)).toBe(false);
    expect(isDescentEnabled({ ...base, descent: { enabled: 'yes' } })).toBe(false);
    expect(isDescentEnabled(lit)).toBe(true);
    expect(isDescentEnabled(null)).toBe(false);
  });

  it('descentEntryShown: a Descent entry needs the switch or a meeting; others always show', () => {
    const adept = base.classes.find((c) => c.name === 'Circle Adept');
    const mage = base.classes.find((c) => c.name === 'Mage');
    expect(descentEntryShown(adept, dark)).toBe(false);
    expect(descentEntryShown(adept, dark, true)).toBe(true);
    expect(descentEntryShown(adept, lit)).toBe(true);
    expect(descentEntryShown(mage, dark)).toBe(true);
  });
});

describe('Help', () => {
  it('shows the Court Circle page only when the Descent is on', () => {
    expect(helpTitles(helpTabsFor(dark))).not.toContain('The Court Circle');
    expect(helpTitles(helpTabsFor(darkByFlag))).not.toContain('The Court Circle');
    expect(helpTitles(helpTabsFor(null))).not.toContain('The Court Circle');
    expect(helpTitles(helpTabsFor(lit))).toContain('The Court Circle');
    // The catalog keeps the page; nothing else is dropped while dark.
    expect(helpTitles(HELP_TABS)).toContain('The Court Circle');
    expect(helpTitles(helpTabsFor(dark)).length).toBe(helpTitles(HELP_TABS).length - 1);
  });

  const scene = (extra = {}) => ({
    cameras: { main: { centerX: 320, centerY: 240 } },
    game: { events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } },
    ...extra,
  });

  it('the overlay lists and searches the tabs it was given', () => {
    const search = (gameData) => {
      const overlay = new HelpOverlay(scene(), vi.fn(), gameData);
      overlay._buildSearchIndex();
      return overlay.searchIndex.some((e) => /court circle/.test(JSON.stringify(e)));
    };
    expect(helpTitles(new HelpOverlay(scene(), vi.fn(), dark).tabs)).not.toContain(
      'The Court Circle',
    );
    expect(search(dark)).toBe(false);
    expect(helpTitles(new HelpOverlay(scene(), vi.fn(), lit).tabs)).toContain('The Court Circle');
    expect(search(lit)).toBe(true);
  });

  it('a scene that owns the game data (the title) is read when none is passed', () => {
    expect(helpTitles(new HelpOverlay(scene({ gameData: lit }), vi.fn()).tabs)).toContain(
      'The Court Circle',
    );
    expect(helpTitles(new HelpOverlay(scene({ gameData: dark }), vi.fn()).tabs)).not.toContain(
      'The Court Circle',
    );
  });

  it("the pause menu hands Help the game data (its own, else its scene's)", () => {
    const open = (gameData, sceneData) => {
      const s = {
        ...scene({ gameData: sceneData }),
        add: {
          rectangle: () => stub(),
          text: (_x, _y, label) => stub({ text: label }),
          graphics: () => stub(),
        },
        input: {
          keyboard: { addKey: () => ({ on: vi.fn(), off: vi.fn() }), on: vi.fn(), off: vi.fn() },
        },
      };
      const pause = new PauseOverlay(s, { onResume: vi.fn(), gameData });
      pause.show();
      pause.objects.find((o) => o.text === 'More Info').handlers.pointerdown();
      return helpTitles(pause.helpOverlay.tabs);
    };
    expect(open(lit, undefined)).toContain('The Court Circle');
    expect(open(undefined, lit)).toContain('The Court Circle'); // the route map's pause
    expect(open(dark, undefined)).not.toContain('The Court Circle');
    expect(open(undefined, undefined)).not.toContain('The Court Circle');
  });
});

function stub(extra = {}) {
  const o = {
    handlers: {},
    style: {},
    setDepth: () => o,
    setInteractive: () => o,
    setStrokeStyle: () => o,
    setOrigin: () => o,
    setColor: () => o,
    lineStyle: () => o,
    beginPath: () => o,
    moveTo: () => o,
    lineTo: () => o,
    strokePath: () => o,
    on(event, handler) {
      o.handlers[event] = handler;
      return o;
    },
    destroy: vi.fn(),
    ...extra,
  };
  return o;
}

describe('the Compendium', () => {
  const classNames = (gameData, seen) =>
    names(compendium(gameData, seen)._getItemsForTab(tab('classes')));
  const armsNames = (gameData, seen) =>
    names(compendium(gameData, seen)._getItemsForTab(tab('weapons')));
  const foeClassNames = (gameData, seen) =>
    names(
      compendium(gameData, seen)
        ._getFoesItems()
        .filter((i) => i._kind === 'class'),
    );

  it('leaves out the Circle Adept, the Hollowed and Greycord while the Descent is off', () => {
    for (const gameData of [dark, darkByFlag]) {
      for (const n of HIDDEN_CLASSES) {
        expect(classNames(gameData)).not.toContain(n);
        expect(foeClassNames(gameData)).not.toContain(n);
      }
      expect(armsNames(gameData)).not.toContain(HIDDEN_WEAPON);
    }
    // Only those three go: every other class and weapon is still listed.
    expect(classNames(dark)).toHaveLength(base.classes.length - 2);
    expect(armsNames(dark)).toHaveLength(base.weapons.length - 1);
    expect(foeClassNames(dark)).toHaveLength(base.classes.length - 2);
  });

  it('lists them with the Descent on', () => {
    for (const n of HIDDEN_CLASSES) {
      expect(classNames(lit)).toContain(n);
      expect(foeClassNames(lit)).toContain(n);
    }
    expect(armsNames(lit)).toContain(HIDDEN_WEAPON);
    expect(classNames(lit)).toHaveLength(base.classes.length);
    expect(armsNames(lit)).toHaveLength(base.weapons.length);
  });

  it('shows no "???" slot for Greycord, and counts the tab without it', () => {
    const rows = compendiumEntries(compendium(dark, ['Iron Sword']), tab('weapons'), 0, 'weapons');
    expect(rows).toHaveLength(base.weapons.length - 1);
    expect(rows.at(-1).lines.at(-1)).toBe(`1 of ${base.weapons.length - 1} found.`);
    const litRows = compendiumEntries(
      compendium(lit, ['Iron Sword']),
      tab('weapons'),
      0,
      'weapons',
    );
    expect(litRows).toHaveLength(base.weapons.length);
  });

  it('keeps an entry the save has already met, even while dark', () => {
    // Greycord met: the weapon row stays, and so does the Adept who carries it.
    expect(armsNames(dark, [HIDDEN_WEAPON])).toContain(HIDDEN_WEAPON);
    expect(classNames(dark, [HIDDEN_WEAPON])).toContain('Circle Adept');
    expect(foeClassNames(dark, [HIDDEN_WEAPON])).toContain('Circle Adept');
    // The Hollowed has no weapon of its own to have met it by: it stays out.
    expect(classNames(dark, [HIDDEN_WEAPON])).not.toContain('Hollowed');
    // Meeting some other weapon changes nothing.
    expect(armsNames(dark, ['Iron Sword'])).not.toContain(HIDDEN_WEAPON);
  });

  it('never finds a hidden entry by search', () => {
    const view = compendium(dark);
    view._buildSearchIndex();
    const hit = (word) => view.searchIndex.some((e) => e.searchText.includes(word));
    expect(hit('greycord')).toBe(false);
    expect(hit('hollowed')).toBe(false);
    expect(hit('circle adept')).toBe(false);
    const open = compendium(lit, [HIDDEN_WEAPON]);
    open._buildSearchIndex();
    expect(open.searchIndex.some((e) => e.searchText.includes('hollowed'))).toBe(true);
  });
});
