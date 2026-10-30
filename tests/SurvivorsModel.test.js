// Darkest Before Dawn: the menus' words (ui/survivors/survivorsModel.js), the night's colour,
// and where Home Base offers the mode (web only).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { loadGameData } from './testData.js';
import {
  BEST_KEY,
  bestFor,
  choiceView,
  clockText,
  gainsLine,
  recordNight,
  resultView,
} from '../src/ui/survivors/survivorsModel.js';
import { survivorsEntryShown } from '../src/utils/survivorsEntry.js';
import { createSurvivorsWorld } from '../src/engine/survivors/SurvivorsSim.js';
import { hasItemIcon, itemIconId } from '../src/ui/itemIcons.js';

const config = JSON.parse(readFileSync(new URL('../data/survivors.json', import.meta.url), 'utf8'));

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    data,
  };
}

describe('the menus’ words', () => {
  it('shows the clock as m:ss', () => {
    expect(clockText(600)).toBe('10:00');
    expect(clockText(67.9)).toBe('1:07');
    expect(clockText(-3)).toBe('0:00');
  });

  it('lists a level’s gains in stat order, and nothing for no gains', () => {
    expect(gainsLine({ HP: 1, STR: 0, SPD: 2, LCK: 1 })).toBe('HP +1 · SPD +2 · LCK +1');
    expect(gainsLine({ HP: 0 })).toBeNull();
    expect(gainsLine(null)).toBeNull();
  });

  it('names a new weapon by its description and an upgrade by its level note', () => {
    expect(choiceView(config, { kind: 'weapon', id: 'sword', level: 1 })).toMatchObject({
      title: 'Sword',
      tag: 'New weapon',
      note: config.weapons.sword.description,
      icon: 'Iron Sword',
    });
    expect(choiceView(config, { kind: 'weapon', id: 'sword', level: 4 })).toMatchObject({
      title: 'Sword 4',
      tag: 'Level 4',
      note: config.weapons.sword.levels[3].note,
      icon: 'Silver Sword',
    });
    expect(choiceView(config, { kind: 'passive', id: 'sol', level: 1 }).tag).toBe('New skill');
    expect(choiceView(config, { kind: 'rest', id: 'rest', level: 0 }).title).toBe('Rest');
  });

  it('every choice the mode can offer has an item icon of its own', () => {
    const subjects = [];
    for (const [id, def] of Object.entries(config.weapons))
      def.levels.forEach((_, i) =>
        subjects.push(choiceView(config, { kind: 'weapon', id, level: i + 1 }).icon),
      );
    for (const id of Object.keys(config.passives))
      subjects.push(choiceView(config, { kind: 'passive', id, level: 1 }).icon);
    for (const icon of subjects) expect(hasItemIcon(itemIconId(icon)), icon).toBe(true);
  });

  it('sums up a lost night with how long it held and the damage by weapon', () => {
    const world = createSurvivorsWorld({
      config,
      gameData: loadGameData(),
      lordName: 'Edric',
      seed: 1,
    });
    world.t = 125.4;
    world.status = 'lost';
    world.kills = 40;
    world.damageByWeapon = { sword: 300, bow: 900 };
    const view = resultView(world, { best: 125 });
    expect(view.won).toBe(false);
    expect(view.title).toBe('The night takes you');
    expect(view.lines[0]).toBe('You held for 2:05.');
    expect(view.lines).toContain('Best night with Edric: 2:05');
    expect(view.damage.map((d) => d.name)).toEqual(['Bow', 'Sword']);
    world.status = 'won';
    expect(resultView(world, { best: 600 }).title).toBe('Dawn breaks');
    expect(resultView(world, { best: 600 }).lines).toContain('Best night with Edric: dawn');
  });
});

describe('the best night on this device', () => {
  it('keeps each lord’s longest night', () => {
    const storage = memoryStorage();
    expect(bestFor('Edric', storage)).toBeNull();
    expect(recordNight('Edric', 200.7, storage)).toBe(200);
    expect(recordNight('Edric', 90, storage)).toBe(200);
    expect(recordNight('Kira', 600, storage)).toBe(600);
    expect(bestFor('Edric', storage)).toBe(200);
    expect(JSON.parse(storage.data[BEST_KEY])).toEqual({ Edric: 200, Kira: 600 });
  });

  it('survives a refused write or a broken record', () => {
    const refusing = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(recordNight('Edric', 50, refusing)).toBe(50);
    expect(bestFor('Edric', refusing)).toBeNull();
  });
});

describe('where Home Base offers it', () => {
  it('never in the iOS or Android app', () => {
    expect(survivorsEntryShown({ native: {}, env: { DEV: true } })).toBe(false);
  });

  it('on the web only where review routes run, never on the live site yet', () => {
    expect(survivorsEntryShown({ native: null, env: { DEV: true } })).toBe(true);
    expect(survivorsEntryShown({ native: null, env: { VITE_DEV_ROUTES: 'true' } })).toBe(true);
    expect(survivorsEntryShown({ native: null, env: { PROD: true } })).toBe(false);
  });
});
