// The words of the Event page (src/ui/eventMenuModel.js): one line per result record, in
// the game's voice, with the numbers the engine reported. Ways this can fail: a record
// kind with no line (the player never learns what an outcome did to them), a number said
// wrongly (a loss shown as a gain, a cost as "lost"), a bookkeeping record (a story flag,
// a battle marker) shown as news, a recipient or a worn step left unnamed, an unknown
// skill id shown raw when the catalog knows it, or a line that prints "undefined".
import { describe, expect, it } from 'vitest';
import {
  RESULT_CHIPS,
  eventCloseLabel,
  eventConfirmLabel,
  eventCostSeal,
  eventResultLines,
  eventTargetLine,
  wornText,
} from '../src/ui/eventMenuModel.js';

const gameData = {
  skills: [
    { id: 'vantage', name: 'Vantage' },
    { id: 'guard', name: 'Guard' },
  ],
};
const lines = (results) => eventResultLines(results, { gameData });
const only = (record) => {
  const out = lines([record]);
  expect(out).toHaveLength(1);
  return out[0];
};

describe('eventResultLines', () => {
  it('gold: a gain is good, a loss is bad, a paid cost says Paid, an empty purse says so', () => {
    expect(only({ kind: 'gold', value: 150, requested: 150 })).toMatchObject({
      chip: 'GOLD',
      tone: 'good',
      text: 'Gained 150 G',
    });
    expect(only({ kind: 'gold', value: -50, requested: -50 })).toMatchObject({
      tone: 'bad',
      text: 'Lost 50 G',
    });
    expect(only({ kind: 'gold', value: -100, requested: -100, cost: true })).toMatchObject({
      tone: 'bad',
      text: 'Paid 100 G',
    });
    // A loss floors at 0: nothing left to take is not "Lost 0 G".
    expect(only({ kind: 'gold', value: 0, requested: -50 }).text).toBe(
      'Nothing was taken: the purse was empty.',
    );
    expect(lines([{ kind: 'gold', value: 0, requested: 0 }])).toEqual([]);
  });

  it('item: names the recipient or the convoy, and the wear by name', () => {
    const edric = only({
      kind: 'item',
      name: 'Steel Sword -2',
      tier: 'Steel',
      itemType: 'Sword',
      unit: 'Edric',
      toConvoy: false,
      worn: ['might', 'hit'],
    });
    expect(edric).toMatchObject({
      chip: 'ITEM',
      tone: 'good',
      text: 'Steel Sword -2 to Edric',
      detail: 'Worn: Dulled −' + '1 Might · Bent −' + '5 Hit',
      item: { name: 'Steel Sword -2', tier: 'Steel', type: 'Sword' },
    });
    const stored = only({ kind: 'item', name: 'Iron Lance', unit: null, toConvoy: true, worn: [] });
    expect(stored.text).toBe('Iron Lance sent to the convoy');
    expect(stored.detail).toBeUndefined();
  });

  it('skill: by catalog name, the bench and the fallen ally named', () => {
    expect(only({ kind: 'skill', unit: 'Rowan', skillId: 'vantage', benched: false })).toEqual({
      kind: 'skill',
      chip: 'SKILL',
      tone: 'good',
      text: 'Rowan learned Vantage',
    });
    const benched = only({
      kind: 'skill',
      unit: 'Rowan',
      skillId: 'guard',
      benched: true,
      from: 'Rook',
    });
    expect(benched.detail).toBe(
      "Taught by Rook's memory. No free slot: benched. Swap it in from Roster.",
    );
    // An id the catalog lacks is shown as is, never "undefined".
    expect(only({ kind: 'skill', unit: 'Rowan', skillId: 'mystery', benched: false }).text).toBe(
      'Rowan learned mystery',
    );
  });

  it('hp: the army with each unit under it, one unit by name, none hurt or healed', () => {
    const army = only({
      kind: 'hp',
      mode: 'heal',
      scope: 'all',
      units: [
        { name: 'Edric', amount: 6 },
        { name: 'Sera', amount: 4 },
      ],
      total: 10,
      targeted: 2,
    });
    expect(army).toMatchObject({
      chip: 'HP',
      tone: 'good',
      text: 'The army recovers 10 HP',
      detail: 'Edric +6 · Sera +4',
    });
    const hurt = only({
      kind: 'hp',
      mode: 'damage',
      scope: 'target',
      units: [{ name: 'Rowan', amount: 8 }],
      total: 8,
      targeted: 1,
    });
    expect(hurt).toMatchObject({ tone: 'bad', text: 'Rowan loses 8 HP' });
    expect(hurt.detail).toBeUndefined();
    const lone = only({
      kind: 'hp',
      mode: 'heal',
      scope: 'all',
      units: [{ name: 'Edric', amount: 6 }],
      total: 6,
      targeted: 1,
    });
    expect(lone.text).toBe('The army recovers 6 HP'); // scope all keeps the army's voice
    expect(only({ kind: 'hp', mode: 'heal', scope: 'all', units: [], total: 0 }).text).toBe(
      'No one needed healing.',
    );
    expect(only({ kind: 'hp', mode: 'damage', scope: 'all', units: [], total: 0 }).text).toBe(
      'No one was hurt.',
    );
  });

  it('shadow: more is bad, less is good, the capped meter falls back to the act, places that fell', () => {
    expect(only({ kind: 'shadow', value: 3, actValue: 3, requested: 3, fell: [] })).toMatchObject({
      chip: 'SHADOW',
      tone: 'bad',
      text: 'The Hollow Sun darkens: +3 shadow',
    });
    expect(
      only({ kind: 'shadow', value: -4, actValue: -4, requested: -4, fell: [] }),
    ).toMatchObject({
      tone: 'good',
      text: 'The shadow lifts: −' + '4',
    });
    expect(only({ kind: 'shadow', value: 0, actValue: 2, requested: 2, fell: [] }).text).toBe(
      'The Hollow Sun darkens: +2 shadow',
    );
    expect(
      only({ kind: 'shadow', value: 3, actValue: 3, requested: 3, fell: ['n1', 'n2'] }).detail,
    ).toBe('2 places on the road fall to the dark.');
    expect(only({ kind: 'shadow', value: 1, actValue: 1, requested: 1, fell: ['n1'] }).detail).toBe(
      '1 place on the road falls to the dark.',
    );
    // The Eclipse off (or the prologue): nothing moved, nothing said.
    expect(lines([{ kind: 'shadow', value: 0, actValue: 0, requested: 3, fell: [] }])).toEqual([]);
  });

  it('vision, blessing, burden, laid to rest, a spent use and a stat each say what they are', () => {
    expect(only({ kind: 'vision', value: 1 })).toMatchObject({ chip: 'VISION', text: 'Vision +1' });
    expect(only({ kind: 'vision', value: -1 })).toMatchObject({
      tone: 'bad',
      text: 'Vision −' + '1',
    });
    expect(lines([{ kind: 'vision', value: 0 }])).toEqual([]);
    expect(
      only({
        kind: 'blessing',
        id: 'steady_hands',
        name: 'Steady Hands',
        description: 'Fewer misses.',
        tier: 1,
      }),
    ).toMatchObject({ chip: 'BLESSING', text: 'Blessing: Steady Hands', detail: 'Fewer misses.' });
    expect(
      only({
        kind: 'burden',
        id: 'debt',
        label: 'Debt',
        line: 'The lender takes a share.',
        detail: '450 G owed',
      }),
    ).toMatchObject({
      chip: 'BURDEN',
      tone: 'bad',
      text: 'Burden: Debt',
      detail: 'The lender takes a share. 450 G owed',
    });
    expect(only({ kind: 'layToRest', name: 'Rook' })).toMatchObject({
      chip: 'CAIRN',
      text: 'Rook is laid to rest',
      detail: 'They can no longer be revived.',
    });
    expect(only({ kind: 'consume', name: 'Vulnerary', uses: 1, holder: 'Edric' }).text).toBe(
      'Spent a use of Vulnerary (Edric)',
    );
    expect(only({ kind: 'consume', name: 'Vulnerary', uses: 2, holder: 'convoy' }).text).toBe(
      'Spent 2 uses of Vulnerary (the convoy)',
    );
    expect(only({ kind: 'stat', unit: 'Rowan', stat: 'SKL', value: 1 })).toMatchObject({
      chip: 'STAT',
      tone: 'good',
      text: 'Rowan: +1 SKL',
    });
  });

  it('draws nothing for bookkeeping (a flag, a battle) and keeps a note', () => {
    expect(
      lines([
        { kind: 'flag', key: 'spared_deserters', value: true },
        { kind: 'battle', enemyLevelBonus: 1 },
        null,
        'junk',
      ]),
    ).toEqual([]);
    expect(only({ kind: 'note', of: 'item', text: 'The spoils had nowhere to go.' })).toMatchObject(
      {
        chip: 'NOTE',
        text: 'The spoils had nowhere to go.',
      },
    );
  });

  it('keeps the order of the records, and every chip is a short pixel word', () => {
    const out = lines([
      { kind: 'gold', value: -100, requested: -100, cost: true },
      { kind: 'blessing', id: 'a', name: 'A', description: '', tier: 1 },
      { kind: 'flag', key: 'k', value: 1 },
      { kind: 'vision', value: 1 },
    ]);
    expect(out.map((l) => l.kind)).toEqual(['gold', 'blessing', 'vision']);
    for (const chip of Object.values(RESULT_CHIPS)) expect(chip).toMatch(/^[A-Z]{2,8}$/);
    for (const line of out) {
      expect(JSON.stringify(line)).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});

describe('the page words', () => {
  it('a cost seal is "150 G" or nothing', () => {
    expect(eventCostSeal(150)).toBe('150 G');
    expect(eventCostSeal(0)).toBe('');
    expect(eventCostSeal(undefined)).toBe('');
    expect(eventConfirmLabel({ cost: 100 })).toBe('Choose · 100 G');
    expect(eventConfirmLabel({ cost: 0 })).toBe('Choose');
  });

  it('the header button keeps the event open before a choice or while a fight is owed', () => {
    expect(eventCloseLabel({ phase: 'choosing', canFight: false })).toBe('Close');
    expect(eventCloseLabel({ phase: 'outcome', canFight: true })).toBe('Close');
    expect(eventCloseLabel({ phase: 'outcome', canFight: false })).toBe('Continue');
    expect(eventCloseLabel({ phase: 'victory', canFight: false })).toBe('Continue');
    expect(eventCloseLabel(null)).toBe('Close');
  });

  it('a target row reads class and level, or its reason when greyed', () => {
    expect(eventTargetLine({ ok: true, unit: { className: 'Fighter', level: 3 } })).toBe(
      'Fighter · Lv 3',
    );
    expect(eventTargetLine({ ok: false, reason: 'No one here can wield a blade.' })).toBe(
      'No one here can wield a blade.',
    );
    expect(eventTargetLine({ ok: true })).toBe('');
  });

  it('wornText names each step with its change', () => {
    expect(wornText(['crit', 'weight'])).toBe('Notched −' + '5 Crit · Rusted +1 Weight');
    expect(wornText([])).toBe('');
    expect(wornText(undefined)).toBe('');
  });
});
