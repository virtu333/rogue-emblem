// An event effect for some acts only (`acts`, EventEffects.effectsForAct), a choice gated on a
// counter's ceiling (`requires.counterAtMost`), the split-counter rule that makes two gated
// choices one always-open choice, and the epic weapon pool (`pool: { kind: 'epic' }`).
// docs/specs/event-nodes.md, the act-fit events note.
//
// Ways it goes wrong: an Act IV reward paid in Act II (or both); a filtered effect shifting what
// the preview says; a counter ceiling that never opens or never shuts; a page the validator
// calls a soft-lock though one of two gated choices is always open (or passes one that can trap);
// an epic weapon handed out twice in a run, to an army that cannot wield it, or outside a fight.
import { describe, expect, it } from 'vitest';
import { effectsForAct, epicPoolFor } from '../src/engine/EventEffects.js';
import { chooseEventOption, eventChoiceBlock, eventView } from '../src/engine/EventCommands.js';
import { validateEventsConfig } from '../src/engine/EventValidation.js';
import { arriveAs, baseData, runWithEvents, soloEvent } from './eventKit.js';

const atAct = (run, act) => {
  run.actSequence = ['act1', 'act2', 'act3', 'act4'];
  run.actIndex = act;
  return run;
};
/** The shipped catalog plus the given events (the validator needs its one fallback event). */
const validate = (events) => {
  const config = structuredClone(baseData.events);
  config.events.push(...events);
  return validateEventsConfig(config, baseData);
};

describe('effectsForAct', () => {
  it('keeps the effects for this act, drops the rest and strips the key', () => {
    const list = [
      { type: 'gold', value: 1 },
      { type: 'gold', value: 2, acts: ['act2'] },
      { type: 'gold', value: 4, acts: ['act3', 'act4'] },
    ];
    expect(effectsForAct(list, 'act2')).toEqual([
      { type: 'gold', value: 1 },
      { type: 'gold', value: 2 },
    ]);
    expect(effectsForAct(list, 'act4')).toEqual([
      { type: 'gold', value: 1 },
      { type: 'gold', value: 4 },
    ]);
    // A list with no `acts` is handed back as it is.
    const plain = [{ type: 'gold', value: 1 }];
    expect(effectsForAct(plain, 'act2')).toBe(plain);
  });
});

describe('an effect for some acts only, in play', () => {
  const event = () => ({
    ...soloEvent([
      { type: 'gold', value: 100, acts: ['act2'] },
      { type: 'gold', value: 300, acts: ['act4'] },
    ]),
    acts: ['act2', 'act3', 'act4'],
  });

  it.each([
    [1, 100],
    [2, 0],
    [3, 300],
  ])('in act index %i it pays %i G, and its preview says so', (act, paid) => {
    const run = atAct(runWithEvents([event()]), act);
    const node = arriveAs(run, 'solo');
    const preview = JSON.stringify(eventView(run, node.id).choices[0].preview);
    if (paid) expect(preview).toContain(`+${paid} G`);
    for (const other of [100, 300].filter((g) => g !== paid))
      expect(preview).not.toContain(`+${other} G`);
    const gold = run.gold;
    expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
    expect(run.gold - gold).toBe(paid);
  });

  it('the validator refuses acts the event never meets, a bad list, and acts on a battle', () => {
    const bad = (effects) => validate([{ ...soloEvent(effects), acts: ['act2', 'act3'] }]);
    expect(bad([{ type: 'gold', value: 5, acts: ['act4'] }]).errors.join('\n')).toContain(
      'acts names an act the event never meets',
    );
    expect(bad([{ type: 'gold', value: 5, acts: [] }]).errors.join('\n')).toContain(
      'acts must be a list',
    );
    expect(
      bad([{ type: 'battle', enemyLevelBonus: 0, acts: ['act2'], afterVictory: [] }]).errors.join(
        '\n',
      ),
    ).toContain('a battle or a contract term takes no acts');
    expect(bad([{ type: 'gold', value: 5, acts: ['act3'] }]).errors).toEqual([]);
  });
});

/** A two-page event: climb down spends the counter; the page below splits on it. */
const caveEvent = (below) => ({
  id: 'cave',
  title: 'Cave',
  weight: 1,
  acts: ['act2'],
  intro: 'A test.',
  counters: { light: 1 },
  choices: [
    {
      id: 'down',
      label: 'Down',
      outcomes: [
        {
          id: 'went',
          weight: 100,
          text: 'Down.',
          effects: [{ type: 'counter', key: 'light', delta: -1 }],
          next: 'below',
        },
      ],
    },
    {
      id: 'leave',
      label: 'Leave',
      outcomes: [{ id: 'left', weight: 100, text: 'Out.', effects: [] }],
    },
  ],
  pages: { below: { text: 'Below.', choices: below } },
});
const gated = (id, requires) => ({
  id,
  label: id,
  requires: { ...requires, reason: `${id} shut` },
  outcomes: [{ id: 'o', weight: 100, text: 'Out.', effects: [] }],
});

describe('requires.counterAtMost and the split counter', () => {
  const lit = gated('lit', { counterAtLeast: { key: 'light', n: 1 } });
  const dark = gated('dark', { counterAtMost: { key: 'light', n: 0 } });

  it('a ceiling opens at or below its bound and shuts above it', () => {
    const run = atAct(runWithEvents([caveEvent([lit, dark])]), 1);
    const node = arriveAs(run, 'cave');
    // Above the ceiling on the first page (light 1): checked on the page below after the climb.
    expect(chooseEventOption(run, node.id, 'down').ok).toBe(true);
    expect(eventChoiceBlock(run, node.id, 'dark')).toBe('');
    expect(eventChoiceBlock(run, node.id, 'lit')).toBe('lit shut');
    run.eventStateByNodeId[node.id].counters.light = 1;
    expect(eventChoiceBlock(run, node.id, 'dark')).toBe('dark shut');
    expect(eventChoiceBlock(run, node.id, 'lit')).toBe('');
  });

  it('two choices that split one counter make a page with a way out', () => {
    expect(validate([caveEvent([lit, dark])]).errors).toEqual([]);
  });

  it('a page whose gated choices leave a gap is still a soft-lock', () => {
    // At least 2 | at most 0: light 1 opens neither.
    const gap = gated('lit', { counterAtLeast: { key: 'light', n: 2 } });
    expect(validate([caveEvent([gap, dark])]).errors.join('\n')).toContain(
      'no choice is always available',
    );
    // A second requirement beside the bound gates it further: no longer a split.
    const more = gated('lit', { counterAtLeast: { key: 'light', n: 1 }, minGold: 100 });
    expect(validate([caveEvent([more, dark])]).errors.join('\n')).toContain(
      'no choice is always available',
    );
  });

  it('a split whose open side leads deeper is not a guaranteed way out', () => {
    const deeper = {
      ...gated('lit', { counterAtLeast: { key: 'light', n: 1 } }),
      outcomes: [{ id: 'o', weight: 100, text: 'On.', effects: [], next: 'below' }],
    };
    expect(validate([caveEvent([deeper, dark])]).errors.join('\n')).toContain(
      'no guaranteed way out',
    );
  });

  it('the ceiling must name a declared counter with a whole bound', () => {
    const errs = (requires) =>
      validate([caveEvent([gated('lit', { counterAtLeast: { key: 'light', n: 1 } }), gated('dark', requires)])]).errors.join('\n'); // prettier-ignore
    expect(errs({ counterAtMost: { key: 'gloom', n: 0 } })).toContain('does not declare');
    expect(errs({ counterAtMost: { key: 'light', n: -1 } })).toContain('whole n >= 0');
  });
});

describe('the epic weapon pool', () => {
  const fight = (afterVictory) => {
    const event = soloEvent([
      { type: 'battle', enemyLevelBonus: 0, victoryText: 'Won.', afterVictory },
    ]);
    event.acts = ['act4'];
    event.choices.push({
      id: 'leave',
      label: 'Leave',
      outcomes: [{ id: 'left', weight: 100, text: 'Out.', effects: [] }],
    });
    return event;
  };

  it("holds the act's epic weapons the run does not own that someone can wield", () => {
    const run = atAct(runWithEvents([]), 3);
    const all = epicPoolFor(run).map((w) => w.name);
    // lootTables.json act4.epicWeapons, by hand (the army can wield bows, lances, swords...).
    expect(all.length).toBeGreaterThan(0);
    for (const name of all) expect(baseData.lootTables.act4.epicWeapons).toContain(name);
    run.legendaryGrants = [all[0]];
    expect(epicPoolFor(run).map((w) => w.name)).not.toContain(all[0]);
    // Nobody can wield anything: an empty pool.
    run.roster = [];
    expect(epicPoolFor(run)).toEqual([]);
  });

  it('is valid in a fight’s spoils and refused anywhere else, or with other keys', () => {
    expect(validate([fight([{ type: 'item', pool: { kind: 'epic' } }])]).errors).toEqual([]);
    expect(
      validate([
        { ...soloEvent([{ type: 'item', pool: { kind: 'epic' } }]), acts: ['act4'] },
      ]).errors.join('\n'),
    ).toContain("an epic pool belongs in a battle's afterVictory");
    expect(
      validate([fight([{ type: 'item', pool: { kind: 'epic', tierOffset: 1 } }])]).errors.join(
        '\n',
      ),
    ).toContain('an epic pool takes no other keys');
  });
});
