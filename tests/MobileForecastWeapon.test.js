// The phone forecast's attacker side shows the planned weapon (the forecast is
// read-only for equipment: the weapon is equipped only on confirm), never
// attacker.weapon: the stepper's name, count and E badge, the plain weapon line
// and the effectiveness notice.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/healthBar.js', () => ({
  createHealthBar: () => globalThis.document.createElement('div'),
}));
vi.mock('../src/utils/cancelablePress.js', () => ({ bindCancelablePress: () => () => {} }));
vi.mock('../src/ui/portraitArt.js', async (importOriginal) => ({
  ...(await importOriginal()),
  usePc98: () => false,
}));

import { MobileBattleHUD } from '../src/ui/MobileBattleHUD.js';

function fakeElement(tag) {
  const node = {
    tag,
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    dataset: {},
    style: {},
  };
  node.classList = { add: (name) => (node.className = `${node.className} ${name}`.trim()) };
  node.append = (...kids) => node.children.push(...kids);
  node.setAttribute = (key, value) => (node.attributes[key] = String(value));
  node.addEventListener = () => {};
  return node;
}

const all = (node) => [node, ...(node.children || []).flatMap((child) => all(child))];
const byClass = (node, name) =>
  all(node).filter((n) => String(n.className).split(/\s+/).includes(name));

const iron = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5 };
const steel = { name: 'Steel Sword', type: 'Sword', might: 8, hit: 80, crit: 0, weight: 10 };
const bow = { name: 'Iron Bow', type: 'Bow', might: 5, hit: 90, crit: 0, weight: 3, range: '2' };

function side({ validWeapons, weapon, defender = {} }) {
  vi.stubGlobal('document', { createElement: fakeElement });
  const hud = Object.create(MobileBattleHUD.prototype);
  hud.scene = {
    gameData: {},
    textures: { exists: () => false },
    turnManager: { turnNumber: 1 },
    _getPortraitKey: () => null,
  };
  hud.available = () => true;
  const attacker = {
    name: 'Edric',
    currentHP: 20,
    stats: { HP: 20 },
    skills: [],
    weapon: iron,
    inventory: [iron, steel, bow],
  };
  const enemy = { name: 'Harpy', currentHP: 18, stats: { HP: 18 }, skills: [], ...defender };
  const info = { damage: 9, hit: 80, crit: 0, as: 5, attackCount: 1, canCounter: true };
  const config = {
    attacker,
    defender: enemy,
    forecast: { attacker: { ...info, hp: 20 }, defender: { ...info, hp: 18 } },
    weaponArt: null,
    gamblerLine: null,
    validWeapons,
    weapon,
    equippedWeapon: iron,
    targetIndex: 0,
    targetCount: 1,
  };
  return hud.forecastSide(attacker, enemy, config.forecast.attacker, true, config);
}

afterEach(() => vi.unstubAllGlobals());

describe('phone forecast: the planned weapon', () => {
  it('the stepper names and counts the planned weapon, with no E badge', () => {
    const node = side({ validWeapons: [iron, steel], weapon: steel });
    expect(byClass(node, 'mb-step-name').map((n) => n.textContent)).toEqual(['Steel Sword']);
    expect(byClass(node, 'mb-step-count').map((n) => n.textContent)).toEqual(['2/2']);
    expect(byClass(node, 're-equipped-badge')).toEqual([]);
  });

  it('the single-weapon line names the plan, and its effectiveness is the plan’s', () => {
    // Iron stays equipped; only the bow reaches, and bows are effective vs fliers.
    const node = side({ validWeapons: [bow], weapon: bow, defender: { moveType: 'Flying' } });
    expect(byClass(node, 'mb-weapon').map((n) => n.textContent)).toEqual(['Iron Bow']);
    expect(byClass(node, 're-equipped-badge')).toEqual([]);
    expect(byClass(node, 'mb-notice').map((n) => n.textContent)).toContain('Effective damage');
  });

  it('the equipped weapon, when planned, keeps its E badge', () => {
    const node = side({ validWeapons: [iron, steel], weapon: iron });
    expect(byClass(node, 'mb-step-name').map((n) => n.textContent)).toEqual(['Iron Sword']);
    expect(byClass(node, 're-equipped-badge')).toHaveLength(1);
  });
});
