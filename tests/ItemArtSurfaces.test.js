// Item art reaches every surface that shows an item (docs/specs/items-art.md, Wiring).
// Playtest 2026-09-26: the roster's equipped accessory was a generic "Equipped accessory"
// card with the name buried in its detail line and no picture or story, and the shared
// accessory pool, team scrolls, battle trade rows and the compendium showed no art.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { BattleTradeMenu } from '../src/ui/BattleTradeMenu.js';
import { compendiumEntries } from '../src/ui/ReferenceMenu.js';
import { CompendiumOverlay, TAB_DEFS } from '../src/ui/CompendiumOverlay.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = loadGameData();
const cls = (name) => gameData.classes.find((c) => c.name === name);
const accessory = (name) => structuredClone(gameData.accessories.find((a) => a.name === name));

function eventsFor() {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    once: (name, fn) => listeners(name).add(fn),
    on: (name, fn) => listeners(name).add(fn),
    off: (name, fn) => listeners(name).delete(fn),
    emit: (name) => [...listeners(name)].forEach((fn) => fn()),
  };
}

function rosterSheet() {
  const run = new RunManager(gameData);
  run.startRun();
  const archer = createRecruitUnit({ name: 'Daska', level: 3 }, cls('Archer'), gameData.weapons);
  run.roster.push(archer);
  const scene = {
    gameData,
    runManager: run,
    events: eventsFor(),
    registry: { get: () => null },
    textures: { exists: () => false },
    sys: { settings: { key: 'NodeMap' } },
  };
  const sheet = new MobileRosterSheet({
    scene,
    units: run.roster,
    run,
    gameData,
    persist: null,
    onClose: vi.fn(),
  });
  sheet.index = sheet.units.indexOf(archer);
  return { run, sheet, archer };
}

// A card's parts, read without descendant selectors (the fake DOM has none).
function cardParts(card) {
  const all = card._descendants();
  const text = (tag) =>
    all
      .filter((n) => n.tagName === tag)
      .map((n) => n.textContent)
      .join(' | ');
  return {
    title: text('H4'),
    icon: all.find((n) => n.classList?.contains('ia-icon'))?.dataset.iconId,
    hero: all.find((n) => n.classList?.contains('ia-hero'))?.dataset.iconId,
    lore: all.find((n) => n.classList?.contains('mr-lore'))?.textContent,
    about: text('SUMMARY'),
    equipped: all.some((n) => n.classList?.contains('re-equipped-badge')),
  };
}

beforeEach(() => {
  installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetInputFocus();
});

describe('roster sheet', () => {
  it('the equipped accessory is a named item card with its picture and story', () => {
    const { sheet, archer } = rosterSheet();
    archer.accessory = accessory('Forest Charm');
    sheet.tab = 'gear';
    sheet.render();
    const cards = sheet.root.querySelectorAll('.mr-item-card').map(cardParts);
    expect(cards.some((c) => c.title.includes('Equipped accessory'))).toBe(false);
    const charm = cards.find((c) => c.title.startsWith('Forest Charm'));
    expect(charm).toBeTruthy();
    expect(charm.icon).toBe('forest-charm');
    expect(charm.hero).toBe('forest-charm');
    expect(charm.about).toBe('About this item');
    expect(charm.lore).toBe(archer.accessory.lore);
    expect(charm.equipped).toBe(true);
    // Its effect reads as an accessory, not as a weapon with blank stats.
    const detail = sheet.root
      .querySelectorAll('.mr-item-card')
      .find((c) => cardParts(c).title.startsWith('Forest Charm'))
      ._descendants()
      .find((n) => n.tagName === 'P').textContent;
    expect(detail).toContain('+2 Def');
    expect(detail).not.toContain('Might');
    sheet.destroy();
  });

  it('pool accessories carry their picture and story; none is marked equipped', () => {
    const { run, sheet } = rosterSheet();
    run.accessories = [accessory('Power Ring'), accessory('Mercury Sandals')];
    sheet.tab = 'gear';
    sheet.render();
    const cards = sheet.root.querySelectorAll('.mr-item-card').map(cardParts);
    for (const item of run.accessories) {
      const card = cards.find((c) => c.title.startsWith(item.name));
      expect(card, item.name).toBeTruthy();
      expect(card.icon).toBe(card.hero);
      expect(card.icon.startsWith('generic-')).toBe(false);
      expect(card.lore).toBe(item.lore);
      expect(card.equipped).toBe(false);
    }
    expect(cards.find((c) => c.title === 'No accessory')).toBeUndefined();
    sheet.destroy();
  });

  it('without an accessory the section says so plainly', () => {
    const { sheet, archer } = rosterSheet();
    archer.accessory = null;
    sheet.tab = 'gear';
    sheet.render();
    const titles = sheet.root.querySelectorAll('h4').map((n) => n.textContent);
    expect(titles).toContain('No accessory');
    sheet.destroy();
  });

  it('team scrolls tell their story beside their seal', () => {
    const { run, sheet } = rosterSheet();
    const scroll = structuredClone(gameData.weapons.find((w) => w.name === 'Sol Scroll'));
    run.scrolls = [scroll];
    sheet.tab = 'skills';
    sheet.render();
    const card = sheet.root
      .querySelectorAll('.mr-item-card')
      .map(cardParts)
      .find((c) => c.title === 'Sol Scroll');
    expect(card.icon).toBe('sol-scroll');
    expect(card.lore).toBe(scroll.lore);
    sheet.destroy();
  });
});

describe('battle trade', () => {
  it('every row leads with its item icon', () => {
    const iron = structuredClone(gameData.weapons.find((w) => w.name === 'Iron Bow'));
    const salve = structuredClone(gameData.consumables.find((c) => c.name === 'Vulnerary'));
    const left = { name: 'Daska', inventory: [iron], consumables: [salve], weapon: iron };
    const right = { name: 'Brom', inventory: [], consumables: [], weapon: null };
    const menu = Object.create(BattleTradeMenu.prototype);
    Object.assign(menu, {
      scene: {},
      left,
      right,
      surface: { body: document.createElement('div') },
    });
    menu.render();
    const rows = menu.surface.body.querySelectorAll('.re-row');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.classList.contains('re-row--item'))).toBe(true);
    const ids = rows.map(
      (r) => r.children.find((c) => c.classList?.contains('ia-icon'))?.dataset.iconId,
    );
    expect(ids).toEqual(['iron-bow', 'vulnerary']);
  });
});

describe('compendium', () => {
  const view = () => {
    const overlay = Object.create(CompendiumOverlay.prototype);
    overlay.gameData = gameData;
    overlay.searchQuery = '';
    return overlay;
  };
  const tab = (key) => TAB_DEFS.findIndex((t) => t.key === key);

  it.each([
    ['weapons', 'item'],
    ['items', 'item'],
    ['blessings', 'blessing'],
  ])('%s entries carry their art', (key, kind) => {
    const entries = compendiumEntries(view(), tab(key), 0, key);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.art?.kind, entry.name).toBe(kind);
      expect(entry.art.subject.name).toBe(entry.name);
    }
  });

  it('classes and skills stay text', () => {
    for (const key of ['classes', 'skills']) {
      const entries = compendiumEntries(view(), tab(key), 0, key);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => !e.art)).toBe(true);
    }
  });
});
