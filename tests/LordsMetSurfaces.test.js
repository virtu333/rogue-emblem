// Lords met (playtest 2026-09-29, row 15): the home base (phone Starting lords tab and
// the canvas commander picker), the Compendium and the phone Reference menu list only
// lords this save has met; an unmet lord's name and portrait never reach the page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { getMetaKey } from '../src/engine/SlotManager.js';
import { MobileHomeBase } from '../src/ui/MobileHomeBase.js';
import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';
import { CompendiumOverlay } from '../src/ui/CompendiumOverlay.js';
import { compendiumEntries } from '../src/ui/ReferenceMenu.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  configurable: true,
  writable: true,
});

const gameData = loadGameData();
const ALL = gameData.lords.map((l) => l.name);
const UNMET_ON_A_NEW_SAVE = ALL.filter((n) => n !== 'Edric' && n !== 'Sera');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});
afterEach(() => vi.unstubAllGlobals());

/** A slot-1 meta with every commander-choice tier, having met `met` besides the pair. */
function metaWith(met) {
  const meta = new MetaProgressionManager(gameData.metaUpgrades, getMetaKey(1));
  meta.milestones.add('beatHard');
  meta.purchasedUpgrades.legendary_heir = 1;
  meta.purchasedUpgrades.commander_choice = 1;
  meta.purchasedUpgrades.partner_choice = 1;
  meta.recordLordsMet(met);
  return meta;
}

function allText(el) {
  const parts = [el.textContent || ''];
  for (const node of el.querySelectorAll('img')) parts.push(node.alt || '', node.src || '');
  return parts.join(' ');
}

describe('phone home base: Starting lords', () => {
  function render(meta, role = 'commander') {
    installFakeDom(vi);
    const home = Object.create(MobileHomeBase.prototype);
    Object.assign(home, {
      meta,
      role,
      tab: 'lords',
      visible: true,
      onboarding: [],
      root: document.createElement('section'),
      scene: {
        gameData,
        _getHealedLordSelection: () =>
          HomeBaseScene.prototype._getHealedLordSelection.call({ meta, gameData }),
      },
    });
    home.render();
    return home.root;
  }
  const cardNames = (root) =>
    root.querySelectorAll('.mh-lord').map((b) => b.querySelector('strong').textContent);

  it('a new save lists Edric and Sera only, with no trace of the others', () => {
    for (const role of ['commander', 'partner']) {
      const root = render(metaWith([]), role);
      expect(cardNames(root)).toEqual(['Edric', 'Sera']);
      const text = allText(root);
      for (const name of UNMET_ON_A_NEW_SAVE) {
        expect(text).not.toContain(name);
        expect(text.toLowerCase()).not.toContain(`lord_${name.toLowerCase()}`);
      }
      expect(root.querySelector('.mh-more-lords')?.textContent).toBe(
        'More lords join as you meet them.',
      );
    }
  });

  it('a met lord appears (lords.json order) and every lord once all are met', () => {
    expect(cardNames(render(metaWith(['Cael'])))).toEqual(['Edric', 'Sera', 'Cael']);
    const root = render(metaWith(ALL));
    expect(cardNames(root)).toEqual(ALL);
    expect(root.querySelector('.mh-more-lords')).toBe(null);
  });
});

describe('canvas home base: commander picker', () => {
  function pickerTexts(meta, mode) {
    const texts = [];
    const obj = () => {
      const o = {
        setOrigin: () => o,
        setDepth: () => o,
        setStrokeStyle: () => o,
        setInteractive: () => o,
        setDisplaySize: () => o,
        setColor: () => o,
        setResolution: () => o,
        on: () => o,
        destroy() {},
      };
      return o;
    };
    const scene = Object.create(HomeBaseScene.prototype);
    Object.assign(scene, {
      meta,
      gameData,
      cameras: { main: { centerX: 320, centerY: 240 } },
      registry: { get: () => null },
      textures: { exists: () => false, get: () => ({ has: () => false }) },
      add: {
        rectangle: obj,
        image: (_x, _y, key) => {
          texts.push(String(key));
          return obj();
        },
        text: (_x, _y, text) => {
          texts.push(String(text));
          return obj();
        },
      },
      _destroyCommanderPicker: () => {},
      _destroySkillPicker: () => {},
      _hideMetaTooltips: () => {},
    });
    scene._showCommanderPicker(mode);
    return texts.join('\n');
  }

  it('shows only met lords, and says more will come', () => {
    const text = pickerTexts(metaWith([]), 'commander');
    expect(text).toContain('Edric');
    expect(text).toContain('Sera');
    for (const name of UNMET_ON_A_NEW_SAVE) expect(text).not.toContain(name);
    expect(text).toContain('More lords join as you meet them.');
    const later = pickerTexts(metaWith(['Voss']), 'partner');
    expect(later).toContain('Voss');
    expect(later).not.toContain('Kira');
    const all = pickerTexts(metaWith(ALL), 'commander');
    for (const name of ALL) expect(all).toContain(name);
    expect(all).not.toContain('More lords join');
  });
});

describe('Compendium and Reference menu: Lords', () => {
  const scene = () => ({
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {},
    input: { keyboard: { on() {}, off() {} } },
    events: { emit() {}, on() {}, off() {}, once() {} },
  });
  const LORDS_TAB = 5;

  it('lists met lords only; a lord met in any slot appears', () => {
    const overlay = new CompendiumOverlay(scene(), gameData, vi.fn());
    const names = () =>
      compendiumEntries(overlay, LORDS_TAB, 0, 'lords').map((entry) => entry.name);
    expect(names()).toEqual(['Edric', 'Sera']);
    const lines = compendiumEntries(overlay, LORDS_TAB, 0, 'lords')
      .flatMap((e) => e.lines)
      .join('\n');
    for (const name of UNMET_ON_A_NEW_SAVE) expect(lines).not.toContain(name);

    store[getMetaKey(3)] = JSON.stringify({ lordsMet: ['Astrid'] });
    overlay._lordsItems = null; // what show() does on every open
    expect(names()).toEqual(['Edric', 'Sera', 'Astrid']);
    expect(overlay._getItemsForTab(LORDS_TAB).map((l) => l.name)).toEqual([
      'Edric',
      'Sera',
      'Astrid',
    ]);
  });
});
