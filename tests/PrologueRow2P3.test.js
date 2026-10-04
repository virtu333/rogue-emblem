// engine/Prologue.js for row 2 and P3 (docs/specs/prologue-chapter.md §6 "Route map,
// row 2" and P3, §9): the fork's nodes carry their previews and the Market its fixed
// wares; the Market's stock is the listed items at a real act-1 shop's prices, never
// random; P3's replay roster is Edric L3, Gaspar and Tamsin with her bow; Sera is built
// green on her tile and protected; the new beat conditions match only their own
// fields, and P3's authored beats run the lessons in the order the spec gives.
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  buildPrologueNodeMap,
  buildPrologueNpcUnit,
  buildPrologueRoster,
  buildPrologueShopStock,
  prologueBeatsFor,
  prologueJoinsAtNode,
  prologueProtectedNames,
} from '../src/engine/Prologue.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { readFileSync } from 'fs';

const economy = JSON.parse(readFileSync(new URL('../data/economy.json', import.meta.url), 'utf8'));

const data = loadGameData();
const prologue = data.prologue;
const P3 = prologue.chapters.find((c) => c.id === 'p3_seer_on_the_road');
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});
const forbidMathRandom = () => {
  Math.random = () => {
    throw new Error('Math.random was drawn');
  };
};

describe('the fork on the route map', () => {
  const map = buildPrologueNodeMap(prologue);
  const node = (id) => map.nodes.find((n) => n.id === id);
  const entry = (id) => prologue.route.nodes.find((n) => n.id === id);

  it("the Market and the Chapel: titles, the route's previews, the Market's wares", () => {
    expect([node('prologue_2a').type, node('prologue_2b').type]).toEqual(['shop', 'church']);
    expect(node('prologue_2a').title).toBe("Harrow's Market");
    expect(node('prologue_2b').title).toBe("Harrow's Chapel");
    expect(node('prologue_2a').preview).toBe(entry('prologue_2a').preview);
    expect(node('prologue_2b').preview).toBe(entry('prologue_2b').preview);
    expect(node('prologue_2a').prologueStock).toEqual([
      'Vulnerary',
      'Vulnerary',
      'Iron Sword',
      'Iron Lance',
      'Javelin',
    ]);
    expect(node('prologue_2b').prologueStock).toBeUndefined();
    // The map's copy is its own (a later edit of the node never reaches the data).
    node('prologue_2a').prologueStock.push('x');
    expect(entry('prologue_2a').stock).toHaveLength(5);
  });

  it('Tamsin joins at either node, and nowhere else', () => {
    expect(prologueJoinsAtNode(prologue, 'prologue_2a')).toEqual(['Tamsin']);
    expect(prologueJoinsAtNode(prologue, 'prologue_2b')).toEqual(['Tamsin']);
    expect(prologueJoinsAtNode(prologue, 'prologue_1')).toEqual([]);
    expect(prologueJoinsAtNode(prologue, 'prologue_3')).toEqual([]);
  });
});

describe('buildPrologueShopStock', () => {
  it('the listed items in order, each at a real act-1 shop price, with no random draw', () => {
    forbidMathRandom();
    const stock = buildPrologueShopStock(
      prologue.route.nodes.find((n) => n.id === 'prologue_2a').stock,
      data,
      { rng: createBattleRng(7) },
    );
    Math.random = realRandom;
    expect(stock.map((s) => s.item.name)).toEqual([
      'Vulnerary',
      'Vulnerary',
      'Iron Sword',
      'Iron Lance',
      'Javelin',
    ]);
    const catalogue = [...data.weapons, ...data.consumables];
    const act1 = economy.shopPriceByAct?.act1 ?? 1;
    for (const entry of stock) {
      const base = catalogue.find((i) => i.name === entry.item.name).price;
      expect(entry.price, entry.item.name).toBe(Math.ceil(base * act1));
    }
    expect(stock.map((s) => s.type)).toEqual([
      'consumable',
      'consumable',
      'weapon',
      'weapon',
      'weapon',
    ]);
    // Two Vulneraries are two items (distinct uids), from the seeded stream.
    expect(stock[0].item.uid).toBeTruthy();
    expect(stock[0].item.uid).not.toBe(stock[1].item.uid);
    const again = buildPrologueShopStock(['Vulnerary', 'Vulnerary'], data, {
      rng: createBattleRng(7),
    });
    // (A uid is a process counter plus the stream's draw: the draw part repeats.)
    const drawn = (uid) => uid.replace(/^itm_\d+_/, '');
    expect(again.map((s) => drawn(s.item.uid))).toEqual(
      stock.slice(0, 2).map((s) => drawn(s.item.uid)),
    );
  });

  it('an unknown item is an error, not a silent gap', () => {
    expect(() => buildPrologueShopStock(['Moon Bow'], data, { rng: () => 0.5 })).toThrow(
      /Moon Bow/,
    );
  });
});

describe('P3: the replay roster and Sera', () => {
  it('a replay fights with Edric at level 3, the standard veteran and Tamsin with her bow', () => {
    const roster = buildPrologueRoster(prologue, data, P3);
    expect(roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar', 'Tamsin']);
    expect(roster[0].level).toBe(3);
    const tamsin = roster[2];
    expect(tamsin.className).toBe('Archer');
    expect(tamsin.weapon?.name).toBe('Iron Bow');
    expect(tamsin.inventory.map((w) => w.name)).toEqual(['Iron Bow']);
    // Her authored spec stays unarmed: only the replay hands her the bow.
    expect(prologue.units.Tamsin.inventory).toEqual([]);
  });

  it('Sera is built green on her tile, with her authored kit, and is protected', () => {
    forbidMathRandom();
    const sera = buildPrologueNpcUnit({ prologueUnit: 'Sera', col: 4, row: 2 }, data);
    Math.random = realRandom;
    expect(sera.name).toBe('Sera');
    expect(sera.faction).toBe('npc');
    expect([sera.col, sera.row]).toEqual([P3.npc.col, P3.npc.row]);
    expect(sera.level).toBe(prologue.units.Sera.level);
    expect(sera.weapon?.name).toBe('Glimmer');
    expect(sera.inventory.map((w) => w.name)).toEqual(['Glimmer', 'Heal']);
    expect(sera.consumables.map((c) => c.name)).toEqual(['Vulnerary']);
    for (const [stat, value] of Object.entries(prologue.units.Sera.stats))
      expect(sera.stats[stat], stat).toBe(value);
    expect([sera.hasMoved, sera.hasActed]).toEqual([false, false]);
    expect(buildPrologueNpcUnit({ col: 4, row: 2 }, data)).toBeNull();
    expect(() => buildPrologueNpcUnit({ prologueUnit: 'Nobody', col: 0, row: 0 }, data)).toThrow();
    expect(prologueProtectedNames(P3, data)).toEqual(['Edric', 'Gaspar', 'Tamsin', 'Sera']);
  });
});

describe('the new beat conditions', () => {
  const ch = (beats) => ({ id: 'c', beats });
  const ids = (beats, event) => prologueBeatsFor(ch(beats), event).fired;

  it('hurt reads event.hurt on unitSelected and turnStart', () => {
    const beats = [
      { id: 'sel', on: 'unitSelected', unit: 'Sera', hurt: true, do: [{ note: 'a' }] },
      { id: 'calm', on: 'unitSelected', unit: 'Sera', hurt: false, do: [{ note: 'b' }] },
      { id: 'ts', on: 'turnStart', turn: 2, hurt: true, do: [{ note: 'c' }] },
    ];
    expect(ids(beats, { type: 'unitSelected', unit: 'Sera', hurt: true })).toEqual(['sel']);
    expect(ids(beats, { type: 'unitSelected', unit: 'Sera' })).toEqual(['calm']);
    expect(ids(beats, { type: 'turnStart', phase: 'player', turn: 2, hurt: true })).toEqual(['ts']);
    expect(ids(beats, { type: 'turnStart', phase: 'player', turn: 2, hurt: false })).toEqual([]);
  });

  it('safe, inRange, foeDistance, besideAlly and afterRewind each read their own field', () => {
    const beats = [
      { id: 'safe', on: 'afterMove', safe: true, do: [{ markLesson: { id: 'x', kind: 'shown' } }] },
      { id: 'out', on: 'afterMove', inRange: false, do: [{ markLesson: { id: 'x', kind: 'shown' } }] }, // prettier-ignore
      { id: 'd2', on: 'afterMove', foeDistance: 2, do: [{ markLesson: { id: 'x', kind: 'shown' } }] }, // prettier-ignore
      { id: 'pair', on: 'afterMove', besideAlly: true, do: [{ markLesson: { id: 'x', kind: 'shown' } }] }, // prettier-ignore
      { id: 'again', on: 'afterMove', afterRewind: true, do: [{ markLesson: { id: 'x', kind: 'shown' } }] }, // prettier-ignore
    ];
    const move = (fields) => ids(beats, { type: 'afterMove', unit: 'Sera', ...fields });
    expect(move({ dangerFrom: [], inRange: true, foeDistances: [3] })).toEqual(['safe']);
    expect(move({ dangerFrom: ['s'], inRange: false, foeDistances: [1, 4] })).toEqual(['out']);
    expect(move({ dangerFrom: ['s'], inRange: true, foeDistances: [2, 5] })).toEqual(['d2']);
    expect(move({ dangerFrom: ['s'], inRange: true, foeDistances: [], besideAlly: true })).toEqual([
      'pair',
    ]);
    expect(move({ dangerFrom: ['s'], inRange: true, afterRewind: true })).toEqual(['again']);
    // No danger list at all is not "safe" (an event that never measured it).
    expect(move({ inRange: true })).toEqual([]);
  });

  it('healed and talk name both sides; rewound has no condition', () => {
    const beats = [
      { id: 'h', on: 'healed', unit: 'Sera', target: 'Edric', do: [{ note: 'h' }] },
      { id: 't', on: 'talk', target: 'Sera', do: [{ note: 't' }] },
      { id: 'r', on: 'rewound', do: [{ note: 'r' }] },
    ];
    expect(ids(beats, { type: 'healed', unit: 'Sera', target: 'Edric' })).toEqual(['h']);
    expect(ids(beats, { type: 'healed', unit: 'Sera', target: 'Gaspar' })).toEqual([]);
    expect(ids(beats, { type: 'talk', unit: 'Edric', target: 'Sera' })).toEqual(['t']);
    expect(ids(beats, { type: 'rewound' })).toEqual(['r']);
  });
});

describe('P3 as authored', () => {
  let state;
  const step = (event, options) => {
    const out = prologueBeatsFor(P3, event, state, options);
    state = out.state;
    return out.actions.map(({ beat: _beat, ...action }) => action);
  };

  it('opening, Talk, Sera acting, the heal and the rewind, in the spec order', () => {
    state = {};
    expect(step({ type: 'battleStart' })).toEqual([
      { dialogue: 'p3_intro' },
      { coach: 'p3_reach_sera' },
      { highlight: { unit: 'Sera' } },
      { note: 'p3_recruit' },
      { markLesson: { id: 'recruit', kind: 'shown' } },
    ]);
    expect(step({ type: 'talk', unit: 'Edric', target: 'Sera' })).toEqual([
      { clearCoach: true },
      { coach: 'p3_sera_acts' },
      { markLesson: { id: 'recruit', kind: 'practised' } },
    ]);
    // Talking again (impossible in play) never re-coaches.
    expect(step({ type: 'talk', unit: 'Edric', target: 'Sera' })).toEqual([]);
    expect(step({ type: 'unitActed', unit: 'Sera' })).toEqual([{ clearCoach: true }]);
    // The heal note waits for someone hurt.
    expect(step({ type: 'unitSelected', unit: 'Sera', hurt: false })).toEqual([]);
    expect(step({ type: 'unitSelected', unit: 'Sera', hurt: true })).toEqual([
      { note: 'p3_heal' },
      { markLesson: { id: 'heal', kind: 'shown' } },
    ]);
    // Turn 2 with nobody hurt grants nothing; the beat stays armed.
    expect(step({ type: 'turnStart', phase: 'player', turn: 2, hurt: false })).toEqual([]);
    expect(step({ type: 'turnStart', phase: 'player', turn: 2, hurt: true })).toEqual([
      { grantVision: true },
      { note: 'p3_rewind' },
      { markLesson: { id: 'rewind', kind: 'shown' } },
    ]);
    // Only a safe move after a rewind practises it.
    expect(
      step({ type: 'afterMove', unit: 'Edric', dangerFrom: ['s'], afterRewind: true }, { oneNote: true }), // prettier-ignore
    ).toEqual([]);
    expect(
      step({ type: 'afterMove', unit: 'Edric', dangerFrom: [], afterRewind: true }, { oneNote: true }), // prettier-ignore
    ).toEqual([{ note: 'p3_better_plan' }, { markLesson: { id: 'rewind', kind: 'practised' } }]);
  });

  it('one move says one thing: the first matching note wins, the rest stay armed', () => {
    state = {};
    // Sera steps into reach two tiles from a foe and beside Edric: the fragile note
    // speaks; range and aura wait for a later move.
    const first = step(
      {
        type: 'afterMove',
        unit: 'Sera',
        dangerFrom: ['s'],
        inRange: true,
        foeDistances: [2],
        besideAlly: true,
      },
      { oneNote: true },
    );
    expect(first.filter((a) => a.note)).toEqual([{ note: 'p3_fragile' }]);
    const second = step(
      { type: 'afterMove', unit: 'Sera', dangerFrom: [], inRange: true, foeDistances: [2], besideAlly: true }, // prettier-ignore
      { oneNote: true },
    );
    expect(second.filter((a) => a.note || a.coach)).toEqual([
      { note: 'p3_range' },
      { coach: 'p3_look_is_free' },
    ]);
    const third = step(
      { type: 'afterMove', unit: 'Sera', dangerFrom: [], inRange: true, foeDistances: [3], besideAlly: true }, // prettier-ignore
      { oneNote: true },
    );
    expect(third.filter((a) => a.note)).toEqual([{ note: 'p3_aura' }]);
  });
});
