// Weapon rule tags reach the screens that show a weapon (docs/specs/item-keywords.md).
// Naming review 2026-09-26: lore names alone didn't say what a weapon is or does, and
// the raw `special` text either sat in a paragraph (roster), after a blank line
// (rewards), nowhere at all (compendium, battle trade), or as "Special: …" (shop).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { BattleTradeMenu } from '../src/ui/BattleTradeMenu.js';
import { compendiumEntries } from '../src/ui/ReferenceMenu.js';
import { CompendiumOverlay, TAB_DEFS } from '../src/ui/CompendiumOverlay.js';
import { itemKeywordRow } from '../src/ui/itemKeywordChips.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = loadGameData();
const cls = (name) => gameData.classes.find((c) => c.name === name);
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));

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

function rosterSheet(inventory, consumables = []) {
  const run = new RunManager(gameData);
  run.startRun();
  const soldier = createRecruitUnit({ name: 'Harl', level: 3 }, cls('Knight'), gameData.weapons);
  soldier.inventory = inventory;
  soldier.weapon = inventory[0];
  soldier.consumables = consumables;
  run.roster.push(soldier);
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
  sheet.index = sheet.units.indexOf(soldier);
  sheet.tab = 'gear';
  sheet.render();
  return sheet;
}

// A card's keyword row, read without descendant selectors (the fake DOM has none).
function keysOf(card) {
  const all = card._descendants();
  return {
    title: all.find((n) => n.tagName === 'H4')?.textContent || '',
    base: all.find((n) => n.classList?.contains('re-item-base'))?.textContent ?? null,
    tags: all.filter((n) => n.classList?.contains('re-item-tag')).map((n) => n.textContent),
    paragraphs: all.filter((n) => n.tagName === 'P').map((n) => n.textContent),
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

describe('keyword row', () => {
  it('draws the base line and one tag per rule, each with its full rule', () => {
    const row = itemKeywordRow(weapon('Axehook'));
    const all = row._descendants();
    expect(all.find((n) => n.classList?.contains('re-item-base')).textContent).toBe('Steel Lance');
    const tag = all.find((n) => n.classList?.contains('re-item-tag'));
    expect(tag.textContent).toBe('Beats Axes');
    expect(tag.title).toMatch(/loses to Swords/);
    expect(tag.getAttribute('role')).toBe('listitem');
  });

  it('is left out when there is nothing to add', () => {
    expect(itemKeywordRow(weapon('Silver Sword'))).toBeNull();
    expect(itemKeywordRow(gameData.consumables[0])).toBeNull();
  });
});

describe('roster sheet', () => {
  it('a weapon card says what it is and its rule, and states the special once', () => {
    const sheet = rosterSheet([weapon('Axehook'), weapon('Iron Lance')]);
    const cards = sheet.root.querySelectorAll('.mr-item-card').map(keysOf);
    const reaver = cards.find((c) => c.title.startsWith('Axehook'));
    expect(reaver.base).toBe('Steel Lance');
    expect(reaver.tags).toEqual(['Beats Axes']);
    expect(reaver.paragraphs.some((p) => p.includes('Reverses weapon triangle'))).toBe(false);
    // The stat line no longer repeats the type the base line gives.
    expect(reaver.paragraphs.some((p) => p.startsWith('Might '))).toBe(true);
    // A plain weapon whose name says what it is needs no row.
    const iron = cards.find((c) => c.title.startsWith('Iron Lance'));
    expect(iron.base).toBeNull();
    expect(iron.tags).toEqual([]);
    sheet.destroy();
  });

  it('a stat booster card names its stat once, as a tag', () => {
    const booster = structuredClone(
      gameData.consumables.find((c) => c.effect === 'statBoost' && c.stat === 'STR'),
    );
    const sheet = rosterSheet([weapon('Iron Lance')], [booster]);
    const card = sheet.root
      .querySelectorAll('.mr-item-card')
      .map(keysOf)
      .find((c) => c.title.startsWith(booster.name));
    expect(card.tags).toEqual(['+2 STR']);
    expect(card.paragraphs.filter((p) => p.includes('+2 STR'))).toEqual([]);
    expect(card.paragraphs.some((p) => p.startsWith('Permanent'))).toBe(true);
    sheet.destroy();
  });
});

describe('battle trade', () => {
  it('rows carry the rule tags after the numbers', () => {
    const javelin = weapon('Javelin');
    const left = { name: 'Harl', inventory: [javelin], consumables: [], weapon: javelin };
    const right = { name: 'Brom', inventory: [], consumables: [], weapon: null };
    const menu = Object.create(BattleTradeMenu.prototype);
    Object.assign(menu, {
      scene: {},
      left,
      right,
      surface: { body: document.createElement('div') },
    });
    menu.render();
    const row = menu.surface.body.querySelectorAll('.re-row')[0];
    const detail = row.children.find((c) => c.tagName === 'SMALL').textContent;
    expect(detail).toMatch(/^Lance · Mt \d+ · Hit \d+ · Wt \d+ · Thrown$/);
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

  it('weapons list as what they are and their rules, and keep the item for the detail', () => {
    const entries = compendiumEntries(view(), tab('weapons'), 0);
    const byName = (name) => entries.find((e) => e.name === name);
    expect(byName('Keen Sword').summary).toBe('Silver Sword · Crit 30');
    expect(byName('Axehook').summary).toBe('Steel Lance · Beats Axes');
    expect(byName('Twinsworn').summary).toBe('Legend Sword · Strikes twice');
    expect(byName('Iron Sword').summary).toBe('Iron Sword');
    expect(byName('Axehook').item.name).toBe('Axehook');
  });

  it('other tabs keep their summaries', () => {
    const entries = compendiumEntries(view(), tab('classes'), 0);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => !/Crit|Beats/.test(e.summary))).toBe(true);
  });
});
