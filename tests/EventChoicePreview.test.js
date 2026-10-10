// What an event choice can do, said before it is made (docs/specs/event-nodes.md §10 "Choice
// previews"; engine/EventChoicePreview.js). The owner's rule (2026-10-10): every result a choice
// can have on this rung is shown, from the data; which one the seed holds, and the odds, never.
//
// Ways this can fail, a test (or a group) each:
//   1. a result that can happen on this rung is missing, or one that cannot (a weight-0 outcome
//      of another rung) is listed;
//   2. the preview leaks the seed: it differs between two runs that roll differently, names an
//      outcome's own words, or says a chance;
//   3. a number disagrees with what the engine then applies (gold for the act, a Debt's sum, a
//      rung's HP share, a burden's count);
//   4. a check reads as a sure thing, or its stats are not named;
//   5. a shadow change is promised while the Eclipse is off (it would do nothing), or a story
//      flag is said;
//   6. a fallback (what happens when the outcome's effect has nothing to work on) is hidden;
//   7. the page does not draw it inside the choice, or the confirmation leaves it out.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { JourneyStorage } from './harness/RunDriver.js';
import { EventDriver, nodeText } from './harness/EventDriver.js';
import { addUnit, arriveAs, baseData, fallAlly, newRun } from './eventKit.js';
import { chooseEventOption, eventView } from '../src/engine/EventCommands.js';
import { choicePreview, effectPreview } from '../src/engine/EventChoicePreview.js';
import { EVENT_EFFECT_TYPES } from '../src/engine/EventEffects.js';
import { DIFFICULTY_IDS } from '../src/engine/DifficultyEngine.js';

vi.mock('../src/ui/MobileRosterSheet.js', () => ({
  MobileRosterSheet: class {
    destroy() {}
  },
}));

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const eventById = (id) => baseData.events.events.find((e) => e.id === id);
const choiceOf = (eventId, choiceId, face = null) =>
  (face === 'dark' ? eventById(eventId).dark : eventById(eventId)).choices.find(
    (c) => c.id === choiceId,
  );
const preview = (run, eventId, choiceId, extra = {}) =>
  choicePreview(run, choiceOf(eventId, choiceId, extra.face), {
    event: eventById(eventId),
    ...extra,
  });
const words = (lines) => lines.map((l) => `${l.lead}: ${l.text} ${l.details.join(' ')}`).join('\n');

/** Every choice of every page of every face of every event. */
function everyChoice() {
  const out = [];
  for (const event of baseData.events.events)
    for (const face of [event, event.dark].filter(Boolean)) {
      const pages = [face.choices, ...Object.values(face.pages || {}).map((p) => p.choices)];
      for (const choices of pages) for (const choice of choices) out.push({ event, choice });
    }
  return out;
}

/**
 * The outcomes of a choice that can happen on a rung, read from the data here (not through
 * the engine): an outcome's `weightByRung` entry of the highest rung at or below the run's,
 * else its `weight`.
 */
function weightOn(outcome, difficultyId) {
  const rank = DIFFICULTY_IDS.indexOf(difficultyId);
  let weight = Number(outcome.weight) || 0;
  for (const [rung, value] of Object.entries(outcome.weightByRung || {}))
    if (DIFFICULTY_IDS.indexOf(rung) <= rank) weight = value;
  return weight;
}

function possibleOutcomes(choice, difficultyId) {
  return (choice.outcomes || []).filter((outcome) => weightOn(outcome, difficultyId) > 0);
}

/** The lead of a line that states a chance: "70%" -> 70, else null. */
const percentOf = (line) => (/^\d+%$/.test(line.lead) ? parseInt(line.lead, 10) : null);

describe('what a choice can do: one line per result that can happen here', () => {
  it('lists exactly the outcomes this rung can roll, each with its chance when there are several (every choice, every rung)', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const run = newRun({ difficulty });
      for (const { event, choice } of everyChoice()) {
        const lines = choicePreview(run, choice, { event, state: { fallen: { name: 'Rook' } } });
        const where = `${difficulty} ${event.id}/${choice.id}`;
        if (choice.check) {
          expect(
            lines.map((l) => l.lead).filter((l) => l !== ''),
            where,
          ).toEqual(['Test', 'Pass', 'Fail']);
          continue;
        }
        const outcomeLines = lines.filter((l) => percentOf(l) !== null);
        const possible = possibleOutcomes(choice, difficulty);
        for (const line of lines) expect(line.lead, where).not.toMatch(/^(Either|Or)$/);
        if (possible.length > 1) expect(outcomeLines.length, where).toBe(possible.length);
        else expect(outcomeLines, where).toEqual([]);
        for (const line of lines) expect(line.text, where).toMatch(/^\S/);
      }
    }
  });

  it("shows each outcome's chance: the data's weights, normalised, summing to 100 (every choice, every rung)", () => {
    let gambles = 0;
    for (const difficulty of DIFFICULTY_IDS) {
      const run = newRun({ difficulty });
      for (const { event, choice } of everyChoice()) {
        if (choice.check) continue;
        const where = `${difficulty} ${event.id}/${choice.id}`;
        const weights = possibleOutcomes(choice, difficulty).map((o) => weightOn(o, difficulty));
        const shown = choicePreview(run, choice, { event, state: { fallen: { name: 'Rook' } } })
          .map(percentOf)
          .filter((p) => p !== null);
        if (weights.length <= 1) {
          expect(shown, where).toEqual([]);
          continue;
        }
        gambles++;
        const total = weights.reduce((a, b) => a + b, 0);
        expect(shown.length, where).toBe(weights.length);
        expect(
          shown.reduce((a, b) => a + b, 0),
          where,
        ).toBe(100);
        // Whole percentages: each is its exact share rounded down or up.
        shown.forEach((p, i) => {
          const exact = (weights[i] / total) * 100;
          expect(p, where).toBeGreaterThanOrEqual(Math.floor(exact));
          expect(p, where).toBeLessThanOrEqual(Math.ceil(exact));
        });
      }
    }
    expect(gambles).toBeGreaterThan(20);
  });

  it('rounds by largest remainder: 1/1/1 reads 34/33/33, 5/3/2 reads 50/30/20, 1/6 reads 14/86', () => {
    const run = newRun();
    const choice = (weights) => ({
      id: 'x',
      outcomes: weights.map((weight, i) => ({
        id: `o${i}`,
        weight,
        effects: [{ type: 'vision', value: i + 1 }],
      })),
    });
    const leads = (weights) => choicePreview(run, choice(weights)).map((l) => l.lead);
    expect(leads([1, 1, 1])).toEqual(['34%', '33%', '33%']);
    expect(leads([5, 3, 2])).toEqual(['50%', '30%', '20%']);
    expect(leads([1, 6])).toEqual(['14%', '86%']);
  });

  it('a check never shows a chance: no percentage on Test, Pass or Fail', () => {
    const run = newRun();
    for (const { event, choice } of everyChoice()) {
      if (!choice.check) continue;
      const lines = choicePreview(run, choice, { event, state: { fallen: { name: 'Rook' } } });
      for (const line of lines) {
        const where = `${event.id}/${choice.id}`;
        expect(percentOf(line), where).toBeNull();
        expect(`${line.lead} ${line.text}`, where).not.toMatch(/\d+%/);
      }
    }
  });

  it("a weight-0 outcome of another rung is never listed: Black Sun's spy, its lying map, the Dawn's omen", () => {
    const first = newRun({ difficulty: 'normal' });
    const black = newRun({ difficulty: 'lunatic' });
    expect(words(preview(first, 'turncoat', 'take'))).not.toMatch(/Hunted/);
    expect(words(preview(black, 'turncoat', 'take'))).toMatch(/35%: Burden: Hunted/);
    expect(words(preview(first, 'cartographer', 'ask'))).not.toMatch(/becomes a battle/);
    expect(words(preview(black, 'cartographer', 'ask'))).toMatch(
      /30%: A place ahead becomes a battle/,
    );
    expect(words(preview(first, 'twin_altar', 'dawn'))).not.toMatch(/Ill Omen/);
    expect(words(preview(black, 'twin_altar', 'dawn'))).toMatch(/Ill Omen/);
  });

  it('a choice that does nothing but cost or leave says nothing; a gamble that may do nothing says so', () => {
    const run = newRun();
    expect(preview(run, 'wandering_smith', 'leave')).toEqual([]);
    expect(preview(run, 'toll_bridge', 'pay')).toEqual([]);
    const dawn = preview(run, 'twin_altar', 'dawn');
    expect(dawn.map((l) => [l.lead, l.text])).toEqual([
      ['80%', 'A random Tier I blessing'],
      ['20%', 'Nothing happens'],
    ]);
  });

  it("the choice's own effects are a line of their own, before the outcomes", () => {
    const lines = preview(newRun(), 'wounded_courier', 'tend');
    expect(lines.map((l) => [l.lead, l.text])).toEqual([
      ['', 'Spends a use of Vulnerary'],
      ['70%', '+1 Vision'],
      // { base: -50, perAct: -50 } in Act I.
      ['30%', '−100 G'],
    ]);
  });

  it("the Wandering Smith's choices say what they do", () => {
    const run = newRun();
    expect(words(preview(run, 'wandering_smith', 'mend'))).toMatch(
      /Repairs every worn weapon the chosen unit carries/,
    );
    const temper = words(preview(run, 'wandering_smith', 'temper'));
    expect(temper).toMatch(/70%: Chosen unit's equipped weapon gets a free forge on a random stat/);
    expect(temper).toMatch(/One of \+1 Might, \+5 Hit, \+5 Crit or −1 Wt/);
    expect(temper).toMatch(/30%: Chosen unit's equipped weapon takes a wear step/);
    expect(temper).toMatch(/if the weapon can't wear: chosen unit loses 15% of max HP/);
    const covenant = baseData.blessings.blessings.find((b) => b.id === 'smiths_covenant');
    const sworn = preview(run, 'wandering_smith', 'covenant');
    expect(sworn).toEqual([
      { lead: '', text: "Earned blessing: Smith's Covenant", details: [covenant.description] },
    ]);
  });
});

describe('the preview never tells the seed', () => {
  it('is the same for runs that roll differently, and never quotes an outcome', () => {
    const a = newRun({ seed: 3 });
    const b = newRun({ seed: 90210 });
    for (const { event, choice } of everyChoice()) {
      const ctx = { event, state: { fallen: { name: 'Rook' } } };
      const here = choicePreview(a, choice, ctx);
      expect(choicePreview(b, choice, ctx), `${event.id}/${choice.id}`).toEqual(here);
      // The chance leads of a gamble are the one number said; the words never are.
      const said = words(here.map((l) => (percentOf(l) === null ? l : { ...l, lead: '' })));
      for (const outcome of choice.outcomes || []) {
        for (const secret of [outcome.text, outcome.fallbackText].filter(Boolean))
          expect(said).not.toContain(secret);
      }
      expect(said).not.toMatch(
        /odds|chance|probab|likely|usually|rarely|\d+\s?%(?! of (max HP|each victory's gold))/i,
      );
    }
  });

  it('two runs whose Turncoat rolls differ on Black Sun read the same', () => {
    // Find two seeds that roll the two outcomes, so the test holds whichever the data's weights are.
    const rolled = new Map();
    for (let seed = 1; seed < 80 && rolled.size < 2; seed++) {
      const run = newRun({ seed, difficulty: 'lunatic' });
      const node = arriveAs(run, 'turncoat');
      const before = choicePreview(run, choiceOf('turncoat', 'take'), {
        event: eventById('turncoat'),
      });
      const result = chooseEventOption(run, node.id, 'take');
      expect(result.ok).toBe(true);
      if (!rolled.has(result.outcomeId)) rolled.set(result.outcomeId, before);
    }
    expect([...rolled.keys()].sort()).toEqual(['joined', 'spy']);
    expect(rolled.get('joined')).toEqual(rolled.get('spy'));
  });
});

describe('the numbers are the ones the engine applies', () => {
  it('gold is the act amount (a reward is never rung-scaled)', () => {
    const offerings = choiceOf('twin_altar', 'offerings').outcomes[0].effects[0].value;
    for (const difficulty of ['normal', 'hard']) {
      const run = newRun({ difficulty });
      const node = arriveAs(run, 'twin_altar');
      const said = preview(run, 'twin_altar', 'offerings')[0].text;
      const expected = offerings.base + offerings.perAct; // Act I
      expect(said).toContain(`+${expected} G`);
      const result = chooseEventOption(run, node.id, 'offerings');
      expect(result.results.find((r) => r.kind === 'gold').value).toBe(expected);
    }
  });

  it("a Debt says the sum it will owe, and the lender's share on this rung", () => {
    for (const [difficulty, share] of [
      ['normal', 25],
      ['hard', 50],
    ]) {
      const run = newRun({ difficulty, seed: 5 });
      const node = arriveAs(run, 'collectors');
      const lines = preview(run, 'collectors', 'slip');
      const owed = choiceOf('collectors', 'slip').outcomes[0].effects[0].params.owed;
      const sum = owed.base + owed.perAct;
      expect(lines[0].text).toBe(`Burden: Debt (${sum} G)`);
      expect(lines[0].details[0]).toBe(
        `Debt: ${sum} G owed: the lender takes ${share}% of each victory's gold until it is paid.`,
      );
      expect(chooseEventOption(run, node.id, 'slip').ok).toBe(true);
      const debt = run.burdens.find((b) => b.id === 'debt');
      expect(debt.owed).toBe(sum);
      expect(Math.round(debt.garnish * 100)).toBe(share);
    }
  });

  it('two outcomes that differ only by their terms are both listed (the gouged loan)', () => {
    const lines = preview(newRun(), 'moneylender', 'borrow');
    const debts = choiceOf('moneylender', 'borrow').outcomes.map(
      (o) => o.effects[1].params.owed.base + o.effects[1].params.owed.perAct,
    );
    expect(lines.map((l) => l.text)).toEqual(
      debts.map((sum) => `+500 G · Burden: Debt (${sum} G)`),
    );
  });

  it("an HP share reads the rung's own figure (fording on Nightfall)", () => {
    expect(preview(newRun({ difficulty: 'normal' }), 'toll_bridge', 'ford')[0].text).toBe(
      'Each unit loses 20% of max HP',
    );
    expect(preview(newRun({ difficulty: 'hard' }), 'toll_bridge', 'ford')[0].text).toBe(
      'Each unit loses 30% of max HP',
    );
  });

  it("a burden's count is the rung's (Ill Omen: 2 victories on First Light, 3 above)", () => {
    const detail = (difficulty) =>
      preview(newRun({ difficulty }), 'plague_village', 'loot')[0].details.join(' ');
    expect(detail('normal')).toBe('Ill Omen: +1 shadow on each of the next 2 victories.');
    expect(detail('hard')).toBe('Ill Omen: +1 shadow on each of the next 3 victories.');
  });

  it("a weapon names the tier the act's pool draws from", () => {
    const run = newRun();
    expect(preview(run, 'abandoned_armory', 'racks')[0].text).toBe(
      'An Iron weapon someone can use',
    );
    run.actIndex = run.actSequence.indexOf('act3');
    expect(run.currentAct).toBe('act3');
    expect(preview(run, 'abandoned_armory', 'racks')[0].text).toBe(
      'A Silver weapon someone can use',
    );
  });

  it('a fight says its foes, an elite and what winning gives', () => {
    const run = newRun();
    expect(preview(run, 'collectors', 'fight')[0].text).toBe(
      "An elite fight (foes +1 level) · win: +450 G, earned blessing: Thief's Lantern",
    );
    expect(preview(run, 'old_faces', 'ride')[0].text).toMatch(
      /^A fight · a Mercenary, Soldier, Fighter or Archer to Talk into joining · win: /,
    );
  });

  it('a contract says its goal and both its terms', () => {
    const [line] = preview(newRun(), 'merc_contract', 'par');
    expect(line.text).toBe('Contract: Under par');
    expect(line.details).toEqual([
      'Win the next battle by turn par or sooner.',
      'If kept: +500 G. If broken: Debt (350 G).',
      "Debt: 350 G owed: the lender takes 25% of each victory's gold until it is paid.",
    ]);
  });
});

describe('a check, the Eclipse, flags and fallbacks', () => {
  it('a check names whose stats it reads and both its sides, and no number', () => {
    const spar = preview(newRun(), 'old_swordmaster', 'spar');
    expect(spar[0]).toEqual({
      lead: 'Test',
      text: "The chosen unit's SKL + SPD (higher is better)",
      details: [],
    });
    expect(spar.map((l) => l.lead)).toEqual(['Test', 'Pass', 'Fail']);
    expect(spar[2].text).toBe('Chosen unit drops to 1 HP');
    expect(preview(newRun(), 'toll_bridge', 'bluff')[0].text).toBe(
      "Your army's best LCK (higher is better)",
    );
  });

  it('a shadow change is said only while the Eclipse runs', () => {
    const run = newRun();
    expect(run.isEclipseActive()).toBe(true);
    expect(preview(run, 'chained_shelf', 'burn')[0].text).toBe('−4 shadow');
    run.isEclipseActive = () => false;
    expect(preview(run, 'chained_shelf', 'burn')).toEqual([]);
    expect(preview(run, 'twin_altar', 'offerings')[0].text).toBe('+250 G');
  });

  it('a story flag is never said', () => {
    expect(preview(newRun(), 'wounded_courier', 'sell').map((l) => l.text)).toEqual(['+250 G']);
  });

  it("a fallback says when it stands in, and 'just' when it is part of the outcome", () => {
    const run = newRun();
    expect(preview(run, 'old_swordmaster', 'spar')[1].text).toMatch(
      /\(if nothing is left to learn: just a Steel weapon for the chosen unit\)$/,
    );
    expect(preview(run, 'cartographer', 'guide')[0].text).toBe(
      'A new road opens from here (if no road can be added: your gold back)',
    );
  });

  it('the Echo names the fallen ally the event recorded', () => {
    const run = newRun();
    const rook = addUnit(run, 'Cavalier', { name: 'Rook', level: 5 });
    fallAlly(run, rook);
    const node = arriveAs(run, 'the_echo');
    const view = eventView(run, node.id);
    expect(view.choices.find((c) => c.id === 'rest').preview[0].text).toBe(
      'Rook is laid to rest (can never be revived) · −6 shadow',
    );
  });
});

describe('the page', () => {
  it('draws each choice its preview inside its button, and the confirmation says it', () => {
    const d = new EventDriver({ eventId: 'wandering_smith' });
    d.open();
    const temper = d.choice('temper');
    const text = nodeText(temper);
    expect(text).toContain("70%: Chosen unit's equipped weapon gets a free forge on a random stat");
    expect(text).toContain("30%: Chosen unit's equipped weapon takes a wear step");
    expect(text).toContain('One of +1 Might, +5 Hit, +5 Crit or −1 Wt.');
    // The view's preview is the one the page drew.
    const view = eventView(d.run, d.node.id);
    for (const line of view.choices.find((c) => c.id === 'temper').preview)
      expect(text).toContain(line.text);
    // A choice with nothing to say draws no preview box.
    expect(
      d
        .choice('leave')
        .all()
        .some((n) => n.className === 'ev-preview'),
    ).toBe(false);
    // A plain choice's confirmation repeats what it does.
    d.press(d.choice('covenant'));
    const describeText = d.picker.describe(d.picker.choices[0]);
    expect(describeText).toContain("Earned blessing: Smith's Covenant.");
    expect(describeText).toContain('This cannot be undone.');
  });
});

describe('every effect has words', () => {
  /** Every effect definition in the shipped data, nested ones (spoils, contract terms) included. */
  function shippedEffects() {
    const out = [];
    const walk = (effects) => {
      for (const effect of effects || []) {
        out.push(effect);
        walk(effect.afterVictory);
        walk(effect.reward);
        walk(effect.penalty);
      }
    };
    for (const { choice } of everyChoice()) {
      walk(choice.effects);
      for (const outcome of choice.outcomes || []) {
        walk(outcome.effects);
        walk(outcome.fallback);
      }
    }
    return out;
  }

  it('every shipped effect but a story flag says something', () => {
    const run = newRun();
    const ctx = { run, event: eventById('sunken_mine'), state: { fallen: { name: 'Rook' } } };
    const effects = shippedEffects();
    expect(effects.length).toBeGreaterThan(50);
    for (const effect of effects) {
      const { text } = effectPreview(effect, ctx);
      if (effect.type === 'flag') expect(text).toBe('');
      else expect(text, JSON.stringify(effect)).not.toBe('');
    }
  });

  it('every effect type the engine knows has a phrase (a new type must add one)', () => {
    const run = newRun();
    const ctx = { run, event: eventById('sunken_mine'), state: { fallen: { name: 'Rook' } } };
    const sample = {
      gold: { type: 'gold', value: 10 },
      item: { type: 'item', name: 'Vulnerary' },
      learnSkill: { type: 'learnSkill', to: 'target', skillId: 'vantage' },
      fallenSkill: { type: 'fallenSkill', to: 'target' },
      hp: { type: 'hp', mode: 'heal', percent: 10, scope: 'all' },
      shadow: { type: 'shadow', value: 1 },
      vision: { type: 'vision', value: 1 },
      blessing: { type: 'blessing', tier: 1 },
      burden: { type: 'burden', id: 'hunted' },
      layToRest: { type: 'layToRest' },
      consume: { type: 'consume', name: 'Vulnerary', uses: 1 },
      stat: { type: 'stat', stat: 'STR', value: 1, scope: 'target' },
      battle: { type: 'battle', enemyLevelBonus: 0, afterVictory: [] },
      counter: { type: 'counter', key: 'torches', delta: -1 },
      join: { type: 'join', class: 'Cleric' },
      contract: { type: 'contract', goal: 'noLosses', reward: [], penalty: [] },
      routeEdit: { type: 'routeEdit', op: 'addRoad' },
      forge: { type: 'forge', stat: 'might' },
      wear: { type: 'wear' },
      mend: { type: 'mend' },
      earnedBlessing: { type: 'earnedBlessing', id: 'smiths_covenant' },
    };
    for (const type of EVENT_EFFECT_TYPES) {
      if (type === 'flag') continue;
      expect(sample[type], `add a sample (and a phrase) for "${type}"`).toBeTruthy();
      expect(effectPreview(sample[type], ctx).text, type).not.toBe('');
    }
  });
});
